// Narsil's hub: a tiny local server every open conversation pushes its state
// and events to, and reads the others' from. When the floating window is
// wanted it also opens a browser app window that draws them, and a keeper that
// shows the window only while Claude is minimized or an event waits for you.
// On Windows the window is Edge's and the keeper is watch.ps1; on macOS it is
// a Chromium browser's (start.sh finds one) and the keeper runs here, in Node.
// Closing the window leaves the server running for the conversations; it
// shuts itself (and the window) down when Claude stops sending heartbeats.
'use strict'

const crypto = require('crypto')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFile } = require('child_process')

const isMac = process.platform === 'darwin'
const port = Number(process.env.NARSIL_PORT || 47190)
const token = process.env.NARSIL_TOKEN || ''
const edge = process.env.NARSIL_EDGE || ''
// macOS: the browser's .app bundle, opened with `open` so it starts behind.
const browserApp = process.env.NARSIL_BROWSER_APP || ''
const profile = isMac
  ? path.join(os.homedir(), 'Library', 'Application Support', 'narsil-overlay')
  : path.join(process.env.LOCALAPPDATA || process.env.TEMP || __dirname, 'narsil-overlay')
const WINDOW_SIZE = '--window-size=330,450'
const LINK = /^claude:\/\/code\/continue\?session=local_[A-Za-z0-9-]{1,64}&source=desktop_action$/

const HEARTBEAT_TIMEOUT_MS = 30_000
// After you close the window, an event does not open it again this soon.
const REOPEN_AFTER_CLOSE_MS = 60_000
// A "done" note leaves by itself; a question or an error waits for you.
const DONE_EVENT_MS = 20_000
const SESSION = /^local_[A-Za-z0-9-]{1,64}$/
const EVENT_KINDS = new Set(['done', 'question', 'error'])
const STATUSES = ['working', 'idle', 'waiting', 'done', 'error']
// Which conversation comes first, and whose state Narsil wears: an error,
// then what needs you, then what works, then what finished.
const PRIORITY = { error: 0, waiting: 1, working: 2, done: 3, idle: 4 }
const SESSION_TIMEOUT_MS = 30_000
// The page's own key, new each run: its actions carry it, and no other web
// page can read it (a page of another site cannot read this one).
const PAGE_KEY = crypto.randomBytes(16).toString('hex')
const PAGE = fs.readFileSync(path.join(__dirname, 'overlay.html'), 'utf8').replace('__NARSIL_KEY__', PAGE_KEY)
// Only this address: a site that points its own name at 127.0.0.1 (DNS
// rebinding) reaches the server under that name, and is turned away.
const HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
// The window's icon on the taskbar (tools/build-icon.ps1).
const ICON = fs.readFileSync(path.join(__dirname, 'icon.png'))
const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File']

// One entry per open conversation, as its own mod reports it.
const sessions = new Map()
let event = null
// Unknown until the keeper's first report: an event that started the server
// shows at once, and the first report clears it if you are looking at Claude.
let claude = 'unknown'
let lastBeat = Date.now()
let lastAnswer = null
let pendingOpens = []
let isQuitting = false
let keeper = null
// Whether the window is wanted (the floating window is on), whether it is
// open now, and when you closed it last.
let isWindowWanted = process.env.NARSIL_WINDOW !== '0'
let isWindowOpen = false
let closedAt = Number.NEGATIVE_INFINITY
// Where the window last said it is on screen (in CSS pixels, from the top
// left of the main screen), so the tip window can open above it on macOS.
let bounds = null
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

// Every live conversation for the mods, most important first, without the
// drawings (each mod draws its own).
function sessionList() {
  return liveSessions().map(({ svg, ...entry }) => entry)
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
  if (isMac) {
    // Every process of the window's own browser profile, helpers included.
    execFile('pkill', ['-f', '--', PROFILE_FLAG], () => done())
    return
  }
  execFile('powershell.exe', [...POWERSHELL, path.join(__dirname, 'kill.ps1')], { env: { ...process.env, NARSIL_PROFILE: profile } }, () => done())
}

function quit() {
  if (isQuitting) return
  isQuitting = true
  stopKeeper()
  if (!isWindowOpen) return process.exit(0)
  killWindow(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}

const BROWSER_ARGS = [
  `--app=http://127.0.0.1:${port}/`,
  `--user-data-dir=${profile}`,
  WINDOW_SIZE,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate',
  // it is hidden most of the time and must still update at once
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]

function openWindow() {
  if (isWindowOpen || isQuitting) return
  if (isMac ? !browserApp : !edge) return
  isWindowOpen = true
  lastAnswer = null
  if (isMac) return keepMac()
  const child = spawn(edge, BROWSER_ARGS, { detached: true, stdio: 'ignore' })
  // The first process of a private profile is the window's own: when it
  // exits, the person closed the window. The server stays for the others.
  child.on('exit', () => windowGone())
  child.unref()
  keeper = spawn('powershell.exe', [...POWERSHELL, path.join(__dirname, 'watch.ps1')], {
    env: { ...process.env, NARSIL_PORT: String(port), NARSIL_TOKEN: token },
    stdio: 'ignore',
    windowsHide: true,
  })
}

function stopKeeper() {
  const k = keeper
  keeper = null
  if (k) k.kill()
}

function windowGone() {
  if (!isWindowOpen) return
  isWindowOpen = false
  closedAt = Date.now()
  stopKeeper()
}

function closeWindow() {
  if (!isWindowOpen) return
  isWindowOpen = false
  stopKeeper()
  killWindow(() => undefined)
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

// macOS keeper. mac-claude.js reports, from the window list and with no
// permission, whether a window of Claude's is on screen: none (minimized,
// hidden or not running) is "min", or "gone" when Claude is not running; one
// in front is "fg", one behind another app "bg", as watch.ps1 tells them on
// Windows. Hiding another app's window would need the accessibility
// permission, so the window is opened behind the app in use (open -g) when
// wanted and closed when not; its browser profile remembers where you put it.
// The browser hands `open -n` to a profile's running instance, which opens
// one more window: so the window opens only when none of its processes runs,
// and each show or hide waits for the one before it to finish.
let macWindowWork = Promise.resolve()
const PROFILE_FLAG = `--user-data-dir=${profile}`

function isMacWindowRunning() {
  return new Promise(resolve => execFile('pgrep', ['-f', '--', PROFILE_FLAG], { timeout: 2000 }, err => resolve(!err)))
}

function inMacOrder(work) {
  macWindowWork = macWindowWork.then(work).catch(() => undefined)
}

function showMacWindow() {
  inMacOrder(async () => {
    if (await isMacWindowRunning()) return
    await new Promise(resolve => execFile('open', ['-g', '-n', '-a', browserApp, '--args', ...BROWSER_ARGS], () => resolve()))
  })
}

// Closing takes the browser a moment: wait until it is gone, 3 s at most.
function hideMacWindow() {
  inMacOrder(async () => {
    await new Promise(resolve => killWindow(resolve))
    for (let i = 0; i < 15 && (await isMacWindowRunning()); i++) await new Promise(resolve => setTimeout(resolve, 200))
  })
}

function onMacState(state) {
  for (const line of tick(state, true).split('\n')) {
    if (line === 'show') showMacWindow()
    else if (line === 'hide') hideMacWindow()
    // Only ever a Claude Code conversation link, checked when queued too.
    else if (line.startsWith('open ') && LINK.test(line.slice(5))) execFile('open', [line.slice(5)], () => undefined)
  }
}

function keepMac() {
  if (!browserApp || isQuitting || !isWindowOpen) return
  const reader = keeper = spawn('osascript', ['-l', 'JavaScript', path.join(__dirname, 'mac-claude.js')], { stdio: ['ignore', 'ignore', 'pipe'] })
  let rest = ''
  let isBusy = false
  reader.stderr.on('data', chunk => {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop()
    const word = lines.at(-1)?.trim()
    if (!['fg', 'bg', 'none'].includes(word) || isBusy) return
    if (word !== 'none') return onMacState(word)
    isBusy = true
    execFile('pgrep', ['-x', 'Claude'], { timeout: 2000 }, notRunning => {
      isBusy = false
      if (!isQuitting) onMacState(notRunning ? 'gone' : 'min')
    })
  })
  // It only stops when something killed it: start it again.
  reader.on('exit', () => setTimeout(keepMac, 2000))
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
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return send(403, 'text/plain', 'forbidden')
  const isTrusted = token !== '' && req.headers['x-narsil-token'] === token
  const isPage = isTrusted || req.headers['x-narsil-page'] === PAGE_KEY

  // The protocol, as the mod checks it: "narsil 3" serves every conversation to the mods.
  if (req.method === 'GET' && url.pathname === '/ping') return send(200, 'text/plain', 'narsil 3')
  if (req.method === 'GET' && url.pathname === '/') return send(200, 'text/html; charset=utf-8', PAGE)
  if (req.method === 'GET' && (url.pathname === '/icon.png' || url.pathname === '/favicon.ico')) return send(200, 'image/png', ICON)
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`data: ${snapshot()}\n\n`)
    listeners.add(res)
    req.on('close', () => listeners.delete(res))
    return
  }
  if (req.method === 'GET' && url.pathname === '/window') return send(200, 'application/json', JSON.stringify(bounds && { ...bounds, age: Date.now() - bounds.at }))
  if (req.method === 'GET' && url.pathname === '/summary') return send(200, 'application/json', JSON.stringify(summary()))
  if (req.method === 'GET' && url.pathname === '/sessions') {
    if (!isTrusted) return send(403, 'text/plain', 'forbidden')
    return send(200, 'application/json', JSON.stringify(sessionList()))
  }
  if (req.method === 'GET' && url.pathname === '/tick') {
    if (!isTrusted) return send(403, 'text/plain', 'forbidden')
    return send(200, 'text/plain', tick(url.searchParams.get('claude') || 'fg', url.searchParams.get('window') === '1'))
  }
  if (req.method !== 'POST') return send(404, 'text/plain', 'not found')

  // The page's own actions, with its key: open a conversation (the one it names, else the
  // event's, else the one it shows first), or dismiss the event.
  if (['/open', '/dismiss', '/bounds'].includes(url.pathname) && !isPage) return send(403, 'text/plain', 'forbidden')
  if (url.pathname === '/open') {
    const first = liveSessions()[0]
    const link = conversationLink(url.searchParams.get('session') || (event && event.sessionId) || (first && first.sessionId))
    if (link) pendingOpens.push(link)
    clearEvent()
    return send(204, 'text/plain', '')
  }
  if (url.pathname === '/bounds') {
    const n = Number
    const q = url.searchParams
    const box = { x: n(q.get('x')), y: n(q.get('y')), width: n(q.get('w')), height: n(q.get('h')) }
    if (Object.values(box).every(Number.isFinite)) bounds = { ...box, isVisible: q.get('visible') === '1', at: Date.now() }
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
    // Anything shown changed (state, context, tasks, subagents…), the drawing aside.
    const shown = ({ svg, sessionId, at, changedAt, ...rest }) => JSON.stringify(rest)
    const isChanged = !before || shown(before) !== shown(data)
    const now = Date.now()
    // The drawing comes only when it changes: the one before stays meanwhile.
    const svg = typeof data.svg === 'string' ? data.svg : before && before.svg
    const isRedrawn = !!before && svg !== before.svg
    sessions.set(id, { ...data, svg, sessionId: id, at: now, changedAt: isChanged || isRedrawn || !before ? now : before.changedAt })
    lastBeat = now
    // Heartbeats that change nothing are not sent on to the page.
    if (isChanged || isRedrawn) broadcast()
    // A server that started after this conversation's last drawing asks for it.
    if (!svg) return send(200, 'text/plain', 'need-svg')
    return send(204, 'text/plain', '')
  }
  // The floating window turned on or off: the server stays either way.
  if (url.pathname === '/window') {
    isWindowWanted = url.searchParams.get('on') === '1'
    if (isWindowWanted) openWindow()
    else closeWindow()
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
      // A window you closed comes back for what waits, after a while.
      if (isWindowWanted && !isWindowOpen && (data.force === true || Date.now() - closedAt >= REOPEN_AFTER_CLOSE_MS)) openWindow()
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
server.listen(port, '127.0.0.1', () => {
  if (isWindowWanted) openWindow()
})

setInterval(() => {
  if (Date.now() - lastBeat > HEARTBEAT_TIMEOUT_MS) quit()
  // A conversation that stopped beating was closed: drop it from the page too.
  const known = sessions.size
  liveSessions()
  if (sessions.size !== known) broadcast()
}, 5000)
