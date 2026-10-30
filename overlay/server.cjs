// Narsil's floating window: a tiny local server that the mod pushes state and
// events to, an Edge app window that draws them, and a keeper (watch.ps1) that
// shows the window only while Claude is minimized or an event waits for you.
// It shuts itself (and the window) down when Claude stops sending heartbeats
// or the window is closed.
'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')

const port = Number(process.env.NARSIL_PORT || 47190)
const token = process.env.NARSIL_TOKEN || ''
const edge = process.env.NARSIL_EDGE || ''
const profile = path.join(process.env.LOCALAPPDATA || process.env.TEMP || __dirname, 'narsil-overlay')

const HEARTBEAT_TIMEOUT_MS = 30_000
// A "done" note leaves by itself; a question or an error waits for you.
const DONE_EVENT_MS = 20_000
const SESSION = /^local_[A-Za-z0-9-]{1,64}$/
const EVENT_KINDS = new Set(['done', 'question', 'error'])
const STATUSES = ['working', 'idle', 'waiting', 'done', 'error']
// Which conversation the window shows first: whoever needs you most.
const PRIORITY = { waiting: 0, error: 1, working: 2, done: 3, idle: 4 }
const SESSION_TIMEOUT_MS = 30_000
const PAGE = fs.readFileSync(path.join(__dirname, 'overlay.html'))
const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File']

// One entry per open conversation, as its own mod reports it.
const sessions = new Map()
let event = null
let claude = 'fg'
let lastBeat = Date.now()
let lastAnswer = null
let pendingOpens = []
let isQuitting = false
let keeper = null
const listeners = new Set()

function liveSessions() {
  const now = Date.now()
  for (const [id, entry] of sessions) if (now - entry.at > SESSION_TIMEOUT_MS) sessions.delete(id)
  return [...sessions.values()].sort(
    (a, b) => (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9) || b.changedAt - a.changedAt,
  )
}

function summary() {
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]))
  const live = liveSessions()
  for (const entry of live) if (entry.status in counts) counts[entry.status]++
  return { ...counts, total: live.length }
}

function snapshot() {
  return JSON.stringify({ sessions: liveSessions(), summary: summary(), event })
}

function broadcast() {
  const data = `data: ${snapshot()}\n\n`
  for (const res of listeners) res.write(data)
}

function conversationLink(sessionId) {
  return SESSION.test(sessionId || '') ? `claude://code/continue?session=${sessionId}&source=desktop_action` : null
}

function killWindow(done) {
  execFile('powershell.exe', [...POWERSHELL, path.join(__dirname, 'kill.ps1')], { env: { ...process.env, NARSIL_PROFILE: profile } }, () => done())
}

function quit() {
  if (isQuitting) return
  isQuitting = true
  if (keeper) keeper.kill()
  killWindow(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}

function openWindow() {
  const child = spawn(
    edge,
    [
      `--app=http://127.0.0.1:${port}/`,
      `--user-data-dir=${profile}`,
      '--window-size=330,390',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
      // it is hidden most of the time and must still update at once
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    { detached: true, stdio: 'ignore' },
  )
  // The first process of a private profile is the window's own: when it
  // exits, the person closed the window.
  child.on('exit', () => setTimeout(quit, 1500))
  child.unref()
  keeper = spawn('powershell.exe', [...POWERSHELL, path.join(__dirname, 'watch.ps1')], {
    env: { ...process.env, NARSIL_PORT: String(port), NARSIL_TOKEN: token },
    stdio: 'ignore',
    windowsHide: true,
  })
}

function clearEvent() {
  if (!event) return
  event = null
  broadcast()
}

// The keeper reports the Claude window; the answer is what it must do.
function tick(claudeState, hasWindow) {
  claude = claudeState
  // You are looking at Claude: seen. A forced (test) event gets a moment first.
  if (event && claude === 'fg' && !(event.isForced && Date.now() - event.at < 8000)) clearEvent()
  if (event && event.kind === 'done' && Date.now() - event.at > DONE_EVENT_MS) clearEvent()

  const isVisible = claude === 'min' || claude === 'gone' || event !== null
  const lines = []
  const wanted = isVisible ? 'show' : 'hide'
  // Only on a change, so a window you dragged elsewhere stays where you put it.
  if (hasWindow && wanted !== lastAnswer) {
    lines.push(wanted)
    lastAnswer = wanted
  }
  for (const url of pendingOpens) lines.push(`open ${url}`)
  pendingOpens = []
  return lines.join('\n')
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
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }
  const isTrusted = token !== '' && req.headers['x-narsil-token'] === token

  if (req.method === 'GET' && url.pathname === '/ping') return send(200, 'text/plain', 'narsil')
  if (req.method === 'GET' && url.pathname === '/') return send(200, 'text/html; charset=utf-8', PAGE)
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`data: ${snapshot()}\n\n`)
    listeners.add(res)
    req.on('close', () => listeners.delete(res))
    return
  }
  if (req.method === 'GET' && url.pathname === '/summary') return send(200, 'application/json', JSON.stringify(summary()))
  if (req.method === 'GET' && url.pathname === '/tick') {
    if (!isTrusted) return send(403, 'text/plain', 'forbidden')
    return send(200, 'text/plain', tick(url.searchParams.get('claude') || 'fg', url.searchParams.get('window') === '1'))
  }
  if (req.method !== 'POST') return send(404, 'text/plain', 'not found')

  // The page's own actions: open a conversation (the one it names, else the
  // event's, else the one it shows first), or dismiss the event.
  if (url.pathname === '/open') {
    const first = liveSessions()[0]
    const link = conversationLink(url.searchParams.get('session') || (event && event.sessionId) || (first && first.sessionId))
    if (link) pendingOpens.push(link)
    clearEvent()
    return send(204, 'text/plain', '')
  }
  if (url.pathname === '/dismiss') {
    clearEvent()
    lastAnswer = null // the keeper re-applies what is wanted now
    return send(204, 'text/plain', '')
  }

  if (!isTrusted) return send(403, 'text/plain', 'forbidden')
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
    const before = sessions.get(id)
    const isChanged = !before || before.mood !== data.mood || before.headline !== data.headline
    const now = Date.now()
    sessions.set(id, { ...data, sessionId: id, at: now, changedAt: isChanged || !before ? now : before.changedAt })
    lastBeat = now
    // Heartbeats that change nothing are not sent on to the page.
    if (isChanged) broadcast()
    return send(204, 'text/plain', '')
  }
  if (url.pathname === '/event') {
    if (!data || !EVENT_KINDS.has(data.kind)) return send(400, 'text/plain', 'bad event')
    lastBeat = Date.now()
    // An event that happens while you look at Claude needs no popup
    // (unless it is /narsil prueba, which forces one to show it).
    if (claude !== 'fg' || data.force === true) {
      event = {
        kind: data.kind,
        sessionId: data.sessionId,
        title: String(data.title || ''),
        text: String(data.text || ''),
        at: Date.now(),
        isForced: data.force === true,
      }
      broadcast()
    }
    return send(204, 'text/plain', '')
  }
  if (url.pathname === '/quit') {
    send(204, 'text/plain', '')
    return quit()
  }
  return send(404, 'text/plain', 'not found')
})

server.on('error', () => process.exit(0)) // another overlay already owns the port
server.listen(port, '127.0.0.1', openWindow)

setInterval(() => {
  if (Date.now() - lastBeat > HEARTBEAT_TIMEOUT_MS) quit()
  // A conversation that stopped beating was closed: drop it from the page too.
  const known = sessions.size
  liveSessions()
  if (sessions.size !== known) broadcast()
}, 5000)
