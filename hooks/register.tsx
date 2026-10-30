import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fleet, Mood, Pet, Prefs, Status, Usage } from '../types'
import type { TipKind } from './advice'
import { MAX_CALLS, MAX_FAILURES, SYSTEM, describe, emptyContext, forkPrompt, parse, prompt, remember } from './advice'
import { FACE, STATUS_COLOR, sprite, statusOf } from './sprite'
import { NO_USAGE, hasUsage, levelColor, textBar, usageOf, usageRows, usageBox, usageSummary, usageSvg } from './usage'

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
})
// Every open conversation, by state: counted by the floating window.
const fleet = atom({ plugin: 'narsil-pet', key: 'fleet' } as const, null)
// Narsil's tip on show, if any: under the headline and in the window.
const tip = atom({ plugin: 'narsil-pet', key: 'tip' } as const, null)
// What the session has spent: context window, 5-hour and weekly limits.
const usage = atom({ plugin: 'narsil-pet', key: 'usage' } as const, NO_USAGE)

const PREFS_KEY = 'prefs'
const TOKEN_KEY = 'overlayToken'
const OVERLAY = 'http://127.0.0.1:47190'

// What each state is called, the same everywhere it shows.
const STATUS_LABEL: Record<Status, string> = {
  working: 'TRABAJANDO',
  idle: 'PARADA',
  waiting: 'TE NECESITA',
  done: 'TERMINADO',
  error: 'ERROR',
}

// One plain sentence that says exactly what Claude is doing now.
function headline(mood: Mood, detail: string): string {
  const what = detail ? `: ${detail}` : ''
  switch (mood) {
    case 'greeting':
      return 'Conversación nueva, lista para empezar'
    case 'idle':
      return detail ? `Narsil está parada (${detail})` : 'Narsil está parada, esperando tu mensaje'
    case 'thinking':
      return detail ? `Narsil está pensando (${detail})` : 'Narsil está pensando qué hacer'
    case 'talking':
      return 'Narsil está escribiendo la respuesta'
    case 'reading':
      return `Narsil está leyendo${what}`
    case 'searching':
      return `Narsil está buscando${what}`
    case 'writing':
      return `Narsil está editando${what}`
    case 'running':
      return `Narsil está ejecutando${what}`
    case 'asking':
      return `Narsil te necesita${what}`
    case 'scared':
      return `Ha fallado un paso (${detail}); Narsil sigue trabajando`
    case 'celebrating':
      return detail ? `Narsil ha terminado (${detail})` : 'Narsil ha terminado'
    case 'failed':
      return `Narsil se ha detenido por un error${what}`
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
    .map(s => `${f[s]} ${STATUS_LABEL[s].toLowerCase()}`)
  return `${f.total} conversaciones abiertas: ${parts.join(' · ')}`
}

// Starts one of the mod's scripts (overlay/*.ps1) as a process of its own and
// returns at once: it outlives the hook, the turn and a reload of this module,
// which a $.clock timer does not. Its text travels in the environment, which
// the started process inherits, never in argv.
async function launch($: EngineInterface, script: string, env: Record<string, string>): Promise<boolean> {
  const file = `${$.plugin.root.replace(/\//g, '\\')}\\overlay\\${script}`
  return powershell(
    $,
    "Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('\"' + $env:NARSIL_SCRIPT + '\"')",
    { ...env, NARSIL_SCRIPT: file },
  )
}

async function powershell($: EngineInterface, script: string, env: Record<string, string>): Promise<boolean> {
  try {
    const { exitCode } = await $.process.run(
      ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env, timeoutMs: 60_000 },
    )
    return exitCode === 0
  } catch {
    return false
  }
}

async function speak($: EngineInterface, text: string): Promise<void> {
  // Windows first, so a Spanish voice is chosen when one is installed.
  if (await launch($, 'speak.ps1', { NARSIL_TEXT: text })) return
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
  if (await isOverlayUp($)) return
  const root = $.plugin.root.replace(/\//g, '\\')
  const script = [
    "$edge = @(\"${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe\", \"$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe\") | Where-Object { Test-Path $_ } | Select-Object -First 1",
    "$node = (Get-Command node -ErrorAction SilentlyContinue).Source",
    "if (-not $node) { $node = \"$env:ProgramFiles\\nodejs\\node.exe\" }",
    'if (-not $edge -or -not (Test-Path $node)) { exit 3 }',
    '$env:NARSIL_EDGE = $edge',
    'Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList (\'"\' + $env:NARSIL_SERVER + \'"\')',
  ].join('; ')
  await powershell($, script, {
    NARSIL_TOKEN: await overlayToken($),
    NARSIL_PORT: '47190',
    NARSIL_SERVER: `${root}\\overlay\\server.cjs`,
  })
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
    svg: sprite(s.mood),
    tip: (await read($, tip))?.text ?? null,
    usage: usageRows(await read($, usage), await $.clock.now()).map(r => ({ ...r, color: levelColor(r.percent) })),
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
  const shown = await read($, tip)
  if (shown && (await $.clock.now()) - shown.at >= TIP_SHOWN_MS) await update($, tip, () => null)
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
  const sent = await $.ui.notify(text, { title }).catch(() => ({ isSent: false as const }))
  if (sent.isSent) return
  // Clicking the Windows notification opens this conversation too.
  await launch($, 'toast.ps1', { NARSIL_TITLE: title, NARSIL_TEXT: text, NARSIL_LINK: conversationLink() })
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

// What needs you: Narsil's window pops up (a Windows notification when the
// window is off or down) and, unless muted, she says it aloud.
async function announce($: EngineInterface, kind: EventKind, title: string, text: string, voice: string, force = false): Promise<void> {
  const { isMuted, isFloating } = await read($, prefs)
  const isShown = isFloating && (await postEvent($, kind, title, text, force))
  await Promise.all([
    isMuted ? Promise.resolve() : speak($, voice),
    isShown ? Promise.resolve() : notify($, `Narsil · ${title}`, text),
  ])
}

// One tool can raise both a permission ask and its own question.
let lastQuestionAt = 0

async function announceQuestion($: EngineInterface, text: string): Promise<void> {
  const now = await $.clock.now()
  if (now - lastQuestionAt < 3000) return
  lastQuestionAt = now
  await announce($, 'question', 'Narsil te necesita', text, 'Narsil te necesita.')
}

function summary(answer: string, took: string): string {
  const first = answer.replace(/[#*_`>]/g, '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return first ? `Ha terminado (${took}): ${first.slice(0, 120)}` : `Ha terminado (${took}).`
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`
}

// Mirrors the stored mood so the streaming hook writes only on a change.
let current: Mood = 'idle'

async function setMood($: EngineInterface, mood: Mood, detail = ''): Promise<void> {
  current = mood
  const next: Pet = { mood, line: pick(mood), detail }
  await update($, pet, () => next)
  await pushOverlay($)
}

async function setUsage($: EngineInterface, next: Usage): Promise<void> {
  if (JSON.stringify(await read($, usage)) === JSON.stringify(next)) return
  await update($, usage, () => next)
  await pushOverlay($)
}

// Narsil's tips. What she has seen of the work (advice.ts), and how often she
// may speak up unasked: module variables, which a reload resets harmlessly.
const TIP_SHOWN_MS = 3 * 60_000
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

async function showTip($: EngineInterface, text: string, kind: TipKind): Promise<void> {
  remember(recentTips, text, RECENT_TIPS)
  const at = await $.clock.now()
  await update($, tip, () => ({ text, kind, at }))
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'narsil',
      description:
        'Narsil, tu mascota: estado | ocultar | mostrar | silencio | voz | flotante | prueba | consejo [profundo] | consejos on|off|cada <min>|voz',
    })
    const saved = (await $.store.get(PREFS_KEY).catch(() => undefined)) as Partial<Prefs> | undefined
    if (saved && typeof saved === 'object') {
      await update($, prefs, p => ({ ...p, ...saved }))
    }
    hostSession = (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID').catch(() => undefined)) ?? ''
    const spent = await $.session.usage().catch(() => undefined)
    if (spent) await setUsage($, usageOf(spent))
    sessionTitle = basename(await $.session.cwd().catch(() => e.cwd))
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
        text: `Narsil: ${STATUS_LABEL[statusOf(s.mood)]} · ${headline(s.mood, s.detail)}.\n${counted || 'Esta es la única conversación abierta.'}`,
      }
    }
    if (arg === 'flotante') {
      const saved = await update($, prefs, p => ({ ...p, isFloating: !p.isFloating }))
      await $.store.set(PREFS_KEY, saved).catch(() => undefined)
      if (saved.isFloating) {
        await startOverlay($)
        void pushOverlay($)
        return { text: 'Narsil: ventana flotante activada (aparece con Claude minimizado o cuando algo te espera).' }
      }
      await stopOverlay($)
      return { text: 'Narsil: ventana flotante desactivada (los avisos irán como notificación de Windows).' }
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
          'Uso: /narsil estado | ocultar | mostrar | silencio | voz | flotante | prueba | consejo [profundo] | consejos on|off|cada <min>|voz',
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

  // A permission Claude has to ask you for.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && !ASKING_TOOLS.has(e.tool) && e.agentId === undefined) {
      await setMood($, 'asking', `pide permiso para usar ${e.tool}`)
      await announceQuestion($, `Pide permiso para usar ${e.tool}.`)
    }

    return verdict
  })

  on('tool.call', async ($, e, next) => {
    if (ASKING_TOOLS.has(e.tool)) {
      const isPlan = e.tool === 'ExitPlanMode'
      await setMood($, 'asking', isPlan ? 'tiene un plan para que lo apruebes' : 'tiene una pregunta para ti')
      await announceQuestion($, isPlan ? 'Tiene un plan para que lo apruebes.' : 'Tiene una pregunta para ti.')
      return next(e)
    }
    const mood = MOOD_BY_TOOL[e.tool] ?? 'running'
    const detail = describeCall(e.tool, e)
    remember(seen.calls, { tool: e.tool, detail }, MAX_CALLS)
    if (WRITING_TOOLS.has(e.tool)) seen.touched.set(detail, (seen.touched.get(detail) ?? 0) + 1)
    await setMood($, mood, detail)
    const result = await next(e)
    if (result.isError) {
      await setMood($, 'scared', e.tool)
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
    if (e.agentId !== undefined) return result

    if (e.reason === 'answer') {
      const took = duration(e.durationMs)
      await setMood($, 'celebrating', `en ${took}`)
      // Not on a $.clock timer: a reload of the mod (which follows any turn
      // that edited it) cancels timers, and the announcement with them. It
      // starts processes of its own, so this returns within a second.
      await announce($, 'done', 'Narsil ha terminado', summary(e.answer, took), 'Ya está, Narsil ha terminado.')
      seen.durationMs = e.durationMs
      seen.answer = e.answer.slice(0, 400)
      tipLater($, 'review')
    } else if (e.reason === 'aborted') {
      await setMood($, 'idle', 'lo has detenido tú')
    } else {
      const why = e.reason === 'refusal' ? 'no pudo responder' : 'fallo de la API'
      await setMood($, 'failed', why)
      await announce($, 'error', 'Narsil se ha detenido', `El turno terminó con un error (${why}).`, 'Uy, Narsil se ha detenido por un error.')
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { isHidden } = await read($, prefs)
    if (e.props.hasSurvey || isHidden) return next(e)

    const state = await read($, pet)
    const status = statusOf(state.mood)
    const label = STATUS_LABEL[status]
    const color = STATUS_COLOR[status]
    const title = headline(state.mood, state.detail)
    const others = fleetSummary(await read($, fleet))
    const shown = await read($, tip)
    const spent = await read($, usage)
    const meters = hasUsage(spent) ? usageRows(spent, await $.clock.now()) : []
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
              <Text dimColor wrap="truncate-end">
                {`💡 ${shown.text}`}
              </Text>
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
          {others ? <Text dimColor>{others}</Text> : null}
        </Box>
      )
    }

    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" gap={2}>
        {/* Not isInteractive: the desktop's interactive frame shows no embedded
            images, the art's PNGs among them; drawn as an image, it does. */}
        <Svg source={sprite(state.mood)} alt={`Narsil: ${label}, ${title}`} width={132} height={118} />
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold color={color}>
              ● {label}
            </Text>
            <Text dimColor>· Narsil</Text>
          </Box>
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          <Text dimColor>{state.line}</Text>
          {shown ? (
            <Box flexDirection="row" gap={1} alignItems="center">
              <Text wrap="truncate-end">{`💡 ${shown.text}`}</Text>
              <Button key="tip-dismiss" label="×" onPress={dismiss} />
            </Box>
          ) : null}
          {meters.length > 0 ? (
            <Svg source={usageSvg(meters)} alt={usageSummary(meters)} {...usageBox(meters)} />
          ) : null}
          {others ? <Text dimColor>{others}</Text> : null}
        </Box>
      </Box>
    )
  })
}
