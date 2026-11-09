import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetSession, Mood, Pet, Prefs, Stats, TaskItem, TaskStatus, Usage } from '../types'
import { NO_VIEW, TITLE_CELLS, countOfStates, fit, fleetOf, openOf, ownFirst, pageOf, toggleOpen } from './fleet'
import { TASK_ICON, TASK_TOOLS, applyTaskCall, backgroundTasks } from './tasks'
import type { TipKind } from './advice'
import { MAX_ANSWER, MAX_CALLS, MAX_FAILURES, STEPS_SYSTEM, SYSTEM, describe, emptyContext, forkPrompt, parse, parseSteps, pendingTasks, prompt, remember, stepsPrompt } from './advice'
import { TONE_COLOR, agentChip, liveRuns, modelLabel } from './agents'
import { NTFY_URL, PHONE_DAILY, PHONE_KEY, artUrl, countOf, dayOf, fleetText, newTopic, ntfyRow, phoneHelp, phoneMessage, phoneStatus, sealedMessage, sealedPayload } from './phone'
import { newKey, seal } from './seal'
import { FACE, POSE, STATUS_COLOR, sprite, statusOf } from './sprite'
import type { ContextSample } from './usage'
import { NO_USAGE, contextDetailOf, contextDetailRows, contextDetailSummary, contextDetailSvg, hasUsage, levelColor, minutesLabel, minutesToFull, textBar, usageOf, usageRows, usageSummary, usageSvg } from './usage'
import { IDLE_SUMMARY_MS, KEEP_STATS, NUDGE_AFTER_MS, STATS_PREFIX, addFile, emptyStats, isClaudesCall, nudgeText, statsOf, summaryText } from './watch'
import { ASKING_TOOLS, MAX_AGENTS_SHOWN, MOOD_BY_TOOL, PHONE_ROOM, SHELL_TOOLS, STATUS_LABEL, TEST_COMMAND, TIP_LINE, WRITING_TOOLS, ago, basename, cacheColor, cacheLabel, cacheLeft, cacheShort, cacheStart, dangerOf, describeCall, duration, fleetSummary, headline, pick, say, summary, tipLines } from './words'
import type { XpReason } from './xp'
import { STAGES, STAGE_FROM, XP_GAIN, XP_KEY, levelOf, stageOf, xpLabel, xpOf } from './xp'

// Narsil: a chibi sea serpent, named after the sword reforged to cut down
// bugs. She swims while Claude works, dozes while it waits, leaps out of the
// water when a job is done, and shivers at a red error.

const pet = atom({ plugin: 'narsil-pet', key: 'pet' } as const, {
  mood: 'greeting',
  line: '¡Hola! Soy Narsil. Te cuento todo lo que hago.',
  detail: '',
})
// At most one automatic tip every so many minutes, unless the person sets
// another. Until 2.8.0 it was 10, and every saved prefs carries it.
const ADVICE_EVERY_MINUTES = 30
const OLD_ADVICE_EVERY_MINUTES = 10
// Set once a stored 10 has been moved to the new default: a 10 chosen after
// that is the person's own.
const ADVICE_MIGRATED_KEY = 'adviceEvery30'
const prefs = atom({ plugin: 'narsil-pet', key: 'prefs' } as const, {
  isHidden: false,
  isMuted: false,
  isFloating: true,
  isAdviceOn: true,
  adviceEveryMinutes: ADVICE_EVERY_MINUTES,
  isAdviceSpoken: false,
  isNextStepsOn: true,
  cacheMinutes: null,
  isQuiet: false,
  phoneTopic: null,
  isPhoneOn: false,
  phoneKey: null,
})
// Every open conversation as the hub serves it, the most important first;
// empty while the hub is out of reach.
const sessions = atom({ plugin: 'narsil-pet', key: 'sessions' } as const, [])
// This conversation's task list, as its task tools leave it (tasks.ts).
const tasks = atom({ plugin: 'narsil-pet', key: 'tasks' } as const, [])
// Which conversation the band has open, its context's breakdown, the page.
const fleetView = atom({ plugin: 'narsil-pet', key: 'view' } as const, NO_VIEW)

const TASK_COLOR: Record<TaskStatus, string> = {
  pending: STATUS_COLOR.idle,
  in_progress: STATUS_COLOR.working,
  completed: STATUS_COLOR.done,
  running: STATUS_COLOR.working,
}
// Narsil's tip on show, if any: under the headline and in the window.
const tip = atom({ plugin: 'narsil-pet', key: 'tip' } as const, null)
// What the session has spent: context window, 5-hour and weekly limits.
const usage = atom({ plugin: 'narsil-pet', key: 'usage' } as const, NO_USAGE)
// What fills the context window, while the person has the detail open (a
// press on the context bar); null shows the bars.
const contextDetail = atom({ plugin: 'narsil-pet', key: 'contextDetail' } as const, null)
// The subagents running now, or just ended, in the order they started; and
// their chips as the band and the window show them (agents.ts).
const agents = atom({ plugin: 'narsil-pet', key: 'agents' } as const, [])
const agentChips = atom({ plugin: 'narsil-pet', key: 'agentChips' } as const, [])
// The prompt cache's clock while Claude waits for you, and the next steps
// offered for the last turn.
const cache = atom({ plugin: 'narsil-pet', key: 'cache' } as const, null)
const steps = atom({ plugin: 'narsil-pet', key: 'steps' } as const, null)
// What the session has done so far, for its summary (watch.ts).
const stats = atom({ plugin: 'narsil-pet', key: 'stats' } as const, null)
// Narsil's experience, kept across sessions in the store (xp.ts).
const xp = atom({ plugin: 'narsil-pet', key: 'xp' } as const, 0)
// The main thread's model, as a name ("Opus 5.5"): read at start and with
// each heartbeat, since no event tells of a /model change.
const mainModel = atom({ plugin: 'narsil-pet', key: 'model' } as const, null)
// A new level or stage being celebrated, and when it began.
const milestone = atom({ plugin: 'narsil-pet', key: 'milestone' } as const, null)
// The conversation's own title, as Claude Code names it; null until it has one.
const convTitle = atom({ plugin: 'narsil-pet', key: 'title' } as const, null)
// How long each celebration shows.
const MILESTONE_MS = { level: 6000, grew: 9000 } as const

const PREFS_KEY = 'prefs'
const TOKEN_KEY = 'overlayToken'
const OVERLAY = 'http://127.0.0.1:47190'

// Starts one of the mod's scripts (overlay/*.ps1) as a process of its own and
// returns at once: it outlives the hook, the turn and a reload of this module,
// which a $.clock timer does not. Its text travels in the environment, which
// the started process inherits, never in argv.
// Which system the session runs on: Windows (overlay/*.ps1), macOS
// (overlay/*.sh) or another, where Narsil keeps to the band, the engine's
// voice and its notifications. Asked once.
type Platform = 'windows' | 'mac' | 'other'
let platform: Platform | null = null

async function platformOf($: EngineInterface): Promise<Platform> {
  if (platform) return platform
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') return (platform = 'windows')
  try {
    const { stdout } = await $.process.run(['uname', '-s'], { timeoutMs: 5000 })
    const name = stdout.trim()
    platform = name === 'Darwin' ? 'mac' : /^(MINGW|MSYS|CYGWIN)/.test(name) ? 'windows' : 'other'
  } catch {
    // No uname at all: Windows without a POSIX shell.
    platform = 'windows'
  }
  return platform
}

// `name` is the script's name without its suffix (`speak`, `toast`).
async function launch($: EngineInterface, name: string, env: Record<string, string>): Promise<boolean> {
  const os = await platformOf($)
  if (os === 'mac') {
    // Detached, its output nowhere, so $.process.run returns at once.
    return run($, ['/bin/sh', '-c', 'nohup /bin/sh "$NARSIL_SCRIPT" </dev/null >/dev/null 2>&1 &'], {
      ...env,
      NARSIL_SCRIPT: `${$.plugin.root}/overlay/${name}.sh`,
    })
  }
  if (os !== 'windows') return false
  const file = `${$.plugin.root.replace(/\//g, '\\')}\\overlay\\${name}.ps1`
  return powershell(
    $,
    "Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('\"' + $env:NARSIL_SCRIPT + '\"')",
    { ...env, NARSIL_SCRIPT: file },
  )
}

async function run($: EngineInterface, argv: string[], env: Record<string, string>): Promise<boolean> {
  try {
    const { exitCode } = await $.process.run(argv, { env, timeoutMs: 60_000 })
    return exitCode === 0
  } catch {
    return false
  }
}

async function powershell($: EngineInterface, script: string, env: Record<string, string>): Promise<boolean> {
  return run($, ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], env)
}

async function speak($: EngineInterface, text: string): Promise<void> {
  // The mod's own script first, so a Spanish voice is chosen when one is installed.
  if (await launch($, 'speak', { NARSIL_TEXT: text })) return
  void $.audio.speak(text).catch(() => undefined)
}

// The floating window (overlay/server.cjs) is shared by every session: the
// token lives in the store so each session can push to whichever started it.
async function overlayToken($: EngineInterface): Promise<string> {
  const saved = await $.store.get(TOKEN_KEY).catch(() => undefined)
  if (typeof saved === 'string' && saved) return saved
  const token = crypto.randomUUID()
  await $.store.set(TOKEN_KEY, token).catch(() => undefined)
  return token
}

// What this version's window server answers a ping. A server another version
// started answers otherwise ("narsil" before the drawing was sent only on a
// change): it outlives the mod's updates, so it is closed and started anew.
const OVERLAY_PROTOCOL = 'narsil 3'

async function overlayPing($: EngineInterface): Promise<'up' | 'stale' | 'down'> {
  try {
    const { ok, text } = await $.http.fetch(`${OVERLAY}/ping`)
    if (!ok) return 'down'
    if (text === OVERLAY_PROTOCOL) return 'up'
    return text.startsWith('narsil') ? 'stale' : 'down'
  } catch {
    return 'down'
  }
}

async function isOverlayUp($: EngineInterface): Promise<boolean> {
  return (await overlayPing($)) === 'up'
}

async function startOverlay($: EngineInterface): Promise<void> {
  const os = await platformOf($)
  if (os === 'other') return
  const ping = await overlayPing($)
  if (ping === 'up') return
  if (ping === 'stale') {
    // Closed first, and given time to free the port.
    await stopOverlay($)
    for (let waited = 0; waited < OVERLAY_WAIT_MS && (await overlayPing($)) !== 'down'; waited += 300) {
      await $.clock.sleep(300).catch(() => undefined)
    }
  }
  // The server serves every conversation; the window opens only when wanted.
  const env = { NARSIL_TOKEN: await overlayToken($), NARSIL_PORT: '47190', NARSIL_WINDOW: (await read($, prefs)).isFloating ? '1' : '0' }
  if (os === 'mac') {
    // start.sh finds Node and a Chromium browser and starts the server behind.
    await run($, ['/bin/sh', `${$.plugin.root}/overlay/start.sh`], env)
    return
  }
  const root = $.plugin.root.replace(/\//g, '\\')
  const script = [
    "$edge = @(\"${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe\", \"$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe\") | Where-Object { Test-Path $_ } | Select-Object -First 1",
    "$node = (Get-Command node -ErrorAction SilentlyContinue).Source",
    "if (-not $node) { $node = \"$env:ProgramFiles\\nodejs\\node.exe\" }",
    // Without Edge the server still serves the conversations, with no window.
    'if (-not (Test-Path $node)) { exit 3 }',
    'if ($edge) { $env:NARSIL_EDGE = $edge }',
    'Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList (\'"\' + $env:NARSIL_SERVER + \'"\')',
  ].join('; ')
  await powershell($, script, { ...env, NARSIL_SERVER: `${root}\\overlay\\server.cjs` })
}

// The desktop app's id of this conversation (`local_…`), what its
// claude://code/continue link opens, and the folder it works in; both set at
// session.start.
let hostSession = ''
let sessionTitle = ''

// This conversation's name: its title, the folder it works in until it has one.
async function titleOf($: EngineInterface): Promise<string> {
  return (await read($, convTitle)) || sessionTitle
}

// Keeps the title Claude Code gives the conversation, when it gives one.
async function noteTitle($: EngineInterface, title: string | undefined): Promise<void> {
  const name = title?.trim()
  if (name && name !== (await read($, convTitle))) await update($, convTitle, () => name)
}

function conversationLink(): string {
  return /^local_[A-Za-z0-9-]{1,64}$/.test(hostSession)
    ? `claude://code/continue?session=${hostSession}&source=desktop_action`
    : ''
}

// The drawing the window's server last got from this conversation: it is
// sent again only when it changes, or when the server says it has none (it
// restarted), not with every heartbeat.
let sentSvg = ''

// Every conversation pushes its state, window or not: the hub serves it to
// the others. Returns whether the hub took it.
async function pushOverlay($: EngineInterface): Promise<boolean> {
  const s = await read($, pet)
  const svg = sprite(s.mood, stageOf(levelOf(await read($, xp)).level), (await read($, milestone)) ?? undefined)
  const state = await shownState($)
  const send = async (withSvg: boolean): Promise<string | null> => {
    try {
      const reply = await $.http.fetch(`${OVERLAY}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-narsil-token': await overlayToken($) },
        body: JSON.stringify(withSvg ? { ...state, svg } : state),
      })
      return reply.ok ? reply.text : null
    } catch {
      return null
    }
  }
  const withSvg = svg !== sentSvg
  const reply = await send(withSvg)
  if (reply === null) {
    sentSvg = ''
    return false
  }
  if (withSvg) sentSvg = svg
  else if (reply === 'need-svg' && (await send(true)) !== null) sentSvg = svg
  return true
}

// Every open conversation, as the hub serves it.
async function readSessions($: EngineInterface): Promise<void> {
  try {
    const { ok, text } = await $.http.fetch(`${OVERLAY}/sessions`, { headers: { 'x-narsil-token': await overlayToken($) } })
    if (!ok) return
    const list = JSON.parse(text) as FleetSession[]
    if (!Array.isArray(list)) return
    const next = list.map(s => ({
      sessionId: String(s.sessionId),
      title: String(s.title ?? ''),
      mood: s.mood,
      status: s.status,
      headline: String(s.headline ?? ''),
      model: s.model ?? null,
      changedAt: Number(s.changedAt) || 0,
      context: s.context && typeof s.context.percent === 'number' ? { percent: s.context.percent, note: String(s.context.note ?? '') } : null,
      contextDetail: s.contextDetail && Array.isArray(s.contextDetail.parts) ? s.contextDetail : null,
      cache: typeof s.cache === 'string' ? s.cache : null,
      cacheEndsAt: typeof s.cacheEndsAt === 'number' ? s.cacheEndsAt : null,
      cacheMinutes: typeof s.cacheMinutes === 'number' ? s.cacheMinutes : null,
      agents: Array.isArray(s.agents) ? s.agents : [],
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
    }))
    if (JSON.stringify(next) !== JSON.stringify(await read($, sessions))) await update($, sessions, () => next)
  } catch {
    // the hub out of reach: the list stays as it was
  }
}

// The floating window on or off; the hub stays for the conversations.
async function setWindow($: EngineInterface, isOn: boolean): Promise<void> {
  await $.http
    .fetch(`${OVERLAY}/window?on=${isOn ? 1 : 0}`, { method: 'POST', headers: { 'x-narsil-token': await overlayToken($) } })
    .catch(() => undefined)
}

// This conversation's id as the hub keys it.
function ownId(): string {
  return /^local_[A-Za-z0-9-]{1,64}$/.test(hostSession) ? hostSession : 'local_unknown'
}

// This conversation as one entry of the list, fresh: the hub's copy is a
// heartbeat old. It keeps the hub's time of its last change while its state
// holds.
async function ownEntry($: EngineInterface): Promise<FleetSession> {
  const s = await shownState($)
  const copy = (await read($, sessions)).find(x => x.sessionId === s.sessionId)
  const changedAt = copy && copy.status === s.status ? copy.changedAt : await $.clock.now()
  return {
    sessionId: s.sessionId,
    title: s.title,
    mood: s.mood,
    status: s.status,
    headline: s.headline,
    model: s.model,
    changedAt,
    context: s.context,
    contextDetail: s.contextDetail,
    cache: s.cache,
    cacheEndsAt: s.cacheEndsAt,
    cacheMinutes: s.cacheMinutes,
    agents: s.agents,
    tasks: s.tasks,
  }
}

// What the floating window shows of this conversation, as
// the band shows it.
async function shownState($: EngineInterface) {
  const s = await read($, pet)
  const status = statusOf(s.mood)
  const context = (await read($, usage)).context
  return {
    sessionId: ownId(),
    title: await titleOf($),
    mood: s.mood,
    status,
    statusLabel: STATUS_LABEL[status],
    headline: headline(s.mood, s.detail),
    line: s.line,
    tip: await read($, tip).then(t => (t && !t.isWindowed ? t.text : null)),
    usage: usageRows(await read($, usage), await $.clock.now(), contextToFull).map(r => ({ ...r, color: levelColor(r.percent) })),
    agents: await read($, agentChips),
    cache: await read($, cache).then(c => (c ? cacheLabel(c) : null)),
    // when its cache runs out, for the others and the phone to count down
    ...(await read($, cache).then(c => ({ cacheEndsAt: c ? Math.floor((cacheStart(c) + c.minutes * 60_000) / 1000) : null, cacheMinutes: c ? c.minutes : null }))),
    steps: (await read($, steps))?.items ?? [],
    xp: xpLabel(await read($, xp)),
    model: await read($, mainModel),
    // its fill, with the tokens and when it will be full
    context: context ? { percent: context.percent, note: usageRows({ ...NO_USAGE, context }, 0, contextToFull)[0]?.note ?? '' } : null,
    contextDetail: await read($, contextDetail),
    tasks: [...(await read($, tasks)), ...background] as readonly TaskItem[],
  }
}

// The heartbeat: keep the window in sync, and learn how many conversations
// are open and in which state.
async function readModel($: EngineInterface): Promise<void> {
  let name: string | null = null
  try {
    name = modelLabel(await $.session.model()) || null
  } catch {
    // no model to read: none is shown
  }
  if (name !== (await read($, mainModel))) await update($, mainModel, () => name)
}

async function beat($: EngineInterface): Promise<void> {
  // A tip leaves the band after TIP_SHOWN_MS; the window keeps it for
  // TIP_KEPT_MS, since it shows while Claude is minimized, often later.
  const kept = await read($, tip)
  const age = kept ? (await $.clock.now()) - kept.at : 0
  if (kept && age >= TIP_KEPT_MS) await update($, tip, () => null)
  else if (kept && !kept.isFaded && age >= TIP_SHOWN_MS) await update($, tip, t => (t ? { ...t, isFaded: true } : t))
  const shown = await read($, milestone)
  if (shown && (await $.clock.now()) - shown.at >= MILESTONE_MS[shown.kind]) await update($, milestone, () => null)
  await readModel($)
  await tickCache($)
  await tickWatch($)
  await refreshAgents($)
  // A hub that went down (or never started) is started again, at most once a minute.
  if (!(await pushOverlay($))) void ensureOverlay($).catch(() => undefined)
  await readSessions($)
}

async function stopOverlay($: EngineInterface): Promise<void> {
  await $.http
    .fetch(`${OVERLAY}/quit`, { method: 'POST', headers: { 'x-narsil-token': await overlayToken($) } })
    .catch(() => undefined)
}

async function notify($: EngineInterface, title: string, text: string): Promise<void> {
  // try, not .catch: where the host has no notify at all the call throws
  // before it returns a promise.
  try {
    if ((await $.ui.notify(text, { title })).isSent) return
  } catch {
    // no notification channel: the mod's own script below
  }
  // The system's own notification (overlay/toast.*); on Windows, clicking it
  // opens this conversation too.
  await launch($, 'toast', { NARSIL_TITLE: title, NARSIL_TEXT: text, NARSIL_LINK: conversationLink() })
}

type EventKind = 'done' | 'question' | 'error'

async function postEvent($: EngineInterface, kind: EventKind, title: string, text: string, force: boolean): Promise<boolean> {
  try {
    const { ok } = await $.http.fetch(`${OVERLAY}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-narsil-token': await overlayToken($) },
      body: JSON.stringify({ kind, title, text, sessionId: hostSession, force }),
    })
    return ok
  } catch {
    return false
  }
}

// The floating window quits by itself after 30 s without heartbeats, or when
// you close it. An event that needs it starts it again, at most once a minute,
// and waits up to OVERLAY_WAIT_MS for it to listen.
const OVERLAY_RESTART_MS = 60_000
const OVERLAY_WAIT_MS = 3000
let lastOverlayStart = Number.NEGATIVE_INFINITY

async function ensureOverlay($: EngineInterface): Promise<boolean> {
  if (await isOverlayUp($)) return true
  const now = await $.clock.now()
  if (now - lastOverlayStart < OVERLAY_RESTART_MS) return false
  lastOverlayStart = now
  await startOverlay($)
  for (let waited = 0; waited < OVERLAY_WAIT_MS; waited += 300) {
    if (await isOverlayUp($)) {
      await pushOverlay($)
      return true
    }
    await $.clock.sleep(300).catch(() => undefined)
  }
  return false
}

// What needs you: Narsil's window pops up and, unless muted, she says it
// aloud. With the window on, the window is the only place it shows (started
// again when it is down), never a system notification as well; with the
// window off, a system notification is.
// `phoneText`: a longer text for the phone, which has room for more.
async function announce($: EngineInterface, kind: EventKind, title: string, text: string, voice: string, force = false, phoneText = text): Promise<void> {
  const { isMuted, isFloating, isQuiet } = await read($, prefs)
  // Quiet: no voice, and only what needs you (a question, an error) is told.
  if (isQuiet && kind === 'done' && !force) return
  const spoken = isMuted || isQuiet ? Promise.resolve() : speak($, voice)
  if (isFloating) {
    if (!(await postEvent($, kind, title, text, force)) && (await ensureOverlay($))) {
      await postEvent($, kind, title, text, force)
    }
  } else {
    await notify($, `Narsil · ${title}`, text)
  }
  await sendToPhone($, kind, title, phoneText)
  await spoken
}

// Whether you last wrote through Remote Control (your phone, the web) rather
// than at the desk, in any conversation: no event says Remote Control is on,
// so where your messages come from tells. Kept in the store, so a
// conversation started at the desk alerts too while you write from the phone
// in another; the module variable stands in when the store fails.
const REMOTE_KEY = 'remoteOrigin'
let isRemote = false

async function noteOrigin($: EngineInterface, origin: { kind: string } | undefined): Promise<void> {
  const next = origin?.kind === 'bridge' ? true : origin?.kind === 'composer' ? false : null
  if (next === null) return
  isRemote = next
  await $.store.set(REMOTE_KEY, { isRemote: next, at: await $.clock.now() }).catch(() => undefined)
}

async function isAway($: EngineInterface): Promise<boolean> {
  const saved = (await $.store.get(REMOTE_KEY).catch(() => undefined)) as { isRemote?: unknown } | undefined
  return typeof saved?.isRemote === 'boolean' ? saved.isRemote : isRemote
}

// Every open conversation, this one fresh, the most important first.
async function fleetNow($: EngineInterface): Promise<FleetSession[]> {
  return fleetOf(await read($, sessions), await ownEntry($))
}

// The same alert on your phone, through ntfy.sh, when /narsil movil is on and
// you write from away (`force`: the test, wherever you are): at most
// PHONE_DAILY a day across every conversation, the free plan's room. It
// lists every conversation open as it goes. Returns whether it went.
async function sendToPhone($: EngineInterface, kind: EventKind, title: string, text: string, force = false): Promise<boolean> {
  const stage = stageOf(levelOf(await read($, xp)).level)
  const fleet = fleetText((await fleetNow($)).map(s => ({ title: s.title, label: STATUS_LABEL[s.status] })))
  const where = await titleOf($)
  return postToPhone($, (topic, isLast) => phoneMessage(topic, kind, title, text, where, stage, isLast, fleet), force)
}

// What only the PC can tell the Firefox extension: on its own topic, as the
// turn ends and with each question, under the same rules and daily count as
// the alerts. Narsil's level, her art in the most important conversation's
// pose, when it went, how long a cache lasts, and ntfy.sh's count of the
// day's messages, this one included: read only once it is going.
async function sendStatus($: EngineInterface, force = false): Promise<boolean> {
  const list = await fleetNow($)
  const earned = await read($, xp)
  const state = {
    xp: xpLabel(earned),
    art: artUrl(POSE[list[0]!.status], stageOf(levelOf(earned).level)),
    at: Math.floor((await $.clock.now()) / 1000),
    cacheMinutes: list.map(s => s.cacheMinutes).find(m => m),
  }
  return postToPhone(
    $,
    async topic => {
      const ntfy = ntfyRow(await ntfyAccount($), 1)
      return phoneStatus(topic, { ...state, usage: ntfy ? [ntfy] : [] })
    },
    force,
  )
}

// What ntfy.sh counts of this network's messages today; undefined offline.
async function ntfyAccount($: EngineInterface): Promise<unknown> {
  try {
    const { ok, text } = await $.http.fetch(`${NTFY_URL}/v1/account`)
    return ok ? JSON.parse(String(text)) : undefined
  } catch {
    return undefined
  }
}

async function postToPhone(
  $: EngineInterface,
  message: (topic: string, isLast: boolean) => { title?: string; message: string } | Promise<{ title?: string; message: string }>,
  force: boolean,
): Promise<boolean> {
  const { phoneTopic, isPhoneOn, phoneKey } = await read($, prefs)
  if (!isPhoneOn || !phoneTopic || (!force && !(await isAway($)))) return false
  const day = dayOf(await $.clock.now())
  const count = countOf(await $.store.get(PHONE_KEY).catch(() => undefined), day)
  if (count.sent >= PHONE_DAILY) return false
  const isLast = count.sent + 1 === PHONE_DAILY
  try {
    const m = await message(phoneTopic, isLast)
    const { ok } = await $.http.fetch(NTFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(phoneKey ? sealedMessage(m, await seal(phoneKey, sealedPayload(m))) : m),
    })
    if (!ok) return false
  } catch {
    return false
  }
  await $.store.set(PHONE_KEY, { day, sent: count.sent + 1 }).catch(() => undefined)
  return true
}

// /narsil movil [on|off|nuevo|prueba|clave [off]]: undefined for any other
// command.
async function phoneCommand($: EngineInterface, arg: string): Promise<string | undefined> {
  const [word, ...words] = arg.split(' ')
  const rest = words.join(' ')
  if (word !== 'movil' && word !== 'móvil') return undefined
  const save = async (patch: Partial<Prefs>) => {
    const saved = await update($, prefs, p => ({ ...p, ...patch }))
    await $.store.set(PREFS_KEY, saved).catch(() => undefined)
    return saved
  }
  if (rest === 'off') {
    await save({ isPhoneOn: false })
    return 'Narsil: avisos al móvil desactivados. /narsil movil on los vuelve a activar con el mismo tema.'
  }
  if (rest === 'nuevo') {
    const { phoneTopic } = await save({ phoneTopic: newTopic(crypto.randomUUID()), isPhoneOn: true })
    return `Narsil: tema nuevo, el anterior ya no recibe nada. ${phoneHelp(phoneTopic ?? '')}`
  }
  if (rest === 'prueba') {
    if (!(await read($, prefs)).isPhoneOn) return 'Narsil: los avisos al móvil están desactivados; actívalos con /narsil movil.'
    const went = await sendToPhone($, 'done', 'Así te aviso en el móvil', 'Te escribiré aquí cuando termine, te necesite o algo falle.', true)
    if (went) await sendStatus($, true)
    return went ? 'Narsil: aviso de prueba enviado al móvil.' : 'Narsil: no pude enviar el aviso (sin conexión, o ya llegué al límite de hoy).'
  }
  if (rest === 'clave') {
    const { phoneKey } = await save({ phoneKey: newKey() })
    return (
      `Narsil: a partir de ahora cifro lo que envío al tema con la clave ${phoneKey} . Ponla en las opciones de la extensión de Firefox para leerlo. ` +
      'La app ntfy no puede descifrarlo: si la usas, /narsil movil clave off vuelve a enviarlo sin cifrar. /narsil movil clave crea otra clave.'
    )
  }
  if (rest === 'clave off') {
    await save({ phoneKey: null })
    return 'Narsil: ya no cifro lo que envío al móvil; la app ntfy vuelve a leerlo.'
  }
  if (rest !== '' && rest !== 'on') return 'Uso: /narsil movil [on | off | nuevo | prueba | clave [off]]'
  const p = await read($, prefs)
  const { phoneTopic } = await save({ phoneTopic: p.phoneTopic ?? newTopic(crypto.randomUUID()), isPhoneOn: true })
  const today = countOf(await $.store.get(PHONE_KEY).catch(() => undefined), dayOf(await $.clock.now()))
  return (
    `Narsil: avisos al móvil activados (hoy ${today.sent} de ${PHONE_DAILY}). Mientras me escribes por Remote Control, en cualquier conversación, te aviso cuando una termina, te necesita o falla, con la lista de todas; en cuanto escribes en el escritorio no te envío nada. ` +
    `${phoneHelp(phoneTopic ?? '')} /narsil movil prueba envía uno; /narsil movil off los apaga.`
  )
}

// The last test run failed: the next one that passes is a recovery.
let areTestsFailing = false

// One tool can raise both a permission ask and its own question.
let lastQuestionAt = 0

// The desktop app's next-step box asks its question as the turn ends, with
// nothing left waiting in the turn: the tool that fills it carries it as
// `ask`, and the turn's end then alerts as a question instead of a finish.
const ASK_BOX_TOOL = 'mcp__ccd_turn__wrap_up'
let turnAsk: string | null = null

async function announceQuestion($: EngineInterface, text: string): Promise<void> {
  const now = await $.clock.now()
  if (now - lastQuestionAt < 3000) return
  lastQuestionAt = now
  await announce($, 'question', 'Te necesito', text, say('question'))
  // The app shows her waiting, not the state of the last turn.
  await sendStatus($)
}

// Mirrors the stored mood so the streaming hook writes only on a change.
let current: Mood = 'idle'

// `line`: Narsil's own aside, when the moment calls for a given one.
async function setMood($: EngineInterface, mood: Mood, detail = '', line = pick(mood)): Promise<void> {
  current = mood
  const next: Pet = { mood, line, detail }
  await update($, pet, () => next)
  await pushOverlay($)
}

// What each surface (terminal, desktop, vscode, mobile) has asked of Narsil:
// when it joined the session and when it last asked to draw the band.
// `/narsil estado` shows it, to tell a surface that never asks (it cannot
// show her) from one that asks and still shows nothing. Module variables: a
// reload starts them over.
const joinedAt = new Map<string, number>()
const askedAt = new Map<string, number>()

async function surfaceReport($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const attached: readonly string[] = await $.session.surfaces().catch(() => [])
  const names = [...new Set([...attached, ...joinedAt.keys(), ...askedAt.keys()])]
  if (names.length === 0) return 'Superficies: ninguna conectada.'
  const parts = names.map(name => {
    const asked = askedAt.get(name)
    const state = attached.includes(name) ? '' : ' (desconectada)'
    return `${name}${state}: ${asked === undefined ? 'nunca ha pedido la banda' : `pidió la banda ${ago(now - asked)}`}`
  })
  return `Superficies: ${parts.join(' · ')}`
}

async function setUsage($: EngineInterface, next: Usage): Promise<void> {
  if (JSON.stringify(await read($, usage)) === JSON.stringify(next)) return
  if (next.context) await trackContext($, next.context.percent)
  await update($, usage, () => next)
  // Kept current for every conversation to open: estimated locally, no request.
  if (next.context) await readContextDetail($).catch(() => undefined)
  await pushOverlay($)
}

// The breakdown as /context counts it, estimated locally: no request is sent.
async function readContextDetail($: EngineInterface): Promise<void> {
  const spent = await $.session.usage({ breakdown: 'summary' })
  const b = spent.context.breakdown
  if (!b) return
  const detail = contextDetailOf(b, await $.clock.now())
  await update($, contextDetail, () => detail)
}

// A press on the open conversation's percent shows what fills its context,
// with its tokens and when it fills, and another goes back. This
// conversation's own is read afresh; unread, the tokens still show.
async function toggleContextDetail($: EngineInterface, isOwn: boolean): Promise<void> {
  const v = await read($, fleetView)
  if (v.isContext) {
    await update($, fleetView, w => ({ ...w, isContext: false }))
    return
  }
  if (isOwn) {
    try {
      await readContextDetail($)
    } catch {
      $.ui.toast('Narsil: no pude leer el detalle del contexto.')
    }
  }
  await update($, fleetView, w => ({ ...w, isContext: true }))
}

// How fast the context window fills: its readings, the estimate they give,
// and whether Narsil has already suggested /compact for this fill. Module
// variables: a reload starts them over.
const MAX_SAMPLES = 30
const NUDGE_AT = 70
const NUDGE_ALWAYS_AT = 85
const NUDGE_WITHIN_MINUTES = 20
// Below this the context was compacted or cleared: a new fill, a new nudge.
const NUDGE_RESET_BELOW = 50
let contextSamples: ContextSample[] = []
let contextToFull: number | null = null
let isCompactNudged = false

async function trackContext($: EngineInterface, percent: number): Promise<void> {
  const now = await $.clock.now()
  const last = contextSamples.at(-1)
  // It shrank: compacted or cleared, so the old pace means nothing now.
  if (last && percent < last.percent) contextSamples = []
  if (percent < NUDGE_RESET_BELOW) isCompactNudged = false
  remember(contextSamples, { at: now, percent }, MAX_SAMPLES)
  contextToFull = minutesToFull(contextSamples, now)

  const isNear = contextToFull !== null && contextToFull <= NUDGE_WITHIN_MINUTES
  if (isCompactNudged || percent < NUDGE_AT || !(isNear || percent >= NUDGE_ALWAYS_AT)) return
  if (!(await read($, prefs)).isAdviceOn) return
  isCompactNudged = true
  const when = contextToFull !== null ? ` y se llenará en ~${minutesLabel(contextToFull)}` : ''
  await showTip($, `El contexto va al ${Math.round(percent)} %${when}: es buen momento para /compact.`, 'context')
}

// Narsil's tips. What she has seen of the work (advice.ts), and how often she
// may speak up unasked: module variables, which a reload resets harmlessly.
const TIP_SHOWN_MS = 3 * 60_000
const TIP_KEPT_MS = 15 * 60_000
const LONG_TURN_MS = 3 * 60_000
const TIPS_PER_DAY = 20
const RECENT_TIPS = 5

const seen = emptyContext()
const recentTips: string[] = []
let turnStartedAt = 0
let failuresByTool = new Map<string, number>()
let failuresThisTurn = 0
// The automatic kinds already tried this turn: each at most once.
let triedThisTurn = new Set<TipKind>()
let lastAutoAt: number | null = null
let lastAutoKind: TipKind | null = null
let tipDay = -1
let tipsToday = 0

// Whether an automatic tip may be asked for now; if so, it counts.
async function mayTip($: EngineInterface, kind: TipKind): Promise<boolean> {
  const p = await read($, prefs)
  if (!p.isAdviceOn || p.isQuiet) return false
  const now = await $.clock.now()
  const today = Math.floor(now / 86_400_000)
  if (today !== tipDay) {
    tipDay = today
    tipsToday = 0
  }
  if (tipsToday >= TIPS_PER_DAY) return false
  // The same kind twice in a row waits twice as long.
  const every = Math.max(1, p.adviceEveryMinutes) * 60_000 * (kind === lastAutoKind ? 2 : 1)
  if (lastAutoAt !== null && now - lastAutoAt < every) return false
  lastAutoAt = now
  tipsToday += 1
  return true
}

// A git command's output in the session's folder; empty outside a repository,
// without git, or when it fails.
async function git($: EngineInterface, args: string[]): Promise<string> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', '--no-pager', ...args], { timeoutMs: 5000 })
    return exitCode === 0 ? stdout.trim() : ''
  } catch {
    return ''
  }
}

// What the work changed: the uncommitted diff, or the last commit when the
// turn committed it all.
async function readDiff($: EngineInterface): Promise<string> {
  const pending = await git($, ['diff', 'HEAD', '--stat', '--patch', '--unified=2'])
  if (pending) return pending
  return git($, ['show', 'HEAD', '--stat', '--patch', '--unified=2', '--format=%s'])
}

// Where the project stands: recent commits, uncommitted files, and the
// unfinished tasks of its task files (odd/tasks/*.md), when it has any.
async function readProject($: EngineInterface): Promise<string> {
  const parts: string[] = []
  const log = await git($, ['log', '--oneline', '--no-decorate', '-10'])
  if (log) parts.push(`Commits recientes:\n${log}`)
  const status = await git($, ['status', '--short'])
  if (status) parts.push(`Sin commit:\n${status}`)
  try {
    const files = (await $.fs.list('odd/tasks')).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
    for (const f of files.slice(0, 5)) {
      const text = await $.fs.read(`odd/tasks/${f.name}`)
      const pending = typeof text === 'string' ? pendingTasks(text) : []
      if (pending.length > 0) parts.push(`Tareas pendientes (${f.name}):\n${pending.map(t => `- ${t}`).join('\n')}`)
    }
  } catch {
    // no task files
  }
  return parts.join('\n')
}

// One small completion over what Narsil has seen; null when she has nothing
// useful to say or the call failed.
async function askTip($: EngineInterface, kind: TipKind): Promise<string | null> {
  try {
    seen.diff = kind === 'review' || kind === 'asked' ? await readDiff($) : ''
    const reply = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: prompt(describe(seen, kind), recentTips),
      effort: 'medium',
      maxTokens: 2000,
      timeoutMs: 30_000,
    })
    return reply.isAnswered ? parse(reply.text) : null
  } catch {
    return null
  }
}

// On Windows and macOS a tip opens whole in a window of its own (overlay/tip.ps1,
// overlay/tip.sh), above the floating window or in a corner of the screen, and
// closes by itself once its time in the band would be up. True when it opened.
async function openTipWindow($: EngineInterface, text: string): Promise<boolean> {
  const os = await platformOf($)
  if (os === 'other') return false
  return launch($, 'tip', {
    NARSIL_TEXT: text,
    NARSIL_LINK: conversationLink(),
    NARSIL_STAGE: String(stageOf(levelOf(await read($, xp)).level)),
    NARSIL_SECONDS: String(TIP_SHOWN_MS / 1000),
    NARSIL_ASSETS: os === 'windows' ? `${$.plugin.root.replace(/\//g, '\\')}\\assets` : `${$.plugin.root}/assets`,
    // macOS asks it where the floating window is; Windows finds it itself
    NARSIL_OVERLAY: OVERLAY,
  })
}

// 'context': the /compact suggestion, which is not the model's.
async function showTip($: EngineInterface, text: string, kind: TipKind | 'context' | 'summary'): Promise<void> {
  remember(recentTips, text, RECENT_TIPS)
  const at = await $.clock.now()
  const isWindowed = await openTipWindow($, text)
  await update($, tip, () => ({ text, kind, at, isWindowed }))
  $.ui.log(`💡 ${text}`)
  await pushOverlay($)
}

async function autoTip($: EngineInterface, kind: TipKind): Promise<void> {
  if (triedThisTurn.has(kind)) return
  triedThisTurn.add(kind)
  if (!(await mayTip($, kind))) return
  const text = await askTip($, kind)
  if (!text) return
  lastAutoKind = kind
  await showTip($, text, kind)
  const { isAdviceSpoken, isMuted } = await read($, prefs)
  if (kind === 'review' && isAdviceSpoken && !isMuted) await speak($, text)
}

// Never awaited by the hook that triggers it: a tip must not slow the turn.
function tipLater($: EngineInterface, kind: TipKind): void {
  void autoTip($, kind).catch(() => undefined)
}

async function askedTip($: EngineInterface, isDeep: boolean): Promise<string> {
  let text: string | null = null
  let why = 'ahora mismo no tengo un consejo útil que darte'
  if (isDeep) {
    try {
      const reply = await $.model.fork({ prompt: forkPrompt(recentTips) })
      if (reply.isAnswered) text = parse(reply.text)
      else if (reply.reason === 'nothing-to-fork') why = 'todavía no hay conversación que mirar'
      else why = 'no he podido pensar el consejo ahora'
    } catch {
      why = 'no he podido pensar el consejo ahora'
    }
  } else {
    text = await askTip($, 'asked')
  }
  if (!text) return `Narsil: ${why}.`
  await showTip($, text, 'asked')
  return `Narsil: 💡 ${text}`
}

async function setAdvice($: EngineInterface, patch: Partial<Prefs>): Promise<Prefs> {
  const saved = await update($, prefs, p => ({ ...p, ...patch }))
  await $.store.set(PREFS_KEY, saved).catch(() => undefined)
  return saved
}

// `/narsil consejo …` and `/narsil consejos …`; undefined for any other words.
async function adviceCommand($: EngineInterface, arg: string): Promise<string | undefined> {
  if (arg === 'consejo') return askedTip($, false)
  if (arg === 'consejo profundo') return askedTip($, true)
  if (arg === 'consejos on') {
    await setAdvice($, { isAdviceOn: true })
    return 'Narsil: consejos activados.'
  }
  if (arg === 'consejos off') {
    await setAdvice($, { isAdviceOn: false })
    await update($, tip, () => null)
    return 'Narsil: consejos desactivados (aún puedes pedirme uno con /narsil consejo).'
  }
  if (arg === 'consejos voz') {
    const p = await setAdvice($, { isAdviceSpoken: !(await read($, prefs)).isAdviceSpoken })
    return `Narsil: ${p.isAdviceSpoken ? 'diré en voz alta' : 'ya no diré en voz alta'} los consejos de fin de turno.`
  }
  const every = /^consejos cada (\d{1,4})$/.exec(arg)
  if (every) {
    const minutes = Math.min(1440, Math.max(1, Number(every[1])))
    await setAdvice($, { adviceEveryMinutes: minutes })
    return `Narsil: como mucho un consejo cada ${minutes} min.`
  }
  if (arg.startsWith('consejo')) return 'Uso: /narsil consejo [profundo] | consejos on | off | cada <min> | voz'
  return undefined
}

// --- Subagents ---

// Redraws the chips when what they say has changed, and lets the ended runs go.
async function refreshAgents($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const runs = await read($, agents)
  const live = liveRuns(runs, now)
  if (live.length !== runs.length) await update($, agents, () => live)
  const next = live.map(r => {
    const { text, tone } = agentChip(r, now)
    return { text, color: TONE_COLOR[tone] }
  })
  if (JSON.stringify(next) === JSON.stringify(await read($, agentChips))) return
  await update($, agentChips, () => next)
  await pushOverlay($)
}

async function touchAgent($: EngineInterface, id: string): Promise<void> {
  const now = await $.clock.now()
  if (!(await read($, agents)).some(r => r.id === id && r.endedAt === undefined)) return
  await update($, agents, runs => runs.map(r => (r.id === id ? { ...r, lastActiveAt: now } : r)))
  await refreshAgents($)
}

// A subagent's own turn ended: how it went shows for a few seconds, and one
// that ran in the background, while nobody watched it, is announced.
async function endAgent($: EngineInterface, id: string, reason: string): Promise<void> {
  const ending = (await read($, agents)).find(r => r.id === id && r.endedAt === undefined)
  if (!ending) return
  const now = await $.clock.now()
  const outcome = reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed'
  await update($, agents, runs => runs.map(r => (r.id === id ? { ...r, endedAt: now, outcome } : r)))
  await refreshAgents($)
  if (outcome === 'done') await gainXp($, 'agent')
  if (ending.isBackground) {
    const { text } = agentChip({ ...ending, endedAt: now, outcome }, now)
    await announce($, outcome === 'done' ? 'done' : 'error', 'Un subagente ha terminado', text, say(outcome === 'done' ? 'agentDone' : 'agentStopped'))
  }
}

// --- The prompt cache's clock and the next steps ---

// How long the prompt cache lasts, in minutes: on a plan Claude Code keeps it
// an hour, with an API key five minutes. The API does not say which: a
// person who knows better sets it with /narsil cache.
const PLAN_CACHE_MINUTES = 60
const API_CACHE_MINUTES = 5
// How long after a finished turn Narsil offers next steps.
const STEPS_AFTER_MS = 15 * 60_000

let stepsAskedFor: number | null = null
// When this conversation's own last model request started; null before its
// first one. A subagent's requests have a cache of their own.
let lastRequestAt: number | null = null

async function cacheMinutes($: EngineInterface): Promise<number> {
  const set = (await read($, prefs)).cacheMinutes
  if (set) return set
  const spent = await read($, usage)
  return spent.fiveHour || spent.week ? PLAN_CACHE_MINUTES : API_CACHE_MINUTES
}

// A turn just ended, now: what waits on an idle conversation counts from
// here, and the cache from the start of the turn's last request.
async function startCache($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  const requestAt = lastRequestAt ?? at
  const minutes = await cacheMinutes($)
  await update($, cache, () => ({ at, requestAt, minutes, left: cacheLeft(requestAt, minutes, at) }))
}

// On every heartbeat: count the cache down, and offer next steps once the
// turn has been over long enough.
async function tickCache($: EngineInterface): Promise<void> {
  const c = await read($, cache)
  if (!c) return
  const now = await $.clock.now()
  const left = cacheLeft(cacheStart(c), c.minutes, now)
  if (left !== c.left) await update($, cache, k => (k ? { ...k, left } : k))
  if (now - c.at >= STEPS_AFTER_MS) void offerSteps($, c.at).catch(() => undefined)
}

// One small completion for what to ask next, once per finished turn.
async function offerSteps($: EngineInterface, at: number): Promise<void> {
  if (backgroundAtStop > 0 || stepsAskedFor === at || (await read($, steps))?.at === at) return
  stepsAskedFor = at
  const { isNextStepsOn, isQuiet } = await read($, prefs)
  if (!isNextStepsOn || isQuiet) return
  try {
    seen.diff = await readDiff($)
    seen.project = await readProject($)
    const reply = await $.model.complete({
      model: 'haiku',
      system: STEPS_SYSTEM,
      prompt: stepsPrompt(describe(seen, 'steps')),
      effort: 'medium',
      maxTokens: 2000,
      timeoutMs: 30_000,
    })
    const items = reply.isAnswered ? parseSteps(reply.text) : []
    // A turn that started meanwhile makes them stale.
    if (items.length === 0 || (await read($, cache))?.at !== at) return
    await update($, steps, () => ({ at, items }))
    // The steps close every conversation: the band shows them alone.
    await update($, fleetView, w => ({ ...w, open: null, isContext: false }))
    $.ui.log(`➜ Narsil propone: ${items.join(' · ')}`)
    await pushOverlay($)
  } catch {
    // no steps this time
  }
}

// A step picked: it goes to the prompt box as the draft, for you to send.
async function pickStep($: EngineInterface, step: string): Promise<void> {
  await $.prompt.fill({ text: step })
  await update($, steps, () => null)
  await pushOverlay($)
}

// --- A permission left waiting, and the session's summary ---

// What waits for you now, a permission or a question, since when, and whether
// Narsil has already insisted.
let waiting: { since: number; what: string; isNudged: boolean } | null = null
// The finished turn (its cache clock's start) already summed up.
let summarizedFor: number | null = null

// The store key of this conversation's counts ('' when its id is unknown),
// and whether the counts of old conversations were already cleared away.
let statsKey = ''
let isStatsPruned = false

async function bumpStats($: EngineInterface, change: (s: Stats) => Stats): Promise<void> {
  const now = await $.clock.now()
  await update($, stats, s => change(s ?? emptyStats(now)))
  await saveStats($)
}

// Takes up this conversation's counts where they were left, when Claude Code
// was closed with it open; a reload of the mod keeps them in $.state anyway.
async function loadStats($: EngineInterface): Promise<void> {
  let id = ''
  try {
    id = await $.session.id()
  } catch {
    // no id: the counts start over with each session
  }
  statsKey = id ? `${STATS_PREFIX}${id}` : ''
  if (!statsKey || (await read($, stats))) return
  const kept = statsOf(await $.store.get(statsKey).catch(() => undefined))
  if (kept) await update($, stats, s => s ?? kept)
}

async function saveStats($: EngineInterface): Promise<void> {
  if (!statsKey) return
  await $.store.set(statsKey, await read($, stats)).catch(() => undefined)
  if (isStatsPruned) return
  isStatsPruned = true
  try {
    // Oldest first: the store lists its keys in the order they were set.
    const others = (await $.store.keys()).filter(key => key.startsWith(STATS_PREFIX) && key !== statsKey)
    for (const key of others.slice(0, Math.max(0, others.length - (KEEP_STATS - 1)))) await $.store.delete(key)
  } catch {
    // a store that cannot list or delete keeps them all
  }
}

async function startWaiting($: EngineInterface, what: string): Promise<void> {
  waiting = { since: await $.clock.now(), what, isNudged: false }
}

function stopWaiting(): void {
  waiting = null
}

// Background work (a shell, a monitor, a background subagent) still running
// as the main loop stopped: the turn ended, but the work did not. It wakes
// the session again when it reports, so the finish waits for that turn.
let backgroundAtStop = 0
// That work, as tasks of this conversation.
let background: readonly TaskItem[] = []

function backgroundText(n: number): string {
  return n === 1 ? 'esperando 1 proceso en segundo plano' : `esperando ${n} procesos en segundo plano`
}

async function summarize($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const s = (await read($, stats)) ?? emptyStats(now)
  return summaryText(s, now, (await read($, usage)).context?.percent ?? null)
}

// On every heartbeat: insist once on what has waited too long, and sum the
// session up once it has been quiet for a while after a turn.
async function tickWatch($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (waiting && !waiting.isNudged && now - waiting.since >= NUDGE_AFTER_MS) {
    waiting.isNudged = true
    const text = nudgeText(waiting.what, now - waiting.since)
    void announce($, 'question', 'Sigo esperándote', text, say('stillWaiting'), true).catch(() => undefined)
  }
  const c = await read($, cache)
  if (c && backgroundAtStop === 0 && summarizedFor !== c.at && now - c.at >= IDLE_SUMMARY_MS && ((await read($, stats))?.turns ?? 0) > 0 && !(await read($, prefs)).isQuiet) {
    summarizedFor = c.at
    await showTip($, await summarize($), 'summary')
  }
}

// --- Experience ---

// Narsil gains experience. The store is read again first: another open
// conversation may have added to it since. A new level is celebrated.
async function gainXp($: EngineInterface, reason: XpReason): Promise<void> {
  const before = xpOf(await $.store.get(XP_KEY).catch(() => read($, xp)))
  const after = before + XP_GAIN[reason]
  await $.store.set(XP_KEY, after).catch(() => undefined)
  await update($, xp, () => after)
  const { level } = levelOf(after)
  const was = levelOf(before).level
  if (level > was) {
    // A new stage of her growth is told apart: she looks different from now on.
    const stage = stageOf(level)
    const grew = stage > stageOf(was)
    const at = await $.clock.now()
    await update($, milestone, () => ({ kind: grew ? ('grew' as const) : ('level' as const), level, stage, at }))
    $.ui.log(grew ? `🌊 Narsil ha crecido: nivel ${level}, etapa ${stage} de ${STAGES}.` : `⭐ Narsil ha subido al nivel ${level}.`)
    await setMood($, current, (await read($, pet)).detail, grew ? `¡He crecido! Nivel ${level}, etapa ${stage} de ${STAGES} 🌊` : `¡He subido al nivel ${level}! ⭐`)
  }
}

// `/narsil pasos …` and `/narsil cache …`; undefined for any other words.
async function stepsCommand($: EngineInterface, arg: string): Promise<string | undefined> {
  if (arg === 'pasos on' || arg === 'pasos off') {
    const isOn = arg === 'pasos on'
    await setAdvice($, { isNextStepsOn: isOn })
    if (!isOn) await update($, steps, () => null)
    return `Narsil: próximos pasos ${isOn ? 'activados' : 'desactivados'}.`
  }
  const set = /^cach[eé](?: (auto|\d{1,3}))?$/.exec(arg)
  if (!set) return undefined
  if (set[1]) await setAdvice($, { cacheMinutes: set[1] === 'auto' ? null : Math.min(1440, Math.max(1, Number(set[1]))) })
  const minutes = await cacheMinutes($)
  const now = await $.clock.now()
  const c = await read($, cache)
  if (c) await update($, cache, () => ({ ...c, minutes, left: cacheLeft(cacheStart(c), minutes, now) }))
  return `Narsil: la caché dura ${minutes} min${(await read($, prefs)).cacheMinutes ? '' : ' (según tu cuenta; cámbialo con /narsil cache <min>)'}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    lastRequestAt = null
    await $.command.register({
      name: 'narsil',
      description:
        'Narsil, tu mascota: estado | ocultar | mostrar | silencio | voz | discreto | normal | flotante | prueba | consejo [profundo] | consejos on|off|cada <min>|voz | pasos on|off | cache [auto|<min>] | resumen | nivel | movil [on|off|nuevo|prueba|clave [off]]',
    })
    const saved = (await $.store.get(PREFS_KEY).catch(() => undefined)) as Partial<Prefs> | undefined
    if (saved && typeof saved === 'object') {
      await update($, prefs, p => ({ ...p, ...saved }))
      if (!(await $.store.get(ADVICE_MIGRATED_KEY).catch(() => true))) {
        if (saved.adviceEveryMinutes === OLD_ADVICE_EVERY_MINUTES) await setAdvice($, { adviceEveryMinutes: ADVICE_EVERY_MINUTES })
        await $.store.set(ADVICE_MIGRATED_KEY, true).catch(() => undefined)
      }
    }
    hostSession = (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID').catch(() => undefined)) ?? ''
    const spent = await $.session.usage().catch(() => undefined)
    if (spent) await setUsage($, usageOf(spent))
    sessionTitle = basename(await $.session.cwd().catch(() => e.cwd))
    // The stats survive a reload of the mod, and Claude Code restarting with
    // this conversation: only a new conversation starts them.
    await loadStats($)
    await readModel($)
    if (!(await read($, stats))) await bumpStats($, s => s)
    const earned = xpOf(await $.store.get(XP_KEY).catch(() => 0))
    await update($, xp, () => earned)
    // A new conversation: Narsil is happy to see you.
    await setMood($, 'greeting')

    // The hub serves every conversation to the others; its floating window
    // shows itself while Claude is minimized or an event waits for you. The
    // heartbeat keeps it in sync, and it closes itself once the beats stop.
    $.clock.after(10, () => startOverlay($))
    $.clock.every(2000, () => beat($))

    return next(e)
  })

  on('command.run', { command: 'narsil' }, async ($, e) => {
    await noteOrigin($, e.origin)
    const arg = e.args.trim().toLowerCase().replace(/\s+/g, ' ')
    const advice = await adviceCommand($, arg)
    if (advice !== undefined) return { text: advice }
    const stepped = await stepsCommand($, arg)
    if (stepped !== undefined) return { text: stepped }
    const phoned = await phoneCommand($, arg)
    if (phoned !== undefined) return { text: phoned }
    if (arg === 'resumen') return { text: `Narsil: ${await summarize($)}` }
    if (arg === 'nivel') {
      const now = await read($, xp)
      return { text: `Narsil: ${xpLabel(now)} · etapa ${stageOf(levelOf(now).level)} de ${STAGES}. Gano experiencia con cada turno terminado, cada vez que los tests pasan y con cada subagente que termina bien, y crezco en los niveles ${STAGE_FROM.slice(1).join(', ')}.` }
    }
    const change: Record<string, Partial<Prefs>> = {
      ocultar: { isHidden: true },
      mostrar: { isHidden: false },
      silencio: { isMuted: true },
      voz: { isMuted: false },
      discreto: { isQuiet: true },
      normal: { isQuiet: false },
    }
    if (arg === 'prueba') {
      await setMood($, 'celebrating', 'prueba')
      // A test shows the popup even while you look at Claude.
      await announce($, 'done', 'Así te avisaré', 'Haz clic para volver a esta conversación.', 'Hola, soy Narsil. Así sonaré cuando termine.', true)
      return { text: 'Narsil: prueba de aviso y voz lanzada.' }
    }
    if (arg === 'estado') {
      await beat($)
      const counted = fleetSummary(countOfStates(await fleetNow($)))
      const s = await read($, pet)
      return {
        text:
          `Narsil: ${STATUS_LABEL[statusOf(s.mood)]} · ${headline(s.mood, s.detail)}.\n` +
          `${counted || 'Esta es la única conversación abierta.'}\n${await surfaceReport($)}`,
      }
    }
    if (arg === 'flotante') {
      const saved = await update($, prefs, p => ({ ...p, isFloating: !p.isFloating }))
      await $.store.set(PREFS_KEY, saved).catch(() => undefined)
      if (saved.isFloating) {
        await startOverlay($)
        await setWindow($, true)
        await pushOverlay($)
        return { text: 'Narsil: ventana flotante activada (aparece con Claude minimizado o cuando algo te espera).' }
      }
      await setWindow($, false)
      return { text: 'Narsil: ventana flotante desactivada (los avisos irán como notificación del sistema).' }
    }
    const patch = change[arg]
    if (!patch) {
      const p = await read($, prefs)
      return {
        text:
          `Narsil está ${p.isHidden ? 'oculta' : 'visible'}, con la voz ${p.isMuted ? 'apagada' : 'encendida'} ` +
          `y la ventana flotante ${p.isFloating ? 'activada' : 'desactivada'}.\n` +
          ((await read($, mainModel)) ? `Modelo del hilo principal: ${await read($, mainModel)}.\n` : '') +
          `Consejos ${p.isAdviceOn ? `activados (como mucho uno cada ${p.adviceEveryMinutes} min)` : 'desactivados'}` +
          `${p.isAdviceSpoken ? ', dichos en voz alta' : ''}.\n` +
          `Próximos pasos ${p.isNextStepsOn ? 'activados' : 'desactivados'}; la caché dura ${await cacheMinutes($)} min.\n` +
          (p.isQuiet ? 'Modo discreto activado: sin voz, sin avisos de fin de turno ni consejos o pasos automáticos.\n' : '') +
          'Uso:/narsil estado | ocultar | mostrar | silencio | voz | discreto | normal | flotante | prueba | consejo [profundo] | consejos on|off|cada <min>|voz | pasos on|off | cache [auto|<min>] | resumen | nivel | movil [on|off|nuevo|prueba|clave [off]]',
      }
    }
    const saved = await update($, prefs, p => ({ ...p, ...patch }))
    await $.store.set(PREFS_KEY, saved).catch(() => undefined)
    if (arg === 'discreto') {
      return { text: 'Narsil: modo discreto activado. Sin voz, sin avisos de fin de turno y sin consejos ni próximos pasos automáticos; solo te aviso si te necesito o hay un error. /narsil normal lo devuelve todo.' }
    }
    if (arg === 'normal') return { text: 'Narsil: modo normal. Vuelven la voz, los avisos, los consejos y los próximos pasos como los tenías.' }

    return { text: `Narsil: hecho (${arg}).` }
  })

  // The engine measures after each turn and when a limit moves a point.
  on('session.measure', async ($, e, next) => {
    await setUsage($, usageOf(e))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turnStartedAt = await $.clock.now()
      seen.touched = new Map()
      seen.durationMs = 0
      seen.answer = ''
      failuresByTool = new Map()
      failuresThisTurn = 0
      triedThisTurn = new Set()
      turnAsk = null
      backgroundAtStop = 0
      background = []
      stopWaiting()
      await update($, cache, () => null)
      await update($, steps, () => null)
      await setMood($, 'thinking')
      // A prompt of yours starts the work aloud; a continuation does not.
      const { isMuted, isQuiet } = await read($, prefs)
      if (e.text.trim() && !isMuted && !isQuiet) void speak($, say('start')).catch(() => undefined)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta) seen.prompt = e.text.slice(0, 400)
    await noteOrigin($, e.origin)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) lastRequestAt = await $.clock.now()
    for await (const chunk of next(e)) {
      if (chunk.kind === 'thinking' && current !== 'thinking') {
        void setMood($, 'thinking').catch(() => undefined)
      } else if (chunk.kind === 'text' && e.agentId === undefined && current !== 'talking') {
        void setMood($, 'talking').catch(() => undefined)
      }
      yield chunk
    }
  })

  // A permission you have to decide. Not `tool.check`: its `ask` comes before
  // the mode settles it, so under "bypass permissions" (or a rule, or the
  // auto classifier) it would cry wolf. The engine raises PermissionRequest
  // only when it is about to show you the dialog.
  on('classic.PermissionRequest', async ($, e, next) => {
    const result = await next(e)
    // A settings hook already answered it: nobody is asked.
    const isDecided = result.decision !== undefined || e.permission_mode === 'bypassPermissions'
    if (!isDecided && !ASKING_TOOLS.has(e.tool_name)) {
      await setMood($, 'asking', `pido permiso para usar ${e.tool_name}`)
      await startWaiting($, `pido permiso para usar ${e.tool_name}.`)
      await announceQuestion($, `Pido permiso para usar ${e.tool_name}.`)
    }

    return result
  })

  on('tool.call', async ($, e, next) => {
    // Another mod's own call (narsil-check reads its session at start) is
    // not Claude's work.
    if (!isClaudesCall(next.origin)) return next(e)
    if (e.tool === ASK_BOX_TOOL) {
      const ask = (e as { ask?: unknown }).ask
      turnAsk = typeof ask === 'string' && ask.trim() ? ask.trim() : null
    }
    // The main conversation's task list, kept as its tools leave it.
    if (TASK_TOOLS.has(e.tool) && e.agentId === undefined) {
      const result = await next(e)
      if (!result.isError && !('deny' in result && result.deny)) {
        await update($, tasks, list => applyTaskCall(list, e.tool, e as unknown as Record<string, unknown>, 'result' in result ? result.result : undefined))
        await pushOverlay($)
      }
      return result
    }
    if (ASKING_TOOLS.has(e.tool)) {
      const isPlan = e.tool === 'ExitPlanMode'
      await setMood($, 'asking', isPlan ? 'tengo un plan para que lo apruebes' : 'tengo una pregunta para ti')
      await announceQuestion($, isPlan ? 'Tiene un plan para que lo apruebes.' : 'Tiene una pregunta para ti.')
      await startWaiting($, isPlan ? 'tengo un plan para que lo apruebes.' : 'tengo una pregunta para ti.')
      try {
        return await next(e)
      } finally {
        stopWaiting()
      }
    }
    // Another step started: whatever waited has been answered.
    stopWaiting()
    const mood = MOOD_BY_TOOL[e.tool] ?? 'running'
    const detail = describeCall(e.tool, e)
    remember(seen.calls, { tool: e.tool, detail }, MAX_CALLS)
    const isShell = SHELL_TOOLS.has(e.tool)
    if (WRITING_TOOLS.has(e.tool)) {
      const edits = (seen.touched.get(detail) ?? 0) + 1
      seen.touched.set(detail, edits)
      await bumpStats($, s => addFile(s, detail))
    }
    if (isShell) await bumpStats($, s => ({ ...s, commands: s.commands + 1 }))
    const command = isShell && typeof (e as { command?: unknown }).command === 'string' ? (e as { command: string }).command : ''
    const danger = dangerOf(command)
    if (danger) $.ui.log(`⚠️ Narsil: comando sin vuelta atrás (${danger}): ${command.split('\n')[0]!.slice(0, 120)}`)
    await setMood($, mood, detail, danger ? `⚠️ Cuidado: ${danger} no tiene vuelta atrás.` : pick(mood))
    const isTest = TEST_COMMAND.test(command)
    if (e.agentId !== undefined) await touchAgent($, e.agentId)
    const result = await next(e)
    if (result.isError) await bumpStats($, s => ({ ...s, failures: s.failures + 1 }))
    if (isTest && !result.isError) {
      await setMood($, mood, detail, areTestsFailing ? '¡Recuperados! Los tests vuelven a pasar.' : '¡Los tests pasan! 🎉')
      areTestsFailing = false
      await gainXp($, 'tests')
    }
    if (result.isError) {
      if (isTest) areTestsFailing = true
      await setMood($, 'scared', e.tool, isTest ? 'Los tests fallan; vamos a ver por qué.' : pick('scared'))
      const error = 'text' in result && typeof result.text === 'string' ? result.text : ''
      remember(seen.failures, { tool: e.tool, error: error.slice(0, 200) }, MAX_FAILURES)
      const sameTool = (failuresByTool.get(e.tool) ?? 0) + 1
      failuresByTool.set(e.tool, sameTool)
      failuresThisTurn += 1
      if (sameTool >= 2 || failuresThisTurn >= 3) tipLater($, 'debug')
    }
    if (turnStartedAt > 0 && (await $.clock.now()) - turnStartedAt > LONG_TURN_MS) tipLater($, 'pacing')

    return result
  })

  // The main loop stops: what background work is still in flight decides,
  // in turn.complete, whether the turn is a finish or a pause.
  on('classic.SessionStart', async ($, e, next) => {
    await noteTitle($, e.session_title)
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteTitle($, e.session_title)
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    backgroundAtStop = e.background_tasks?.length ?? 0
    background = backgroundTasks(e.background_tasks)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      await endAgent($, e.agentId, e.reason)
      return result
    }
    stopWaiting()
    await bumpStats($, s => ({ ...s, turns: s.turns + 1, workedMs: s.workedMs + (e.durationMs ?? 0) }))
    await startCache($)

    if (e.reason === 'answer' && turnAsk) {
      await setMood($, 'asking', 'tengo una pregunta para ti')
      await gainXp($, 'turn')
      await announce($, 'question', 'Te necesito', turnAsk, say('question'))
      await startWaiting($, 'tengo una pregunta para ti.')
      seen.durationMs = e.durationMs
      seen.answer = e.answer.slice(0, 4 * MAX_ANSWER)
      turnAsk = null
    } else if (e.reason === 'answer' && backgroundAtStop > 0) {
      await setMood($, 'running', backgroundText(backgroundAtStop))
      seen.durationMs = e.durationMs
      seen.answer = e.answer.slice(0, 4 * MAX_ANSWER)
    } else if (e.reason === 'answer') {
      const took = duration(e.durationMs)
      await setMood($, 'celebrating', `en ${took}`)
      await gainXp($, 'turn')
      // Not on a $.clock timer: a reload of the mod (which follows any turn
      // that edited it) cancels timers, and the announcement with them. It
      // starts processes of its own, so this returns within a second.
      await announce($, 'done', 'He terminado', summary(e.answer, took), say('done'), false, summary(e.answer, took, Infinity, PHONE_ROOM))
      seen.durationMs = e.durationMs
      seen.answer = e.answer.slice(0, 4 * MAX_ANSWER)
      tipLater($, 'review')
    } else if (e.reason === 'aborted') {
      await setMood($, 'idle', 'lo has detenido tú')
    } else {
      const why = e.reason === 'refusal' ? 'no pudo responder' : 'fallo de la API'
      await setMood($, 'failed', why)
      await announce($, 'error', 'Me he detenido', `El turno terminó con un error (${why}).`, say('error'))
    }
    await sendStatus($)

    return result
  })

  // A subagent starts: one chip for it, with its task and type, until its own
  // turn ends. Not the Agent tool call: one in the background returns at once.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if ('deny' in result || e.isTeammate) return result
    const now = await $.clock.now()
    const started = {
      id: result.agentId,
      task: e.description.trim() || 'tarea',
      type: e.subagentType,
      startedAt: now,
      lastActiveAt: now,
      isBackground: e.background,
      model: result.model || undefined,
    }
    await update($, agents, runs => [...runs.filter(r => r.id !== started.id), started])
    await bumpStats($, s => ({ ...s, agents: s.agents + 1 }))
    await refreshAgents($)

    return result
  })

  // A permission answered, either way: nothing waits any more.
  on('classic.PostToolUse', async ($, e, next) => {
    stopWaiting()
    return next(e)
  })
  on('classic.PostToolUseFailure', async ($, e, next) => {
    stopWaiting()
    return next(e)
  })
  on('classic.PermissionDenied', async ($, e, next) => {
    stopWaiting()
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    joinedAt.set(e.surface, await $.clock.now())

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    askedAt.set(e.surface, await $.clock.now())
    const { isHidden } = await read($, prefs)
    if (e.props.hasSurvey || isHidden) return next(e)

    const state = await read($, pet)
    const own = await ownEntry($)
    const list = fleetOf(await read($, sessions), own)
    // Narsil wears the most important conversation's state.
    const top = list[0] ?? own
    const isOwnTop = top.sessionId === own.sessionId
    const mood: Mood = top.mood in FACE ? top.mood : state.mood
    const label = STATUS_LABEL[top.status]
    const color = STATUS_COLOR[top.status]
    const title = isOwnTop ? top.headline : `${top.title || 'Otra conversación'}: ${top.headline}`
    const aside = isOwnTop ? state.line : ''
    const kept = await read($, tip)
    const shown = kept && !kept.isFaded && !kept.isWindowed ? kept : null
    // The account's limits, once: each conversation has its own context.
    const limits = usageRows({ ...(await read($, usage)), context: null }, await $.clock.now())
    const v = await read($, fleetView)
    const offered = (await read($, steps))?.items ?? []
    // Next steps on offer close every conversation until you open one: then
    // they hide, and come back once you close them all.
    const opened = offered.length > 0 && v.open === null ? '' : openOf(v, own.sessionId)
    const { rows, page, pages } = pageOf(ownFirst(list, own.sessionId), v.page)
    const entry = list.find(s => s.sessionId === opened) ?? null
    // What fills the open conversation context, asked by a press on its percent.
    const isContextOpen = !!entry && v.isContext
    const detail = isContextOpen ? entry.contextDetail : null
    const xpNow = await read($, xp)
    const celebrated = isOwnTop ? ((await read($, milestone)) ?? undefined) : undefined
    const level = xpLabel(xpNow)
    const modelShown = top.model
    const dismiss = async () => {
      await update($, tip, () => null)
      await pushOverlay($)
    }
    // Against what is shown open, which the steps may have closed.
    const toggle = (id: string) => () => update($, fleetView, w => toggleOpen({ ...w, open: opened }, id, own.sessionId))
    const toPage = (n: number) => () => update($, fleetView, w => ({ ...w, page: n }))
    const showDetail = () => toggleContextDetail($, opened === own.sessionId)
    // Every row's state and title take the same characters, so the bars line up.
    // This conversation is told by its place (first) and its blue bar. The state's
    // column has a little room to spare: the desktop's letters are wider than
    // a cell, and TRABAJANDO wrapped without it (one cell more than "● " needs).
    const stateCells = Math.max(...Object.values(STATUS_LABEL).map(l => l.length))
    const stateWidth = stateCells + 3
    const rowState = (s: FleetSession) => `● ${STATUS_LABEL[s.status].padEnd(stateCells)}`
    const rowTitle = (s: FleetSession) => `${s.sessionId === opened ? '▾' : '▸'} ${fit(s.title || 'conversación', TITLE_CELLS - 2)}`
    const percentOf = (s: FleetSession) => Math.round(s.context?.percent ?? 0)
    // This conversation's bar wears the mod's blue so it stands out among the rest.
    const barColor = (s: FleetSession) => (s.sessionId === own.sessionId ? STATUS_COLOR.working : levelColor(percentOf(s)))

    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    const isTerminal = e.surface === 'terminal'
    const pager =
      pages > 1 ? (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{`Conversaciones ${page + 1}/${pages}`}</Text>
          {page > 0 ? <Button key="page-prev" plain label="◂" onPress={toPage(page - 1)} /> : null}
          {page < pages - 1 ? <Button key="page-next" plain label="▸" onPress={toPage(page + 1)} /> : null}
        </Box>
      ) : null
    const rowsShown = rows.map(s => (
      <Box key={`row-${s.sessionId}`} flexDirection="row" gap={1} minWidth={0}>
        <Box width={stateWidth} flexShrink={0}>
          <Text color={STATUS_COLOR[s.status]}>{rowState(s)}</Text>
        </Box>
        <Box width={TITLE_CELLS} flexShrink={0}>
          <Button key={`conv-${s.sessionId}`} plain label={rowTitle(s)} onPress={toggle(s.sessionId)} />
        </Box>
        {s.context ? <Text color={barColor(s)}>{textBar(percentOf(s))}</Text> : null}
        {/* The open conversation's percent opens what fills its context. */}
        {s.context && s.sessionId === opened ? (
          <Button key="usage-context" plain label={isContextOpen ? `◂ ${percentOf(s)} %` : `${percentOf(s)} %`} onPress={showDetail} />
        ) : s.context ? (
          <Text bold color={levelColor(percentOf(s))}>{`${percentOf(s)} %`}</Text>
        ) : null}
        {s.cache ? <Text dimColor wrap="truncate-end">{cacheShort(s.cache)}</Text> : null}
      </Box>
    ))
    const separator = <Text dimColor wrap="truncate-end">{'─'.repeat(stateWidth + TITLE_CELLS + 18)}</Text>
    // The open conversation: what fills its context when asked, its tasks and
    // its subagents; its context itself is in its row. Nothing to show, no line.
    const hasOpenShown = !!entry && (isContextOpen || entry.tasks.length > 0 || entry.agents.length > 0)
    const openShown = entry && hasOpenShown ? (
      <Box flexDirection="column" minWidth={0}>
        {separator}
        {isContextOpen && entry.context?.note ? <Text dimColor wrap="truncate-end">{entry.context.note}</Text> : null}
        {detail && isTerminal
          ? contextDetailRows(detail).map(r => (
              <Box key={`context-${r.key}`} flexDirection="row">
                <Text dimColor>{`${r.label.padEnd(24).slice(0, 24)} `}</Text>
                <Text color={r.color}>{textBar(r.percent)}</Text>
                <Text bold color={r.color}>{` ${Math.round(r.percent)} %`}</Text>
                <Text dimColor>{` ${r.note}`}</Text>
              </Box>
            ))
          : null}
        {detail && !isTerminal ? <Svg source={contextDetailSvg(detail)} alt={contextDetailSummary(detail)} /> : null}
        {entry.tasks.length > 0 ? <Text dimColor>Tareas:</Text> : null}
        {entry.tasks.map(t => (
          <Text key={`task-${t.id}`} color={TASK_COLOR[t.status]} dimColor={t.status === 'completed'} wrap="truncate-end">{`  ${TASK_ICON[t.status]} ${t.text}`}</Text>
        ))}
        {entry.agents.slice(0, MAX_AGENTS_SHOWN).map((chip, i) => (
          <Text key={`agent-${i}`} color={chip.color} wrap="truncate-end">{chip.text}</Text>
        ))}
      </Box>
    ) : null
    // The steps, under their own line, while no conversation is open.
    const stepsShown =
      offered.length > 0 && !entry ? (
        <Box flexDirection="column" minWidth={0}>
          {separator}
          <Box flexDirection={isTerminal ? 'row' : 'column'} gap={1} flexWrap="wrap" alignItems="flex-start" minWidth={0}>
            <Text dimColor>{isTerminal ? '➜ ¿Y ahora?' : '➜ ¿Y ahora? Elige uno y te lo dejo en el prompt:'}</Text>
            <Box flexDirection="row" gap={1} flexWrap="wrap" minWidth={0}>
              {offered.map((step, i) => (
                <Button key={`step-${i}`} label={step} onPress={() => pickStep($, step)} />
              ))}
            </Box>
          </Box>
        </Box>
      ) : null
    const tipShown = shown ? (
      <Box flexDirection="row" gap={1} alignItems="flex-start" minWidth={0}>
        <Box flexDirection="column" flexShrink={1} minWidth={0}>
          {tipLines(shown.text, isTerminal ? Math.max(20, e.props.bodyColumns - 8) : TIP_LINE).map(line => (
            <Text dimColor={isTerminal} wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
        <Button key="tip-dismiss" label="×" onPress={dismiss} />
      </Box>
    ) : null

    if (isTerminal) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text color={color}>{FACE[mood]} </Text>
            <Text bold color={color}>
              {label}
            </Text>
            {modelShown ? <Text dimColor>{` · ${modelShown}`}</Text> : null}
            <Text wrap="truncate-end"> · {title}</Text>
          </Box>
          {tipShown}
          {limits.length > 0 ? (
            <Box flexDirection="row" gap={2}>
              {limits.map(m => (
                <Box key={`usage-${m.key}`} flexDirection="row">
                  <Text dimColor>{`${m.label} `}</Text>
                  <Text color={levelColor(m.percent)}>{textBar(m.percent)}</Text>
                  <Text bold color={levelColor(m.percent)}>{` ${Math.round(m.percent)} %`}</Text>
                </Box>
              ))}
            </Box>
          ) : null}
          {pager}
          {rowsShown}
          {openShown}
          <Text dimColor>{level}</Text>
          {stepsShown}
        </Box>
      )
    }

    return (
      <Box flexDirection="row" alignItems="center" gap={2}>
        {/* Not isInteractive: the desktop's interactive frame shows no embedded
            images, the art's PNGs among them; drawn as an image, it does. */}
        <Svg source={sprite(mood, stageOf(levelOf(xpNow).level), celebrated)} alt={`Narsil: ${label}, ${title}`} width={132} height={118} />
        {/* minWidth 0: long text wraps or is cut inside the band, never widens it. */}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Box flexDirection="row" gap={1}>
            <Text bold color={color}>
              ● {label}
            </Text>
            <Text dimColor>· Narsil</Text>
            {modelShown ? <Text dimColor>{`· ${modelShown}`}</Text> : null}
            <Text dimColor>{`· ${level}`}</Text>
          </Box>
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          {aside ? (
            <Text dimColor wrap="truncate-end">
              {aside}
            </Text>
          ) : null}
          {tipShown}
          {limits.length > 0 ? <Svg source={usageSvg(limits)} alt={usageSummary(limits)} /> : null}
          {pager}
          {rowsShown}
          {openShown}
          {stepsShown}
        </Box>
      </Box>
    )
  })
}
