// Narsil's hub: a tiny local server every open conversation pushes its state
// to, and reads the others' from, so each band can list them all. It opens no
// window. It shuts itself down when Claude stops sending heartbeats.
// With the ear on (/narsil escucha on, Windows), it also runs the one listener
// (listen.ps1) and tells it which keys to press (ear.cjs).
'use strict'

const http = require('http')
const path = require('path')
const { spawn } = require('child_process')
const { createEar } = require('./ear.cjs')

const port = Number(process.env.NARSIL_PORT || 47190)
const token = process.env.NARSIL_TOKEN || ''

const HEARTBEAT_TIMEOUT_MS = 30_000
const SESSION = /^local_[A-Za-z0-9-]{1,64}$/
// Which conversation comes first: an error, then what needs you, then what
// works, then what finished.
const PRIORITY = { error: 0, waiting: 1, working: 2, done: 3, idle: 4 }
// How long a conversation stays listed without heartbeats: long enough for
// one the app put to sleep, short enough that a deleted one goes.
const SESSION_FORGET_MS = 60 * 60_000
// Only this address: a site that points its own name at 127.0.0.1 (DNS
// rebinding) reaches the server under that name, and is turned away.
const HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

// One entry per conversation, as its own mod last reported it. Kept for
// SESSION_FORGET_MS after its last heartbeat: the app puts the engine of a
// conversation you have not opened in a while to sleep, and its heartbeats
// stop although it still exists; a deleted one never beats again.
const sessions = new Map()
let lastBeat = Date.now()

// The ear: wanted or not, the listener running now, and what it decides.
const ear = createEar()
let isEarOn = false
let listener = null
// A listener that exits while the ear is on is started again, after a while.
const LISTENER_RESTART_MS = 5000

function startListener() {
  if (listener || process.platform !== 'win32') return
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(__dirname, 'listen.ps1')], {
    env: { ...process.env, NARSIL_PORT: String(port), NARSIL_TOKEN: token },
    stdio: 'ignore',
    windowsHide: true,
  })
  listener = child
  child.on('exit', () => {
    if (listener !== child) return
    listener = null
    if (isEarOn) setTimeout(() => isEarOn && startListener(), LISTENER_RESTART_MS).unref()
  })
  child.on('error', () => undefined)
}

function setEar(isOn) {
  isEarOn = isOn
  if (isOn) return startListener()
  ear.reset()
  const child = listener
  listener = null
  if (child) child.kill()
}

function quit() {
  setEar(false)
  process.exit(0)
}

// Lets go of the conversations silent past SESSION_FORGET_MS.
function forgetSilent() {
  const now = Date.now()
  for (const [id, entry] of sessions) if (now - entry.at > SESSION_FORGET_MS) sessions.delete(id)
}

// Every live conversation for the mods, most important first.
function sessionList() {
  forgetSilent()
  return [...sessions.values()].sort(
    (a, b) => (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9) || b.changedAt - a.changedAt,
  )
}

function readBody(req) {
  return new Promise(resolve => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 1_000_000) req.destroy()
    })
    req.on('end', () => resolve(body))
  })
}

const server = http.createServer(async (req, res) => {
  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }
  // A request line such as "GET // HTTP/1.1" makes no URL; throwing here
  // would reject this async handler and end the whole server.
  let url
  try {
    url = new URL(req.url, `http://127.0.0.1:${port}`)
  } catch {
    return send(400, 'text/plain', 'bad request')
  }
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return send(403, 'text/plain', 'forbidden')
  const isTrusted = token !== '' && req.headers['x-narsil-token'] === token

  // The protocol, as the mod checks it: "narsil 7" is the hub whose ear uses Windows' modern recognizer.
  if (req.method === 'GET' && url.pathname === '/ping') return send(200, 'text/plain', 'narsil 7')
  if (!isTrusted) return send(403, 'text/plain', 'forbidden')
  if (req.method === 'GET' && url.pathname === '/sessions') return send(200, 'application/json', JSON.stringify(sessionList()))
  // The listener's sample (you talked, "Narsil" heard, Claude in front):
  // the answer is the keys to press, one a line, or "quit" with the ear off.
  if (req.method === 'GET' && url.pathname === '/ear/tick') {
    if (!isEarOn) return send(200, 'text/plain', 'quit')
    const q = url.searchParams
    const keys = ear.tick({ isVoice: q.get('voice') === '1', isHeard: q.get('heard') === '1', isClaude: q.get('claude') === '1' })
    return send(200, 'text/plain', keys.join('\n'))
  }
  if (req.method === 'POST' && url.pathname === '/ear') {
    setEar(url.searchParams.get('on') === '1')
    return send(204, 'text/plain', '')
  }
  if (req.method !== 'POST') return send(404, 'text/plain', 'not found')

  const body = await readBody(req)
  let data = null
  try {
    data = body ? JSON.parse(body) : null
  } catch {
    return send(400, 'text/plain', 'bad json')
  }
  if (url.pathname === '/state') {
    if (!data || typeof data !== 'object') return send(400, 'text/plain', 'bad state')
    const id = SESSION.test(data.sessionId || '') ? data.sessionId : 'local_unknown'
    // A drawing an older mod still sends is not kept: each band draws its own.
    const { svg, ...entry } = data
    const before = sessions.get(id)
    // Anything shown changed (state, context, tasks, subagents…).
    const shown = ({ sessionId, at, changedAt, ...rest }) => JSON.stringify(rest)
    const now = Date.now()
    const isChanged = !before || shown(before) !== shown(entry)
    sessions.set(id, { ...entry, sessionId: id, at: now, changedAt: isChanged ? now : before.changedAt })
    lastBeat = now
    return send(204, 'text/plain', '')
  }
  if (url.pathname === '/quit') {
    send(204, 'text/plain', '')
    return quit()
  }
  return send(404, 'text/plain', 'not found')
})

server.on('error', () => process.exit(0)) // another hub already owns the port
server.listen(port, '127.0.0.1', () => {
  if (process.env.NARSIL_EAR === '1') setEar(true)
})

setInterval(() => {
  if (Date.now() - lastBeat > HEARTBEAT_TIMEOUT_MS) quit()
}, 5000)
