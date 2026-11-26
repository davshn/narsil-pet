// Checks Narsil's hub (overlay/server.cjs): only the mod (the token) may push
// or read the conversations, only at its own local address, so no web page you
// visit can reach them; and it opens no window.
//   node tests/overlay-server.check.cjs
'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const http = require('http')
const net = require('net')
const path = require('path')

const port = 47000 + Math.floor(Math.random() * 900)
process.env.NARSIL_PORT = String(port)
process.env.NARSIL_TOKEN = 'mod-token'
// Whatever the hub would start is counted, and nothing runs for real.
const started = []
childProcess.spawn = (...args) => started.push(args)
childProcess.execFile = (...args) => started.push(args)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

require(path.join(__dirname, '..', 'overlay', 'server.cjs'))

function request(method, url, { host = `127.0.0.1:${port}`, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host, ...headers } }, res => {
      let text = ''
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode, text, type: res.headers['content-type'] }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const MOD = { 'content-type': 'application/json', 'x-narsil-token': 'mod-token' }
const checks = []
const check = (name, run) => checks.push({ name, run })

check('another host name (a page rebound to this address) is refused everywhere', async () => {
  for (const [method, url] of [['GET', '/ping'], ['GET', '/sessions'], ['POST', '/state'], ['POST', '/quit']]) {
    const res = await request(method, url, { host: `attacker.example:${port}`, headers: MOD })
    assert.equal(res.status, 403, `${method} ${url}`)
  }
  const ping = await request('GET', '/ping', { host: `localhost:${port}` })
  assert.equal(ping.status, 200)
  assert.equal(ping.text, 'narsil 5', 'the protocol the mod checks')
})

check('the window, its page and its pictures are gone', async () => {
  for (const [method, url] of [['GET', '/'], ['GET', '/events'], ['GET', '/window'], ['GET', '/icon.png'], ['GET', '/anim/hola-oscuro.webp'], ['GET', '/tick'], ['POST', '/window?on=1'], ['POST', '/event'], ['POST', '/open'], ['POST', '/dismiss'], ['POST', '/bounds']]) {
    const res = await request(method, url, { headers: MOD, body: method === 'POST' ? '{"kind":"done"}' : undefined })
    assert.equal(res.status, 404, `${method} ${url}`)
  }
  await wait(50)
  assert.deepEqual(started, [], 'no browser, keeper or script is started')
})

check("the mod's state needs its token", async () => {
  const body = JSON.stringify({ sessionId: 'local_abc', mood: 'idle', status: 'idle', headline: 'h' })
  assert.equal((await request('POST', '/state', { headers: { 'content-type': 'application/json' }, body })).status, 403)
  assert.equal((await request('POST', '/state', { headers: MOD, body })).status, 204)
})

check('every conversation is served to the mods alone, the most important first, without drawings', async () => {
  const push = (sessionId, status) =>
    request('POST', '/state', { headers: MOD, body: JSON.stringify({ sessionId, mood: 'm', status, headline: status, svg: '<svg/>' }) })
  await push('local_done', 'done')
  await push('local_work', 'working')
  await push('local_ask', 'waiting')
  await push('local_fail', 'error')
  assert.equal((await request('GET', '/sessions')).status, 403, 'without the token')
  const res = await request('GET', '/sessions', { headers: { 'x-narsil-token': 'mod-token' } })
  assert.equal(res.status, 200)
  const list = JSON.parse(res.text).filter(s => s.sessionId !== 'local_abc')
  assert.deepEqual(list.map(s => s.sessionId), ['local_fail', 'local_ask', 'local_work', 'local_done'])
  assert.ok(list.every(s => !('svg' in s)), 'no drawings')
})

check('a conversation that stops beating stays listed for an hour, then goes until it beats again', async () => {
  const sessionId = 'local_dormant'
  const body = JSON.stringify({ sessionId, mood: 'm', status: 'done', headline: 'done' })
  const isListed = async () => {
    const res = await request('GET', '/sessions', { headers: { 'x-narsil-token': 'mod-token' } })
    return JSON.parse(res.text).some(s => s.sessionId === sessionId)
  }
  assert.equal((await request('POST', '/state', { headers: MOD, body })).status, 204)
  const now = Date.now
  try {
    // Most of an hour without its heartbeats (the app put its engine to sleep).
    Date.now = () => now() + 59 * 60_000
    assert.ok(await isListed(), 'the sleeping conversation is still listed')
    // Past the hour (it was deleted, or slept that long): forgotten.
    Date.now = () => now() + 61 * 60_000
    assert.ok(!(await isListed()), 'the silent conversation is forgotten')
    // Opened again, its first heartbeat lists it once more.
    assert.equal((await request('POST', '/state', { headers: MOD, body })).status, 204)
    assert.ok(await isListed(), 'the conversation is back with its first heartbeat')
  } finally {
    Date.now = now
  }
})

// Sends a request line as is, which http.request would not let through.
function rawRequest(target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`)
    })
    let text = ''
    socket.on('data', chunk => (text += chunk))
    socket.on('end', () => resolve(text))
    socket.on('error', reject)
  })
}

check('a request path no URL can be made of is refused, and the server keeps answering', async () => {
  for (const target of ['//', 'http://']) {
    const reply = await rawRequest(target)
    assert.match(reply, /^HTTP\/1\.1 400 /, `GET ${target}`)
  }
  await wait(50)
  assert.equal((await request('GET', '/ping')).text, 'narsil 5')
})

;(async () => {
  let failed = 0
  for (const { name, run } of checks) {
    try {
      await run()
      console.log(`ok   ${name}`)
    } catch (error) {
      failed++
      console.log(`FAIL ${name}\n     ${error.message}`)
    }
  }
  console.log(failed ? `${failed} of ${checks.length} failed` : `${checks.length} passed`)
  process.exit(failed ? 1 : 0)
})()
