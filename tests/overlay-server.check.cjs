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
// A browser and a keeper that never exit, and no process run for real.
childProcess.spawn = () => Object.assign(new EventEmitter(), { unref() {}, kill() {} })
childProcess.execFile = (...args) => {
  const done = args.find(a => typeof a === 'function')
  if (done) done(null, '', '')
}

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
  for (const [method, url] of [['GET', '/'], ['GET', '/window'], ['GET', '/summary'], ['POST', '/open'], ['POST', '/dismiss']]) {
    const res = await request(method, url, { host: `attacker.example:${port}` })
    assert.equal(res.status, 403, `${method} ${url}`)
  }
  assert.equal((await request('GET', '/ping', { host: `localhost:${port}` })).status, 200)
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
