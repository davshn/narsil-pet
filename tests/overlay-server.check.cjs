// Checks who may use the floating window's server (overlay/server.cjs): only
// its own page (the key it is served with) and the mod (the token), and only
// at its own local address, so no web page you visit can drive it.
//   node tests/overlay-server.check.cjs
// The browser and the keeper are stood in for: nothing opens or closes.
'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const { EventEmitter } = require('events')
const http = require('http')
const os = require('os')
const path = require('path')

const port = 47000 + Math.floor(Math.random() * 900)
process.env.NARSIL_PORT = String(port)
process.env.NARSIL_TOKEN = 'mod-token'
process.env.NARSIL_EDGE = 'edge.exe'
// A profile of its own, should anything try to close its windows.
process.env.LOCALAPPDATA = path.join(os.tmpdir(), `narsil-check-${port}`)
// A browser and a keeper that never exit, and no process run for real. Each
// browser launched is kept, so a check can count them or make one exit.
const launches = []
// Whether a process of the window's profile runs, as running.ps1 answers.
let isProfileRunning = false
childProcess.spawn = command => {
  const child = Object.assign(new EventEmitter(), { unref() {}, kill() {} })
  if (command === 'edge.exe') launches.push(child)
  return child
}
childProcess.execFile = (...args) => {
  const done = args.find(a => typeof a === 'function')
  const isRunningCheck = (args.find(Array.isArray) || []).some(a => String(a).endsWith('running.ps1'))
  if (done) done(null, isRunningCheck ? (isProfileRunning ? '1' : '0') : '', '')
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

require(path.join(__dirname, '..', 'overlay', 'server.cjs'))

function request(method, url, { host = `127.0.0.1:${port}`, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host, ...headers } }, res => {
      let text = ''
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const checks = []
const check = (name, run) => checks.push({ name, run })

check('the page is served with its key, and the key is not a placeholder', async () => {
  const page = await request('GET', '/')
  assert.equal(page.status, 200)
  const key = /<meta name="narsil-key" content="([0-9a-f]{32})">/.exec(page.text)?.[1]
  assert.ok(key, 'the page carries a 32-hex key')
})

check('another host name (a page rebound to this address) is refused everywhere', async () => {
  for (const [method, url] of [['GET', '/'], ['GET', '/window'], ['GET', '/sessions'], ['POST', '/open'], ['POST', '/dismiss']]) {
    const res = await request(method, url, { host: `attacker.example:${port}` })
    assert.equal(res.status, 403, `${method} ${url}`)
  }
  const ping = await request('GET', '/ping', { host: `localhost:${port}` })
  assert.equal(ping.status, 200)
  assert.equal(ping.text, 'narsil 3', 'the protocol the mod checks')
})

check("the page's actions need its key", async () => {
  for (const url of ['/open', '/dismiss', '/bounds?x=1&y=2&w=3&h=4&visible=1']) {
    assert.equal((await request('POST', url)).status, 403, `${url} without the key`)
    assert.equal((await request('POST', url, { headers: { 'x-narsil-page': 'f'.repeat(32) } })).status, 403, `${url} with a wrong key`)
  }
  const page = await request('GET', '/')
  const key = /<meta name="narsil-key" content="([0-9a-f]{32})">/.exec(page.text)[1]
  for (const url of ['/open', '/dismiss', '/bounds?x=10&y=20&w=330&h=450&visible=1']) {
    assert.equal((await request('POST', url, { headers: { 'x-narsil-page': key } })).status, 204, `${url} with the key`)
  }
  const box = JSON.parse((await request('GET', '/window')).text)
  assert.deepEqual([box.x, box.y, box.width, box.height, box.isVisible], [10, 20, 330, 450, true])
})

check("the mod's state needs its token, as before", async () => {
  const body = JSON.stringify({ sessionId: 'local_abc', mood: 'idle', status: 'idle', headline: 'h' })
  const json = { 'content-type': 'application/json' }
  assert.equal((await request('POST', '/state', { headers: json, body })).status, 403)
  const res = await request('POST', '/state', { headers: { ...json, 'x-narsil-token': 'mod-token' }, body })
  assert.equal(res.status, 200)
  assert.equal(res.text, 'need-svg')
})

check('every conversation is served to the mods alone, the most important first, without drawings', async () => {
  const mod = { 'content-type': 'application/json', 'x-narsil-token': 'mod-token' }
  const push = (sessionId, status) =>
    request('POST', '/state', { headers: mod, body: JSON.stringify({ sessionId, mood: 'm', status, headline: status, svg: '<svg/>' }) })
  await push('local_done', 'done')
  await push('local_work', 'working')
  await push('local_ask', 'waiting')
  await push('local_fail', 'error')
  assert.equal((await request('GET', '/sessions')).status, 403, 'without the token')
  assert.equal((await request('GET', '/sessions', { headers: { 'x-narsil-page': 'f'.repeat(32) } })).status, 403, 'with a page key')
  const res = await request('GET', '/sessions', { headers: { 'x-narsil-token': 'mod-token' } })
  assert.equal(res.status, 200)
  const list = JSON.parse(res.text).filter(s => s.sessionId !== 'local_abc')
  assert.deepEqual(list.map(s => s.sessionId), ['local_fail', 'local_ask', 'local_work', 'local_done'])
  assert.ok(list.every(s => !('svg' in s)), 'no drawings')
})

check('a conversation that stops beating stays listed for an hour, then goes until it beats again', async () => {
  const mod = { 'content-type': 'application/json', 'x-narsil-token': 'mod-token' }
  const sessionId = 'local_dormant'
  const body = JSON.stringify({ sessionId, mood: 'm', status: 'done', headline: 'done', svg: '<svg/>' })
  const isListed = async () => {
    const res = await request('GET', '/sessions', { headers: { 'x-narsil-token': 'mod-token' } })
    return JSON.parse(res.text).some(s => s.sessionId === sessionId)
  }
  assert.equal((await request('POST', '/state', { headers: mod, body })).status, 204)
  const now = Date.now
  try {
    // Most of an hour without its heartbeats (the app put its engine to sleep).
    Date.now = () => now() + 59 * 60_000
    assert.ok(await isListed(), 'the sleeping conversation is still listed')
    // Past the hour (it was deleted, or slept that long): forgotten.
    Date.now = () => now() + 61 * 60_000
    assert.ok(!(await isListed()), 'the silent conversation is forgotten')
    // Opened again, its first heartbeat lists it once more.
    assert.equal((await request('POST', '/state', { headers: mod, body })).status, 204)
    assert.ok(await isListed(), 'the conversation is back with its first heartbeat')
  } finally {
    Date.now = now
  }
})

check('the window turns on and off for the mod alone, and the server stays', async () => {
  assert.equal((await request('POST', '/window?on=0')).status, 403)
  const mod = { 'x-narsil-token': 'mod-token' }
  assert.equal((await request('POST', '/window?on=0', { headers: mod })).status, 204)
  assert.equal((await request('GET', '/ping')).text, 'narsil 3')
  assert.equal((await request('POST', '/window?on=1', { headers: mod })).status, 204)
  assert.equal((await request('GET', '/ping')).text, 'narsil 3')
})

check('a window Edge hands to its running instance is not opened a second time', async () => {
  if (process.platform === 'darwin') return
  const mod = { 'x-narsil-token': 'mod-token' }
  await request('POST', '/window?on=0', { headers: mod })
  launches.length = 0
  isProfileRunning = false
  await request('POST', '/window?on=1', { headers: mod })
  await wait(50)
  assert.equal(launches.length, 1, 'the window opens')
  // Edge hands the window to the profile's running instance: the launched
  // process exits at once while the window stays.
  isProfileRunning = true
  launches[0].emit('exit')
  await wait(50)
  await request('POST', '/window?on=1', { headers: mod })
  await wait(50)
  assert.equal(launches.length, 1, 'no second window while the profile runs')
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
