import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cache, Fleet, Mood, Pet, Prefs, Stats, Status, Usage } from '../types'
import type { TipKind } from './advice'
import { MAX_CALLS, MAX_FAILURES, STEPS_SYSTEM, SYSTEM, describe, emptyContext, forkPrompt, lines, parse, parseSteps, prompt, remember, stepsPrompt } from './advice'
import { TONE_COLOR, agentChip, liveRuns } from './agents'
import { FACE, STATUS_COLOR, sprite, statusOf } from './sprite'
import type { ContextSample } from './usage'
import type { XpReason } from './xp'
import { STAGES, STAGE_FROM, XP_GAIN, XP_KEY, levelOf, stageOf, xpLabel, xpOf } from './xp'
import { IDLE_SUMMARY_MS, KEEP_STATS, NUDGE_AFTER_MS, STATS_PREFIX, addFile, emptyStats, loopWarning, nudgeText, statsOf, summaryText } from './watch'
import { NO_USAGE, hasUsage, levelColor, minutesLabel, minutesToFull, textBar, usageOf, usageRows, usageSummary, usageSvg } from './usage'

// Narsil: a chibi sea serpent, named after the sword reforged to cut down
// bugs. She swims while Claude works, dozes while it waits, leaps out of the
// water when a job is done, and shivers at a red error.

const pet = atom({ plugin: 'narsil-pet', key: 'pet' } as const, {
  mood: 'greeting',
  line: '¡Hola! Soy Narsil. Te cuento todo lo que hago.',
  detail: '',
})
const prefs = atom({ plugin: 'narsil-pet', key: 'prefs' } as const, {
  isHidden: false,
  isMuted: false,
  isFloating: true,
  isAdviceOn: true,
  adviceEveryMinutes: 10,
  isAdviceSpoken: false,
  isNextStepsOn: true,
  cacheMinutes: null,
})
// Every open conversation, by state: counted by the floating window.
const fleet = atom({ plugin: 'narsil-pet', key: 'fleet' } as const, null)
// Narsil's tip on show, if any: under the headline and in the window.
const tip = atom({ plugin: 'narsil-pet', key: 'tip' } as const, null)
// What the session has spent: context window, 5-hour and weekly limits.
const usage = atom({ plugin: 'narsil-pet', key: 'usage' } as const, NO_USAGE)
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
// A new level or stage being celebrated, and when it began.
const milestone = atom({ plugin: 'narsil-pet', key: 'milestone' } as const, null)
// How long each celebration shows.
const MILESTONE_MS = { level: 6000, grew: 9000 } as const

const PREFS_KEY = 'prefs'
const TOKEN_KEY = 'overlayToken'
const OVERLAY = 'http://127.0.0.1:47190'

// What each state is called, the same everywhere it shows.
const STATUS_LABEL: Record<Status, string> = {
  working: 'TRABAJANDO',
  idle: 'PARADA',
  waiting: 'TE NECESITA',
  done: 'TERMINADA',
  error: 'ERROR',
}

// How a count of conversations in each state reads, agreeing in number:
// "1 parada", "2 paradas", "2 te necesitan".
const COUNT_LABEL: Record<Status, readonly [one: string, many: string]> = {
  working: ['trabajando', 'trabajando'],
  idle: ['parada', 'paradas'],
  waiting: ['te necesita', 'te necesitan'],
  done: ['terminada', 'terminadas'],
  error: ['con error', 'con error'],
}

// One plain sentence that says exactly what Claude is doing now.
function headline(mood: Mood, detail: string): string {
  const what = detail ? `: ${detail}` : ''
  switch (mood) {
    case 'greeting':
      return 'Conversación nueva, lista para empezar'
    case 'idle':
      return detail ? `Estoy parada (${detail})` : 'Estoy parada, esperando tu mensaje'
    case 'thinking':
      return detail ? `Estoy pensando (${detail})` : 'Estoy pensando qué hacer'
    case 'talking':
      return 'Estoy escribiendo la respuesta'
    case 'reading':
      return `Estoy leyendo${what}`
    case 'searching':
      return `Estoy buscando${what}`
    case 'writing':
      return `Estoy editando${what}`
    case 'running':
      return `Estoy ejecutando${what}`
    case 'asking':
      return `Te necesito${what}`
    case 'scared':
      return `Ha fallado un paso (${detail}); sigo trabajando`
    case 'celebrating':
      return detail ? `He terminado (${detail})` : 'He terminado'
    case 'failed':
      return `Me he detenido por un error${what}`
  }
}

// Narsil's own aside, under the headline.
const LINES: Record<Mood, readonly string[]> = {
  greeting: ['¡Una conversación nueva! ¡Qué alegría!', '¡Hola, hola! ¿Qué pescamos hoy?', 'El agua está perfecta para empezar.'],
  idle: ['Floto tranquila hasta que me escribas.', 'Descansando entre las olas…', 'Aquí espero, enroscada.'],
  thinking: ['Buceando en la idea…', 'Siguiendo la corriente del plan…', 'Hmm, déjame pensar.'],
  talking: ['Ordenando las palabras…', 'Ya casi lo tengo escrito.'],
  reading: ['Leo línea a línea.', 'Qué archivo más interesante.', 'Repasando con calma.'],
  searching: ['Rastreando entre el código…', 'Lo encontraré, como una perla.', 'Mirando bajo cada piedra.'],
  writing: ['Tecleando con mis aletas.', 'Retoque por aquí, retoque por allá.', 'Cambio en marcha.'],
  running: ['A ver qué responde la máquina.', 'Comando lanzado al mar.', 'Esperando la salida…'],
  asking: ['Sube un momento, que te necesito.', 'Sin ti no puedo seguir.', 'Te espero para continuar.'],
  scared: ['¡Uy! Ese paso no salió, pero sigo.', 'Una ola en contra; seguimos.', 'Tropiezo, nada grave.'],
  celebrating: ['¡Salto de alegría! ¡Hecho!', '¡Misión cumplida!', 'Puedes volver cuando quieras.'],
  failed: ['Me he quedado varada…', 'Algo ha salido mal de verdad.', 'Mira qué ha pasado, por favor.'],
}

// Tools that stop and wait for the person.
const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

// A command that runs a project's tests.
const TEST_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|(?:go|cargo|dotnet|mvn|gradle|gradlew|deno|mix)\s+test|claude\s+plugin\s+test|python3?\s+-m\s+(?:pytest|unittest)|vitest|jest|pytest|mocha|phpunit|rspec)\b/

// Commands that cannot be taken back, by the name Narsil warns with.
const DANGEROUS_COMMANDS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ['rm -rf', /\brm\s+(?:-[a-zA-Z]*(?:[rR]f|f[rR])[a-zA-Z]*|-[rR]\s+-f|-f\s+-[rR])\b/],
  ['git push --force', /\bgit\s+push\b[^|;&\n]*\s(?:--force(?!-with-lease)|-f)\b/],
  ['git reset --hard', /\bgit\s+reset\s+--hard\b/],
  ['git clean -f', /\bgit\s+clean\s+-[a-zA-Z]*f/],
  ['git branch -D', /\bgit\s+branch\s+-D\b/],
  ['Remove-Item -Recurse -Force', /\bRemove-Item\b(?=[^|;\n]*-Recurse\b)(?=[^|;\n]*-Force\b)/i],
  ['DROP', /\bdrop\s+(?:table|database|schema)\b/i],
  ['chmod -R 777', /\bchmod\s+-R\s+777\b/],
  ['mkfs', /\bmkfs(?:\.\w+)?\b/],
  ['dd', /\bdd\s+[^|;\n]*\bof=\/dev\//],
  ['descargar y ejecutar', /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|\n]*\|\s*(?:sh|bash|zsh|iex|Invoke-Expression)\b/i],
]

function dangerOf(command: string): string | null {
  return DANGEROUS_COMMANDS.find(([, pattern]) => pattern.test(command))?.[0] ?? null
}

const MOOD_BY_TOOL: Record<string, Mood> = {
  Read: 'reading',
  NotebookRead: 'reading',
  Grep: 'searching',
  Glob: 'searching',
  WebSearch: 'searching',
  WebFetch: 'searching',
  ToolSearch: 'searching',
  Edit: 'writing',
  MultiEdit: 'writing',
  Write: 'writing',
  NotebookEdit: 'writing',
  Bash: 'running',
  PowerShell: 'running',
  Agent: 'thinking',
  Task: 'thinking',
}

function pick(mood: Mood): string {
  const options = LINES[mood]
  return options[Math.floor(Math.random() * options.length)] ?? ''
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function describeCall(tool: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '')
  if (tool === 'Agent' || tool === 'Task') return `subagente: ${text('description') || 'tarea'}`.slice(0, 60)
  const file = text('file_path') || text('notebook_path') || text('path')
  if (file) return basename(file)
  if (text('pattern')) return `"${text('pattern').slice(0, 40)}"`
  if (text('query')) return `"${text('query').slice(0, 40)}"`
  if (text('url')) return text('url').slice(0, 50)
  if (text('command')) return text('command').split('\n')[0]!.slice(0, 50)
  if (text('description')) return text('description').slice(0, 50)
  return tool
}

function fleetSummary(f: Fleet | null): string {
  if (!f || f.total < 2) return ''
  const parts = (['working', 'waiting', 'error', 'done', 'idle'] as const)
    .filter(s => f[s] > 0)
    .map(s => `${f[s]} ${COUNT_LABEL[s][f[s] === 1 ? 0 : 1]}`)
  return `${f.total} conversaciones abiertas: ${parts.join(' · ')}`
}

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

async function isOverlayUp($: EngineInterface): Promise<boolean> {
  try {
    const { ok, text } = await $.http.fetch(`${OVERLAY}/ping`)
    return ok && text === 'narsil'
  } catch {
    return false
  }
}

async function startOverlay($: EngineInterface): Promise<void> {
  const os = await platformOf($)
  if (os === 'other' || (await isOverlayUp($))) return
  const env = { NARSIL_TOKEN: await overlayToken($), NARSIL_PORT: '47190' }
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
    'if (-not $edge -or -not (Test-Path $node)) { exit 3 }',
    '$env:NARSIL_EDGE = $edge',
    'Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList (\'"\' + $env:NARSIL_SERVER + \'"\')',
  ].join('; ')
  await powershell($, script, { ...env, NARSIL_SERVER: `${root}\\overlay\\server.cjs` })
}

// The desktop app's id of this conversation (`local_…`), what its
// claude://code/continue link opens, and the folder it works in; both set at
// session.start.
let hostSession = ''
let sessionTitle = ''

function conversationLink(): string {
  return /^local_[A-Za-z0-9-]{1,64}$/.test(hostSession)
    ? `claude://code/continue?session=${hostSession}&source=desktop_action`
    : ''
}

async function pushOverlay($: EngineInterface): Promise<void> {
  const { isFloating } = await read($, prefs)
  if (!isFloating) return
  const s = await read($, pet)
  const status = statusOf(s.mood)
  const body = JSON.stringify({
    sessionId: hostSession,
    title: sessionTitle,
    mood: s.mood,
    status,
    statusLabel: STATUS_LABEL[status],
    headline: headline(s.mood, s.detail),
    line: s.line,
    svg: sprite(s.mood, stageOf(levelOf(await read($, xp)).level), (await read($, milestone)) ?? undefined),
    tip: await read($, tip).then(t => (t && !t.isWindowed ? t.text : null)),
    usage: usageRows(await read($, usage), await $.clock.now(), contextToFull).map(r => ({ ...r, color: levelColor(r.percent) })),
    agents: await read($, agentChips),
    cache: await read($, cache).then(c => (c ? cacheLabel(c) : null)),
    steps: (await read($, steps))?.items ?? [],
    xp: xpLabel(await read($, xp)),
  })
  await $.http
    .fetch(`${OVERLAY}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-narsil-token': await overlayToken($) },
      body,
    })
    .catch(() => undefined)
}

// The heartbeat: keep the window in sync, and learn how many conversations
// are open and in which state.
async function beat($: EngineInterface): Promise<void> {
  // A tip leaves the band after TIP_SHOWN_MS; the window keeps it for
  // TIP_KEPT_MS, since it shows while Claude is minimized, often later.
  const kept = await read($, tip)
  const age = kept ? (await $.clock.now()) - kept.at : 0
  if (kept && age >= TIP_KEPT_MS) await update($, tip, () => null)
  else if (kept && !kept.isFaded && age >= TIP_SHOWN_MS) await update($, tip, t => (t ? { ...t, isFaded: true } : t))
  const shown = await read($, milestone)
  if (shown && (await $.clock.now()) - shown.at >= MILESTONE_MS[shown.kind]) await update($, milestone, () => null)
  await tickCache($)
  await tickWatch($)
  await refreshAgents($)
  await pushOverlay($)
  try {
    const { ok, text } = await $.http.fetch(`${OVERLAY}/summary`)
    if (!ok) return
    const next = JSON.parse(text) as Fleet
    const now = await read($, fleet)
    if (JSON.stringify(now) !== JSON.stringify(next)) await update($, fleet, () => next)
  } catch {
    // no window running: nothing to count
  }
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
async function announce($: EngineInterface, kind: EventKind, title: string, text: string, voice: string, force = false): Promise<void> {
  const { isMuted, isFloating } = await read($, prefs)
  const spoken = isMuted ? Promise.resolve() : speak($, voice)
  if (isFloating) {
    if (!(await postEvent($, kind, title, text, force)) && (await ensureOverlay($))) {
      await postEvent($, kind, title, text, force)
    }
  } else {
    await notify($, `Narsil · ${title}`, text)
  }
  await spoken
}

// The last test run failed: the next one that passes is a recovery.
let areTestsFailing = false

// One tool can raise both a permission ask and its own question.
let lastQuestionAt = 0

async function announceQuestion($: EngineInterface, text: string): Promise<void> {
  const now = await $.clock.now()
  if (now - lastQuestionAt < 3000) return
  lastQuestionAt = now
  await announce($, 'question', 'Te necesito', text, 'Te necesito.')
}

function summary(answer: string, took: string): string {
  const first = answer.replace(/[#*_`>]/g, '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return first ? `He terminado (${took}): ${first.slice(0, 120)}` : `He terminado (${took}).`
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`
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

function ago(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 5) return 'ahora mismo'
  return seconds >= 60 ? `hace ${Math.round(seconds / 60)} min` : `hace ${seconds} s`
}

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
  await pushOverlay($)
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

// The desktop band's tip lines, in characters: short enough to fit beside
// Narsil in a narrow window, since the band's width cannot be read from here.
const TIP_LINE = 60
// Subagents listed in the band at most; the window lists as many.
const MAX_AGENTS_SHOWN = 6

// The tip as the band draws it, '💡' ahead of its first line.
function tipLines(text: string, width: number): string[] {
  return lines(`💡 ${text}`, width)
}

// Narsil's tips. What she has seen of the work (advice.ts), and how often she
// may speak up unasked: module variables, which a reload resets harmlessly.
const TIP_SHOWN_MS = 3 * 60_000
const TIP_KEPT_MS = 15 * 60_000
const LONG_TURN_MS = 3 * 60_000
const TIPS_PER_DAY = 20
const RECENT_TIPS = 5
const WRITING_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

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
  if (!p.isAdviceOn) return false
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

// One small completion over what Narsil has seen; null when she has nothing
// useful to say or the call failed.
async function askTip($: EngineInterface, kind: TipKind): Promise<string | null> {
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: prompt(describe(seen, kind), recentTips),
      effort: 'low',
      maxTokens: 120,
      timeoutMs: 8000,
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
async function showTip($: EngineInterface, text: string, kind: TipKind | 'context' | 'loop' | 'summary'): Promise<void> {
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
    await announce($, outcome === 'done' ? 'done' : 'error', 'Un subagente ha terminado', text, outcome === 'done' ? 'Un subagente ha terminado.' : 'Un subagente se ha detenido.')
  }
}

// --- The prompt cache's clock and the next steps ---

// How long the prompt cache lasts, in minutes: on a plan Claude Code keeps it
// an hour, with an API key five minutes. The API does not say which: a
// person who knows better sets it with /narsil cache.
const PLAN_CACHE_MINUTES = 60
const API_CACHE_MINUTES = 5
// How long after a finished turn Narsil offers next steps.
const STEPS_AFTER_MS = 3 * 60_000

let stepsAskedFor: number | null = null

async function cacheMinutes($: EngineInterface): Promise<number> {
  const set = (await read($, prefs)).cacheMinutes
  if (set) return set
  const spent = await read($, usage)
  return spent.fiveHour || spent.week ? PLAN_CACHE_MINUTES : API_CACHE_MINUTES
}

function cacheLeft(at: number, minutes: number, now: number): number {
  return Math.max(0, Math.ceil((at + minutes * 60_000 - now) / 60_000))
}

function cacheLabel(c: Cache): string {
  return c.left > 0 ? `🧊 Caché: ${c.left} min` : '🧊 Caché fría: el próximo mensaje se cobra completo'
}

// The color of what the cache has spent of its life: green while fresh.
function cacheColor(c: Cache): string {
  return levelColor(100 - (c.left / c.minutes) * 100)
}

// A turn just ended: the cache was written now.
async function startCache($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  const minutes = await cacheMinutes($)
  await update($, cache, () => ({ at, minutes, left: minutes }))
}

// On every heartbeat: count the cache down, and offer next steps once the
// turn has been over long enough.
async function tickCache($: EngineInterface): Promise<void> {
  const c = await read($, cache)
  if (!c) return
  const now = await $.clock.now()
  const left = cacheLeft(c.at, c.minutes, now)
  if (left !== c.left) await update($, cache, k => (k ? { ...k, left } : k))
  if (now - c.at >= STEPS_AFTER_MS) void offerSteps($, c.at).catch(() => undefined)
}

// One small completion for what to ask next, once per finished turn.
async function offerSteps($: EngineInterface, at: number): Promise<void> {
  if (stepsAskedFor === at || (await read($, steps))?.at === at) return
  stepsAskedFor = at
  if (!(await read($, prefs)).isNextStepsOn) return
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      system: STEPS_SYSTEM,
      prompt: stepsPrompt(describe(seen, 'review')),
      effort: 'low',
      maxTokens: 160,
      timeoutMs: 8000,
    })
    const items = reply.isAnswered ? parseSteps(reply.text) : []
    // A turn that started meanwhile makes them stale.
    if (items.length === 0 || (await read($, cache))?.at !== at) return
    await update($, steps, () => ({ at, items }))
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

// --- Loops, a permission left waiting, and the session's summary ---

// How many times in a row each step (tool and what it was on) has failed this
// turn, and the loops already warned about: each once a turn.
let failStreaks = new Map<string, number>()
let loopsWarned = new Set<string>()
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

function warnLoop($: EngineInterface, key: string, text: string | null): void {
  if (!text || loopsWarned.has(key)) return
  loopsWarned.add(key)
  void (async () => {
    await announce($, 'question', 'Veo un bucle', text, 'Creo que esto se está repitiendo.')
    await showTip($, text, 'loop')
  })().catch(() => undefined)
}

async function startWaiting($: EngineInterface, what: string): Promise<void> {
  waiting = { since: await $.clock.now(), what, isNudged: false }
}

function stopWaiting(): void {
  waiting = null
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
    void announce($, 'question', 'Sigo esperándote', text, 'Sigo esperándote.', true).catch(() => undefined)
  }
  const c = await read($, cache)
  if (c && summarizedFor !== c.at && now - c.at >= IDLE_SUMMARY_MS && ((await read($, stats))?.turns ?? 0) > 0) {
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
  if (c) await update($, cache, () => ({ ...c, minutes, left: cacheLeft(c.at, minutes, now) }))
  return `Narsil: la caché dura ${minutes} min${(await read($, prefs)).cacheMinutes ? '' : ' (según tu cuenta; cámbialo con /narsil cache <min>)'}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'narsil',
      description:
        'Narsil, tu mascota: estado | ocultar | mostrar | silencio | voz | flotante | prueba | consejo [profundo] | consejos on|off|cada <min>|voz | pasos on|off | cache [auto|<min>] | resumen | nivel',
    })
    const saved = (await $.store.get(PREFS_KEY).catch(() => undefined)) as Partial<Prefs> | undefined
    if (saved && typeof saved === 'object') {
      await update($, prefs, p => ({ ...p, ...saved }))
    }
    hostSession = (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID').catch(() => undefined)) ?? ''
    const spent = await $.session.usage().catch(() => undefined)
    if (spent) await setUsage($, usageOf(spent))
    sessionTitle = basename(await $.session.cwd().catch(() => e.cwd))
    // The stats survive a reload of the mod, and Claude Code restarting with
    // this conversation: only a new conversation starts them.
    await loadStats($)
    if (!(await read($, stats))) await bumpStats($, s => s)
    const earned = xpOf(await $.store.get(XP_KEY).catch(() => 0))
    await update($, xp, () => earned)
    // A new conversation: Narsil is happy to see you.
    await setMood($, 'greeting')

    // The floating window shows itself while Claude is minimized or an event
    // waits for you; the heartbeat keeps it in sync, and it closes itself
    // once the beats stop.
    if ((await read($, prefs)).isFloating) {
      $.clock.after(10, () => startOverlay($))
    }
    $.clock.every(2000, () => beat($))

    return next(e)
  })

  on('command.run', { command: 'narsil' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().replace(/\s+/g, ' ')
    const advice = await adviceCommand($, arg)
    if (advice !== undefined) return { text: advice }
    const stepped = await stepsCommand($, arg)
    if (stepped !== undefined) return { text: stepped }
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
    }
    if (arg === 'prueba') {
      await setMood($, 'celebrating', 'prueba')
      // A test shows the popup even while you look at Claude.
      await announce($, 'done', 'Así te avisaré', 'Haz clic para volver a esta conversación.', 'Hola, soy Narsil. Así sonaré cuando termine.', true)
      return { text: 'Narsil: prueba de aviso y voz lanzada.' }
    }
    if (arg === 'estado') {
      await beat($)
      const counted = fleetSummary(await read($, fleet))
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
        await pushOverlay($)
        return { text: 'Narsil: ventana flotante activada (aparece con Claude minimizado o cuando algo te espera).' }
      }
      await stopOverlay($)
      return { text: 'Narsil: ventana flotante desactivada (los avisos irán como notificación del sistema).' }
    }
    const patch = change[arg]
    if (!patch) {
      const p = await read($, prefs)
      return {
        text:
          `Narsil está ${p.isHidden ? 'oculta' : 'visible'}, con la voz ${p.isMuted ? 'apagada' : 'encendida'} ` +
          `y la ventana flotante ${p.isFloating ? 'activada' : 'desactivada'}.\n` +
          `Consejos ${p.isAdviceOn ? `activados (como mucho uno cada ${p.adviceEveryMinutes} min)` : 'desactivados'}` +
          `${p.isAdviceSpoken ? ', dichos en voz alta' : ''}.\n` +
          `Próximos pasos ${p.isNextStepsOn ? 'activados' : 'desactivados'}; la caché dura ${await cacheMinutes($)} min.\n` +
          'Uso: /narsil estado | ocultar | mostrar | silencio | voz | flotante | prueba | consejo [profundo] | consejos on|off|cada <min>|voz | pasos on|off | cache [auto|<min>] | resumen | nivel',
      }
    }
    const saved = await update($, prefs, p => ({ ...p, ...patch }))
    await $.store.set(PREFS_KEY, saved).catch(() => undefined)

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
      failStreaks = new Map()
      loopsWarned = new Set()
      stopWaiting()
      await update($, cache, () => null)
      await update($, steps, () => null)
      await setMood($, 'thinking')
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta) seen.prompt = e.text.slice(0, 400)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
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
      warnLoop($, `edit:${detail}`, loopWarning(detail, 0, edits))
    }
    if (isShell) await bumpStats($, s => ({ ...s, commands: s.commands + 1 }))
    const command = isShell && typeof (e as { command?: unknown }).command === 'string' ? (e as { command: string }).command : ''
    const danger = dangerOf(command)
    if (danger) $.ui.log(`⚠️ Narsil: comando sin vuelta atrás (${danger}): ${command.split('\n')[0]!.slice(0, 120)}`)
    await setMood($, mood, detail, danger ? `⚠️ Cuidado: ${danger} no tiene vuelta atrás.` : pick(mood))
    const isTest = TEST_COMMAND.test(command)
    if (e.agentId !== undefined) await touchAgent($, e.agentId)
    const result = await next(e)
    // The same step failing again and again, with other work in between, is
    // a loop; one success of it starts its count over.
    const step = `${e.tool}:${detail}`
    if (result.isError) {
      const streak = (failStreaks.get(step) ?? 0) + 1
      failStreaks.set(step, streak)
      await bumpStats($, s => ({ ...s, failures: s.failures + 1 }))
      warnLoop($, `fail:${step}`, loopWarning(isShell ? `El comando «${detail}»` : `${e.tool} sobre ${detail}`, streak, 0))
    } else {
      failStreaks.delete(step)
    }
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

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      await endAgent($, e.agentId, e.reason)
      return result
    }
    stopWaiting()
    await bumpStats($, s => ({ ...s, turns: s.turns + 1, workedMs: s.workedMs + (e.durationMs ?? 0) }))
    // Every request of the turn wrote the prompt cache; its clock starts now.
    await startCache($)

    if (e.reason === 'answer') {
      const took = duration(e.durationMs)
      await setMood($, 'celebrating', `en ${took}`)
      await gainXp($, 'turn')
      // Not on a $.clock timer: a reload of the mod (which follows any turn
      // that edited it) cancels timers, and the announcement with them. It
      // starts processes of its own, so this returns within a second.
      await announce($, 'done', 'He terminado', summary(e.answer, took), 'Ya está, ya terminé.')
      seen.durationMs = e.durationMs
      seen.answer = e.answer.slice(0, 400)
      tipLater($, 'review')
    } else if (e.reason === 'aborted') {
      await setMood($, 'idle', 'lo has detenido tú')
    } else {
      const why = e.reason === 'refusal' ? 'no pudo responder' : 'fallo de la API'
      await setMood($, 'failed', why)
      await announce($, 'error', 'Me he detenido', `El turno terminó con un error (${why}).`, 'Uy, me detuve por un error.')
    }

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
    const status = statusOf(state.mood)
    const label = STATUS_LABEL[status]
    const color = STATUS_COLOR[status]
    const title = headline(state.mood, state.detail)
    const others = fleetSummary(await read($, fleet))
    const kept = await read($, tip)
    const shown = kept && !kept.isFaded && !kept.isWindowed ? kept : null
    const spent = await read($, usage)
    const meters = hasUsage(spent) ? usageRows(spent, await $.clock.now(), contextToFull) : []
    // A small serpent per running subagent, with its task.
    const helpers = (await read($, agentChips)).slice(0, MAX_AGENTS_SHOWN)
    // The cache's clock while Claude waits, and the next steps on offer.
    const clockShown = await read($, cache)
    const offered = (await read($, steps))?.items ?? []
    const xpNow = await read($, xp)
    const celebrated = (await read($, milestone)) ?? undefined
    const level = xpLabel(xpNow)
    const dismiss = async () => {
      await update($, tip, () => null)
      await pushOverlay($)
    }

    if (e.surface === 'terminal') {
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text color={color}>{FACE[state.mood]} </Text>
            <Text bold color={color}>
              {label}
            </Text>
            <Text wrap="truncate-end"> · {title}</Text>
          </Box>
          {shown ? (
            <Box flexDirection="row" gap={1}>
              <Box flexDirection="column" flexShrink={1} minWidth={0}>
                {tipLines(shown.text, Math.max(20, e.props.bodyColumns - 8)).map(line => (
                  <Text dimColor wrap="truncate-end">
                    {line}
                  </Text>
                ))}
              </Box>
              <Button key="tip-dismiss" label="×" onPress={dismiss} />
            </Box>
          ) : null}
          {meters.length > 0 ? (
            <Box flexDirection="row" gap={2}>
              {meters.map(m => (
                <Box key={`usage-${m.key}`} flexDirection="row">
                  <Text dimColor>{`${m.label} `}</Text>
                  <Text color={levelColor(m.percent)}>{textBar(m.percent)}</Text>
                  <Text bold color={levelColor(m.percent)}>{` ${Math.round(m.percent)} %`}</Text>
                </Box>
              ))}
            </Box>
          ) : null}
          {helpers.map((chip, i) => (
            <Text key={`agent-${i}`} color={chip.color} wrap="truncate-end">{chip.text}</Text>
          ))}
          <Text dimColor>{level}</Text>
          {clockShown ? <Text color={cacheColor(clockShown)}>{cacheLabel(clockShown)}</Text> : null}
          {offered.length > 0 ? (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Text dimColor>➜ ¿Y ahora?</Text>
              {offered.map((step, i) => (
                <Button key={`step-${i}`} label={step} onPress={() => pickStep($, step)} />
              ))}
            </Box>
          ) : null}
          {others ? <Text dimColor>{others}</Text> : null}
        </Box>
      )
    }

    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" gap={2}>
        {/* Not isInteractive: the desktop's interactive frame shows no embedded
            images, the art's PNGs among them; drawn as an image, it does. */}
        <Svg source={sprite(state.mood, stageOf(levelOf(xpNow).level), celebrated)} alt={`Narsil: ${label}, ${title}`} width={132} height={118} />
        {/* minWidth 0: long text wraps or is cut inside the band, never widens it. */}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Box flexDirection="row" gap={1}>
            <Text bold color={color}>
              ● {label}
            </Text>
            <Text dimColor>· Narsil</Text>
            <Text dimColor>{`· ${level}`}</Text>
          </Box>
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          <Text dimColor wrap="truncate-end">
            {state.line}
          </Text>
          {shown ? (
            <Box flexDirection="row" gap={1} alignItems="flex-start" minWidth={0}>
              <Box flexDirection="column" flexShrink={1} minWidth={0}>
                {tipLines(shown.text, TIP_LINE).map(line => (
                  <Text wrap="truncate-end">{line}</Text>
                ))}
              </Box>
              <Button key="tip-dismiss" label="×" onPress={dismiss} />
            </Box>
          ) : null}
          {meters.length > 0 ? (
            <Svg source={usageSvg(meters)} alt={usageSummary(meters)} />
          ) : null}
          {helpers.length > 0 ? (
            <Box flexDirection="row" gap={2} flexWrap="wrap" minWidth={0}>
              {helpers.map((chip, i) => (
                <Text key={`agent-${i}`} color={chip.color} wrap="truncate-end">{chip.text}</Text>
              ))}
            </Box>
          ) : null}
          {clockShown ? <Text color={cacheColor(clockShown)}>{cacheLabel(clockShown)}</Text> : null}
          {offered.length > 0 ? (
            <Box flexDirection="column" gap={1} alignItems="flex-start" minWidth={0}>
              <Text dimColor>➜ ¿Y ahora? Elige uno y te lo dejo en el prompt:</Text>
              <Box flexDirection="row" gap={1} flexWrap="wrap" minWidth={0}>
                {offered.map((step, i) => (
                  <Button key={`step-${i}`} label={step} onPress={() => pickStep($, step)} />
                ))}
              </Box>
            </Box>
          ) : null}
          {others ? <Text dimColor>{others}</Text> : null}
        </Box>
      </Box>
    )
  })
}
