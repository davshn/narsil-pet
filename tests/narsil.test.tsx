import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteResult, On } from 'claude-code'

import { STEPS_SYSTEM, SYSTEM, parseSteps } from '../hooks/advice'
import { agentChip } from '../hooks/agents'
import { emptyStats, summaryText } from '../hooks/watch'
import { levelOf, stageOf, xpLabel, xpOf } from '../hooks/xp'
import { ART } from '../hooks/art'
import { sprite } from '../hooks/sprite'

const BAND = {
  plugin: 'narsil-pet',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// How the person typed /narsil estado at the prompt.
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

type Posted = { url: string; token?: string; body: Record<string, unknown> }
type Ran = { argv: readonly string[]; env: Record<string, string> }

// Stands in for the engine and the floating window: records what the window
// receives and what the mod runs, and answers /summary with `summary`. `os` is
// the system the session runs on, as the environment and `uname` tell it.
// `isOverlayDown`: the window is not running until the mod starts its server.
function engine(
  on: On,
  summary: Record<string, number> | null = null,
  {
    hasClock = true,
    store = {},
    os = 'windows',
    runs = [],
    isOverlayDown = false,
  }: { hasClock?: boolean; store?: Record<string, unknown>; os?: 'windows' | 'mac' | 'linux'; runs?: Ran[]; isOverlayDown?: boolean } = {},
): Posted[] {
  const posts: Posted[] = []
  let isUp = !isOverlayDown
  const uname = { windows: 'MINGW64_NT-10.0', mac: 'Darwin', linux: 'Linux' }[os]
  on('store.get', (_, e) => ({ value: e.key === 'overlayToken' ? 'secret-token' : store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.delete', (_, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('env.get', (_, e) => ({
    value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_abc-123' : e.name === 'OS' && os === 'windows' ? 'Windows_NT' : undefined,
  }))
  on('session.cwd', () => ({ value: 'C:/Proyectos/landing' }))
  on('command.register', () => ({ value: { command: 'narsil' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('http.fetch', (_, e) => {
    if (!isUp) return { value: { status: 503, ok: false, headers: {}, text: '' } }
    if (e.init?.method === 'POST' && e.init.body) {
      posts.push({ url: e.url, token: e.init.headers?.['x-narsil-token'], body: JSON.parse(e.init.body) })
    }
    const isSummary = e.url.endsWith('/summary')
    const text = isSummary ? JSON.stringify(summary) : e.url.endsWith('/ping') && isOverlayDown ? 'narsil' : ''
    return { value: { status: 200, ok: !isSummary || summary !== null, headers: {}, text } }
  })
  on('process.run', (_, e) => {
    runs.push({ argv: e.argv, env: e.init?.env ?? {} })
    // the window's server, started through PowerShell or start.sh
    if (e.init?.env?.NARSIL_SERVER || String(e.argv[1]).endsWith('/overlay/start.sh')) isUp = true
    const stdout = e.argv[0] === 'uname' ? `${uname}\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // the test engine has no clock: answer its calls here
  if (hasClock) {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('clock.after', () => ({ value: undefined }))
    on('clock.every', () => ({ value: undefined }))
    on('clock.sleep', () => ({ value: undefined }))
  }
  return posts
}

test('a new conversation shows as stopped and ready, on every surface', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /PARADA/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Conversación nueva, lista para empezar/ })).toBeDefined()
    await ui.unmount()
  }
})

test('working says exactly what Narsil does, and a failed step keeps her working', async ($, on) => {
  engine(on)
  let shouldFail = false
  on('tool.call', () => (shouldFail ? { isError: true, result: 'boom', text: 'boom' } : { result: {} }))

  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/src/app.ts' })
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /TRABAJANDO/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Estoy leyendo: app.ts' })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Estoy ejecutando: npm test' })).toBeDefined()
  await ui.unmount()

  shouldFail = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /TRABAJANDO/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /Ha fallado un paso \(Bash\); sigo trabajando/ })).toBeDefined()
  await term.unmount()
})

test('each state change is pushed to the floating window with its token and session', async ($, on) => {
  const posts = engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'Edit', file_path: 'C:/repo/a.ts', old_string: 'a', new_string: 'b' } as never)

  const last = posts.filter(p => p.url.endsWith('/state')).at(-1)
  expect(last?.token).toBe('secret-token')
  expect(last?.body.sessionId).toBe('local_abc-123')
  expect(last?.body.title).toBe('landing')
  expect(last?.body.status).toBe('working')
  expect(last?.body.headline).toBe('Estoy editando: a.ts')
  expect(String(last?.body.svg).startsWith('<svg')).toBe(true)
})

test('a question from Claude pops up with the conversation it belongs to', async ($, on) => {
  const posts = engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)

  const asked = posts.find(p => p.url.endsWith('/event'))
  expect(asked?.body.kind).toBe('question')
  expect(asked?.body.sessionId).toBe('local_abc-123')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /TE NECESITA/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Te necesito: tengo una pregunta para ti' })).toBeDefined()
  await ui.unmount()
})

test('a permission dialog you must answer pops up as a question', async ($, on) => {
  const posts = engine(on)
  on('classic.PermissionRequest', () => ({}))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, permission_mode: 'default' })

  const asked = posts.find(p => p.url.endsWith('/event'))
  expect(asked?.body.kind).toBe('question')
  expect(asked?.body.text).toBe('Pido permiso para usar Bash.')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /TE NECESITA/ })).toBeDefined()
  await ui.unmount()
})

test('an ask the mode settles by itself (bypass permissions) raises no alarm', async ($, on) => {
  const posts = engine(on)
  // the engine's verdict before the mode settles it: "ask", then allowed
  on('tool.check', () => ({ decision: 'ask' as const }))
  on('tool.call', () => ({ result: {} }))
  on('classic.PermissionRequest', () => ({}))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, permission_mode: 'bypassPermissions' })

  expect(posts.find(p => p.url.endsWith('/event'))).toBeUndefined()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /TE NECESITA/ })).toBeUndefined()
  await ui.unmount()
})

test('a permission a settings hook answers raises no alarm', async ($, on) => {
  const posts = engine(on)
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' as const } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: {}, permission_mode: 'default' })

  expect(posts.find(p => p.url.endsWith('/event'))).toBeUndefined()
})

test('the open conversations are counted by state', async ($, on) => {
  engine(on, { working: 2, idle: 1, waiting: 0, done: 1, error: 0, total: 4 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const answer = await $.command.run({ command: 'narsil', args: 'estado', ...TYPED })

  expect(JSON.stringify(answer)).toContain('4 conversaciones abiertas: 2 trabajando · 1 terminada · 1 parada')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '4 conversaciones abiertas: 2 trabajando · 1 terminada · 1 parada' })).toBeDefined()
  await ui.unmount()
})

test('the counts agree in number with how many conversations each holds', async ($, on) => {
  engine(on, { working: 1, idle: 2, waiting: 2, done: 2, error: 2, total: 9 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const answer = await $.command.run({ command: 'narsil', args: 'estado', ...TYPED })

  expect(JSON.stringify(answer)).toContain(
    '9 conversaciones abiertas: 1 trabajando · 2 te necesitan · 2 con error · 2 terminadas · 2 paradas',
  )
})

test('the advice prompt keeps the feminine for Narsil and neutral wording for the person', () => {
  expect(SYSTEM).toContain('en femenino')
  expect(SYSTEM).toContain('lenguaje neutro')
})

test('/narsil estado tells which surfaces asked to draw the band, and which never did', async ($, on) => {
  engine(on)
  on('session.surfaces', () => ({ value: ['desktop', 'mobile'] as const }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.unmount()

  const answer = await $.command.run({ command: 'narsil', args: 'estado', ...TYPED })

  expect(JSON.stringify(answer)).toContain('Superficies: desktop: pidió la banda ahora mismo · mobile: nunca ha pedido la banda')
})

test('with one conversation, or no floating window, nothing is counted', async ($, on) => {
  engine(on, null)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const answer = await $.command.run({ command: 'narsil', args: 'estado', ...TYPED })

  expect(JSON.stringify(answer)).toContain('Esta es la única conversación abierta')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /conversaciones abiertas/ })).toBeUndefined()
  await ui.unmount()
})

test('every state is drawn from the art, light and dark, within the Svg size limit', () => {
  const moods = ['greeting', 'idle', 'thinking', 'talking', 'reading', 'searching', 'writing', 'running', 'asking', 'scared', 'celebrating', 'failed'] as const
  for (const mood of moods) {
    for (let stage = 1; stage <= 5; stage++) {
      const svg = sprite(mood, stage)
      expect(svg.match(/href="data:image\/png;base64,/g)?.length).toBe(2)
      expect(svg.length).toBeLessThan(131072)
    }
  }
})

test('the art is defined once, in the root <defs>', () => {
  const svg = sprite('writing')
  expect(svg.match(/<defs>/g)?.length).toBe(1)
  const defs = svg.slice(svg.indexOf('<defs>'), svg.indexOf('</defs>'))
  expect(defs).toContain('id="art-c"')
  expect(defs).toContain('id="art-o"')
})

test('the desktop band draws Narsil as an image, the only way it shows the embedded art', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const art = await ui.find({ type: 'Svg' })
  expect(art).toBeDefined()
  expect(art?.props.isInteractive).toBeUndefined()
  expect(String(art?.props.source)).toContain('data:image/png;base64,')
  await ui.unmount()
})

test('Narsil names herself, never Claude, in what she says and shows', async ($, on) => {
  const posts = engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'TODO' } as never)

  const event = posts.find(p => p.url.endsWith('/event'))
  expect(event?.body.title).toBe('Te necesito')
  for (const post of posts.filter(p => p.url.endsWith('/state'))) {
    expect(String(post.body.headline)).not.toContain('Claude')
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Estoy buscando: "TODO"' })).toBeDefined()
  await ui.unmount()
})

// --- Narsil's tips ---

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const MINUTE = 60_000
const TIP = 'Has tocado register.tsx: fija su comportamiento con una prueba.'

type Asked = { model: string; prompt: string; system?: string }

// Stands in for the model: records each completion asked for and answers
// with `reply`, a text or a whole result.
function model(on: On, reply: string | ModelCompleteResult = TIP): Asked[] {
  const asked: Asked[] = []
  on('model.complete', (_, e) => {
    asked.push({ model: e.model, prompt: e.prompt, system: e.system })
    return { value: typeof reply === 'string' ? { isAnswered: true as const, text: reply, usage: USAGE } : reply }
  })
  return asked
}

// The engine with a clock the test moves, a session started and the turn's
// own events answered beneath the plugin.
// `hasSteps` keeps the next steps on; `hasPlan` reads a plan's limits.
// `everyMinutes` shortens the throttle, so a test of several tips moves the
// clock (and the 2-second heartbeat with it) only a little. A system with
// no tip window by default: there tips show in the band and the floating
// window; on Windows and macOS they open in a window of their own.
async function tipEngine(
  $: Engine,
  on: On,
  {
    store = {},
    hasTools = true,
    everyMinutes,
    hasSteps = false,
    hasPlan = false,
    os = 'linux',
    runs = [],
  }: { store?: Record<string, unknown>; hasTools?: boolean; everyMinutes?: number; hasSteps?: boolean; hasPlan?: boolean; os?: 'windows' | 'mac' | 'linux'; runs?: Ran[] } = {},
) {
  const posts = engine(on, null, { hasClock: false, store, os, runs })
  const clock = mock.clock(on, { now: 1_000_000 })
  if (hasTools) on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  if (hasPlan) measured(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  if (hasPlan) await $.session.measure({ ...MEASURED, changed: [...MEASURED.changed] })
  // The tip tests count the tip calls alone.
  if (!hasSteps) await $.command.run({ command: 'narsil', args: 'pasos off', ...TYPED })
  if (everyMinutes) await $.command.run({ command: 'narsil', args: `consejos cada ${everyMinutes}`, ...TYPED })
  return { posts, clock }
}

let turns = 0

// One finished turn of the main conversation that edited `file`.
async function finishTurn($: Engine, file = 'C:/repo/hooks/register.tsx') {
  const turnId = `t${++turns}`
  await $.turn.start({ text: 'arregla el registro', turnId })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Listo: he cambiado el registro.', durationMs: 42_000, isAborted: false, turnId })
}

async function bandTip($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const found = await ui.find({ type: 'Text', text: /^💡 / })
  await ui.unmount()
  return found
}

test('on Windows a tip opens whole in its own window, and leaves the band and the floating window free', async ($, on) => {
  model(on)
  const runs: Ran[] = []
  const { posts, clock } = await tipEngine($, on, { os: 'windows', runs })

  await finishTurn($)
  await clock.settle()

  const opened = runs.filter(r => scriptOf(r).endsWith('\\overlay\\tip.ps1'))
  expect(opened.length).toBe(1)
  const env = opened[0]!.env
  expect(env.NARSIL_TEXT).toBe(TIP)
  expect(env.NARSIL_LINK).toBe('claude://code/continue?session=local_abc-123&source=desktop_action')
  expect(env.NARSIL_STAGE).toBe('1')
  expect(env.NARSIL_SECONDS).toBe('180')
  expect(String(env.NARSIL_ASSETS).endsWith('\\assets')).toBe(true)
  // the band and the floating window keep their room for the rest
  for (const surface of ['terminal', 'desktop'] as const) expect(await bandTip($, surface)).toBeUndefined()
  expect(windowTip(posts)).toBeNull()
  // a tip asked for opens there too
  await $.command.run({ command: 'narsil', args: 'consejo', ...TYPED })
  expect(runs.filter(r => scriptOf(r).endsWith('\\overlay\\tip.ps1')).length).toBe(2)
})

test('on macOS a tip opens whole in its own window too, through tip.sh, detached', async ($, on) => {
  model(on)
  const runs: Ran[] = []
  const { posts, clock } = await tipEngine($, on, { os: 'mac', runs })

  await finishTurn($)
  await clock.settle()

  const opened = runs.filter(r => scriptOf(r).endsWith('/overlay/tip.sh'))
  expect(opened.length).toBe(1)
  expect(opened[0]!.argv).toEqual(['/bin/sh', '-c', 'nohup /bin/sh "$NARSIL_SCRIPT" </dev/null >/dev/null 2>&1 &'])
  const env = opened[0]!.env
  expect(env.NARSIL_TEXT).toBe(TIP)
  expect(env.NARSIL_STAGE).toBe('1')
  expect(env.NARSIL_SECONDS).toBe('180')
  expect(String(env.NARSIL_ASSETS).endsWith('/assets')).toBe(true)
  // where the floating window says it is, to open above it
  expect(env.NARSIL_OVERLAY).toBe('http://127.0.0.1:47190')
  for (const surface of ['terminal', 'desktop'] as const) expect(await bandTip($, surface)).toBeUndefined()
  expect(windowTip(posts)).toBeNull()
})

test('the tip window opens with her stage, grown with her', async ($, on) => {
  model(on)
  const runs: Ran[] = []
  // 3600 XP is level 9: stage 2
  const { clock } = await tipEngine($, on, { os: 'windows', runs, store: { xp: 3600 } })
  await finishTurn($)
  await clock.settle()
  expect(runs.find(r => scriptOf(r).endsWith('\\overlay\\tip.ps1'))?.env.NARSIL_STAGE).toBe('2')
})

test('a finished turn gives a tip about it, under the headline and in the window', async ($, on) => {
  const asked = model(on)
  const { posts, clock } = await tipEngine($, on)

  await finishTurn($)
  await clock.settle()

  expect(asked.length).toBe(1)
  expect(asked[0]?.model).toBe('haiku')
  expect(asked[0]?.prompt).toContain('register.tsx')
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await bandTip($, surface)).toBeDefined()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const first = texts.findIndex(t => t.startsWith('💡 '))
  expect(`${texts[first]} ${texts[first + 1]}`).toBe(`💡 ${TIP}`)
  await ui.unmount()
  const state = posts.filter(p => p.url.endsWith('/state')).at(-1)
  expect(state?.body.tip).toBe(TIP)
})

test('a tip is dismissed with its ×, and leaves on its own after 3 minutes', async ($, on) => {
  model(on)
  const { clock } = await tipEngine($, on, { everyMinutes: 1 })
  await finishTurn($)
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'tip-dismiss' })
  expect(await ui.find({ type: 'Text', text: /^💡 / })).toBeUndefined()
  await ui.unmount()

  await clock.advance(3 * MINUTE)
  await finishTurn($, 'C:/repo/b.ts')
  await clock.settle()
  expect(await bandTip($, 'desktop')).toBeDefined()
  await clock.advance(3 * MINUTE + 2000)
  expect(await bandTip($, 'desktop')).toBeUndefined()
})

test('the floating window keeps the tip after it leaves the band, for 15 minutes', async ($, on) => {
  model(on)
  const { posts, clock } = await tipEngine($, on)
  const lastTip = () => posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.tip
  await finishTurn($)
  await clock.settle()

  await clock.advance(5 * MINUTE)
  expect(await bandTip($, 'desktop')).toBeUndefined()
  expect(lastTip()).toBe(TIP)

  await clock.advance(10 * MINUTE + 2000)
  expect(lastTip()).toBeNull()
})

test('a long tip and headline wrap or are cut inside the band, never widen it', async ($, on) => {
  model(on, `${'Divide la tarea en pasos pequeños antes de seguir con register.tsx; '.repeat(3)}`.trim())
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 20_000, window: 200_000, percent: 10 }, rateLimits: [] } }))
  const { clock } = await tipEngine($, on)
  await $.tool.call({ tool: 'Bash', command: `npm run build -- ${'--flag '.repeat(40)}` })
  await finishTurn($)
  await clock.settle()

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // the tip is broken into at most 3 short lines, each cut at the band's edge
  const texts = await desk.findAll({ type: 'Text' })
  const first = texts.findIndex(t => t.text.startsWith('💡 '))
  const tipLines = texts.slice(first, first + 3)
  for (const line of tipLines) {
    expect(line.text.length).toBeLessThanOrEqual(60)
    expect(line.props.wrap).toBe('truncate-end')
  }
  expect(tipLines[2]?.text.endsWith('…')).toBe(true)
  expect(texts[first + 3]?.text.startsWith('Divide')).not.toBe(true)
  const head = texts.find(t => t.text.startsWith('He terminado'))
  expect(head?.props.wrap).toBe('truncate-end')
  for (const box of await desk.findAll({ type: 'Box' })) {
    if (box.props.flexDirection === 'column') expect(box.props.minWidth).toBe(0)
  }
  // the usage bars scale to the room the band has
  const bars = (await desk.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Uso:'))
  expect(bars).toBeDefined()
  expect(bars?.props.width).toBeUndefined()
  await desk.unmount()
})

test('SKIP or an empty reply shows nothing', async ($, on) => {
  let reply: ModelCompleteResult = { isAnswered: true, text: 'SKIP', usage: USAGE }
  let calls = 0
  on('model.complete', () => {
    calls += 1
    return { value: reply }
  })
  const { clock } = await tipEngine($, on, { everyMinutes: 1 })

  await finishTurn($)
  await clock.settle()
  expect(calls).toBe(1)
  expect(await bandTip($, 'desktop')).toBeUndefined()

  reply = { isAnswered: false, reason: 'empty-reply', usage: USAGE }
  await clock.advance(3 * MINUTE)
  await finishTurn($, 'C:/repo/b.ts')
  await clock.settle()
  expect(calls).toBe(2)
  expect(await bandTip($, 'terminal')).toBeUndefined()
})

test('a second finished turn within 10 minutes asks the model nothing', async ($, on) => {
  const asked = model(on)
  const { clock } = await tipEngine($, on)

  await finishTurn($)
  await clock.settle()
  await clock.advance(5 * MINUTE)
  await finishTurn($, 'C:/repo/b.ts')
  await clock.settle()

  expect(asked.length).toBe(1)
})

test('two failures of the same tool give one debugging tip', async ($, on) => {
  const asked = model(on, 'El mismo error de npm test dos veces: lee la primera línea roja.')
  let shouldFail = false
  on('tool.call', () => (shouldFail ? { isError: true, result: 'boom', text: 'Error: cannot find module ./x' } : { result: {} }))
  const { clock } = await tipEngine($, on, { hasTools: false })
  await $.turn.start({ text: 'pasa los tests', turnId: 'debug' })

  shouldFail = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await clock.settle()
  expect(asked.length).toBe(0)
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await clock.settle()

  expect(asked.length).toBe(1)
  expect(asked[0]?.prompt).toContain('depurar')
  expect(asked[0]?.prompt).toContain('cannot find module')
  expect(await bandTip($, 'desktop')).toBeDefined()
})

test('/narsil consejos off stops automatic tips, and /narsil consejo still answers', async ($, on) => {
  const asked = model(on)
  const { clock } = await tipEngine($, on)

  const off = await $.command.run({ command: 'narsil', args: 'consejos off', ...TYPED })
  expect(JSON.stringify(off)).toContain('consejos desactivados')
  await finishTurn($)
  await clock.settle()
  expect(asked.length).toBe(0)

  const answer = await $.command.run({ command: 'narsil', args: 'consejo', ...TYPED })
  expect(asked.length).toBe(1)
  expect(JSON.stringify(answer)).toContain(`Narsil: 💡 ${TIP}`)
  expect(await bandTip($, 'desktop')).toBeDefined()
})

test('/narsil consejo profundo asks over the conversation itself', async ($, on) => {
  const asked = model(on)
  const forked: string[] = []
  on('model.fork', (_, e) => {
    forked.push(e.prompt)
    return { value: { isAnswered: true as const, text: 'Claude ha cambiado tres archivos sin probarlos: prueba antes de seguir.', usage: USAGE } }
  })
  await tipEngine($, on)

  const answer = await $.command.run({ command: 'narsil', args: 'consejo  profundo', ...TYPED })

  expect(forked.length).toBe(1)
  expect(forked[0]).toContain('Narsil')
  expect(asked.length).toBe(0)
  // Narsil names herself, never Claude.
  expect(JSON.stringify(answer)).toContain('Narsil: 💡 Narsil ha cambiado tres archivos sin probarlos')
  expect(JSON.stringify(answer)).not.toContain('Claude')
})

test('a secret never reaches the prompt sent to the model', async ($, on) => {
  const asked = model(on)
  const { clock } = await tipEngine($, on)

  await $.prompt.submit({ text: 'usa API_KEY=abc123 para el despliegue', wait: false, origin: TYPED.origin })
  await $.turn.start({ text: 'usa API_KEY=abc123 para el despliegue', turnId: 'secret' })
  await $.tool.call({ tool: 'Bash', command: 'API_KEY=abc123 npm run deploy' })
  await $.tool.call({ tool: 'Bash', command: 'curl -H token:ghp_0123456789abcdefABCDEF0123456789abcd https://x' })
  await $.turn.complete({ reason: 'answer', answer: 'Hecho con password: hunter2.', durationMs: 1000, isAborted: false, turnId: 'secret' })
  await clock.settle()

  expect(asked.length).toBe(1)
  const sent = `${asked[0]?.system}\n${asked[0]?.prompt}`
  expect(sent).toContain('despliegue')
  expect(sent).not.toContain('abc123')
  expect(sent).not.toContain('ghp_0123456789')
  expect(sent).not.toContain('hunter2')
})

test('a failed, timed-out or rejected model call shows nothing and breaks nothing', async ($, on) => {
  let calls = 0
  on('model.complete', () => {
    calls += 1
    if (calls === 1) return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: USAGE } }
    if (calls === 2) return { value: { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE } }
    return { deny: 'model blocked' }
  })
  const { clock } = await tipEngine($, on, { everyMinutes: 1 })

  for (const file of ['a.ts', 'b.ts', 'c.ts']) {
    await finishTurn($, `C:/repo/${file}`)
    await clock.settle()
    expect(await bandTip($, 'desktop')).toBeUndefined()
    await clock.advance(3 * MINUTE)
  }
  expect(calls).toBe(3)
  const answer = await $.command.run({ command: 'narsil', args: 'consejo', ...TYPED })
  expect(JSON.stringify(answer)).toContain('Narsil: ahora mismo no tengo un consejo útil')
})

test('prefs stored before tips existed get the tip defaults', async ($, on) => {
  await tipEngine($, on, { store: { prefs: { isHidden: false, isMuted: true, isFloating: false } } })

  const answer = await $.command.run({ command: 'narsil', args: '', ...TYPED })

  expect(JSON.stringify(answer)).toContain('la voz apagada')
  expect(JSON.stringify(answer)).toContain('Consejos activados (como mucho uno cada 10 min)')
})

// --- How much Claude has spent ---

const NOW = 1_000_000
const IN_2H05 = new Date(NOW + 125 * MINUTE).toISOString()
const IN_3D = new Date(NOW + (3 * 24 * 60 + 4 * 60) * MINUTE).toISOString()

const MEASURED = {
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 18, resetsAt: IN_2H05 },
    { kind: 'seven_day', percentUsed: 91, resetsAt: IN_3D },
  ],
  changed: ['context', 'rateLimits'] as const,
}

function measured(on: On): void {
  on('session.measure', (_, e) => ({ changed: e.changed }))
}

test('the band shows bars for the context, the 5-hour window and the week', async ($, on) => {
  const posts = engine(on)
  measured(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.session.measure({ ...MEASURED, changed: [...MEASURED.changed] })

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const bars = (await desk.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Uso:'))
  expect(bars?.props.alt).toBe('Uso: contexto 42 % (84k / 200k), 5 horas 18 % (reinicia en 2 h 05 min), semana 91 % (reinicia en 3 d 4 h)')
  expect(bars?.props.isInteractive).toBeUndefined()
  // Green while there is room, red past 85 %.
  expect(String(bars?.props.source)).toContain('#22B573')
  expect(String(bars?.props.source)).toContain('#F0435A')
  await desk.unmount()

  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: '████░░░░░░' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: ' 42 %' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: ' 91 %' })).toBeDefined()
  await term.unmount()

  const state = posts.filter(p => p.url.endsWith('/state')).at(-1)
  expect((state?.body.usage as unknown[]).length).toBe(3)
})

test('with no reading yet, no bars are drawn', async ($, on) => {
  engine(on)
  measured(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['context'] })

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await desk.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Uso:'))).toBeUndefined()
  await desk.unmount()
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /%$/ })).toBeUndefined()
  await term.unmount()
})

test('off a plan, only the context bar shows, read when the session starts', async ($, on) => {
  engine(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 150_000, window: 200_000, percent: 75 }, rateLimits: [] } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const bars = (await desk.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Uso:'))
  expect(bars?.props.alt).toBe('Uso: contexto 75 % (150k / 200k)')
  expect(String(bars?.props.source)).toContain('#F5B400')
  await desk.unmount()
})

// A clock the test moves: `at(minutes)` sets it that far past NOW.
function movingClock(on: On): (minutes: number) => void {
  let now = NOW
  on('clock.now', () => ({ value: now }))
  on('clock.after', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  return minutes => {
    now = NOW + minutes * MINUTE
  }
}

const contextAt = (percent: number) => ({
  context: { tokens: percent * 2000, window: 200_000, percent },
  rateLimits: [],
  changed: ['context' as const],
})

test('the context bar tells when it will fill, and Narsil suggests /compact once when it is near', async ($, on) => {
  // no tip window here: the suggestion shows in the band
  const posts = engine(on, null, { hasClock: false, os: 'linux' })
  const at = movingClock(on)
  measured(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.session.measure(contextAt(50))
  at(5)
  await $.session.measure(contextAt(60))
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const bars = (await desk.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Uso:'))
  // 2 % a minute: the remaining 40 % in 20 min
  expect(bars?.props.alt).toBe('Uso: contexto 60 % (120k / 200k · lleno en ~20 min)')
  await desk.unmount()
  expect(posts.some(p => String(p.body.tip).includes('/compact'))).toBe(false)

  at(10)
  await $.session.measure(contextAt(72))
  at(11)
  await $.session.measure(contextAt(74))

  const nudges = new Set(posts.map(p => p.body.tip).filter(t => String(t).includes('/compact')))
  expect([...nudges]).toEqual(['El contexto va al 72 % y se llenará en ~13 min: es buen momento para /compact.'])
})

test('a context that is not growing shows no estimate and no nudge', async ($, on) => {
  const posts = engine(on, null, { hasClock: false })
  const at = movingClock(on)
  measured(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.session.measure(contextAt(40))
  at(5)
  await $.session.measure(contextAt(20))

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const bars = (await desk.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Uso:'))
  expect(bars?.props.alt).toBe('Uso: contexto 20 % (40k / 200k)')
  await desk.unmount()
  expect(posts.some(p => String(p.body.tip).includes('/compact'))).toBe(false)
})

// --- Reactions to what Claude runs ---

test('tests that pass are cheered, and failing ones are noticed until they pass again', async ($, on) => {
  engine(on)
  let shouldFail = true
  on('tool.call', () => (shouldFail ? { isError: true, result: 'boom', text: 'boom' } : { result: {} }))
  const lineShown = async (text: string) => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const found = await ui.find({ type: 'Text', text })
    await ui.unmount()
    return found !== undefined
  }

  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  expect(await lineShown('Los tests fallan; vamos a ver por qué.')).toBe(true)

  shouldFail = false
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --watch=false' })
  expect(await lineShown('¡Recuperados! Los tests vuelven a pasar.')).toBe(true)

  await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
  expect(await lineShown('¡Los tests pasan! 🎉')).toBe(true)

  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  expect(await lineShown('¡Los tests pasan! 🎉')).toBe(false)
})

test('a dangerous command is flagged before it runs, and an ordinary one is not', async ($, on) => {
  const posts = engine(on)
  const seenLines: string[] = []
  on('tool.call', () => {
    seenLines.push(String(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.line))
    return { result: {} }
  })

  for (const command of ['rm -rf build', 'git push --force origin main', 'git reset --hard HEAD~1', 'Remove-Item -Recurse -Force dist']) {
    await $.tool.call({ tool: 'Bash', command })
  }
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(seenLines.slice(0, 4)).toEqual([
    '⚠️ Cuidado: rm -rf no tiene vuelta atrás.',
    '⚠️ Cuidado: git push --force no tiene vuelta atrás.',
    '⚠️ Cuidado: git reset --hard no tiene vuelta atrás.',
    '⚠️ Cuidado: Remove-Item -Recurse -Force no tiene vuelta atrás.',
  ])
  expect(seenLines[4]).not.toContain('Cuidado')
})

test('Narsil moves visibly in every state', () => {
  const moods = ['greeting', 'idle', 'thinking', 'talking', 'reading', 'searching', 'writing', 'running', 'asking', 'scared', 'celebrating', 'failed'] as const
  for (const mood of moods) {
    const svg = sprite(mood)
    // the water she swims in, and bubbles rising through it
    expect(svg).toContain('class="ripple"')
    expect(svg.match(/class="bub"/g)?.length).toBe(7)
  }
  // a whole-body motion of its own for each state, far larger than a bob
  // (stage 2 moves at the measure the others are scaled from)
  expect(sprite('writing', 2)).toContain('@keyframes swim{')
  expect(sprite('writing', 2)).toMatch(/translate\(0,-7px\) rotate\(3deg\)/)
  expect(sprite('celebrating', 2)).toMatch(/translateY\(-26px\) rotate\(-10deg\)/)
  expect(sprite('celebrating').match(/class="confetti"/g)?.length).toBe(12)
  expect(sprite('asking')).toContain('class="aura"')
  expect(sprite('idle')).not.toContain('class="aura"')
})

test('she is drawn once per theme, sharp, so no part of her shows twice', () => {
  for (const mood of ['writing', 'idle', 'asking', 'thinking', 'celebrating', 'failed'] as const) {
    for (let stage = 1; stage <= 5; stage++) {
      const svg = sprite(mood, stage)
      for (const id of ['c', 'o']) expect(svg.split(`<use href="#art-${id}"/>`).length - 1).toBe(1)
      expect(svg).not.toContain('<mask')
      expect(svg).not.toContain('feDisplacementMap')
    }
  }
})

// How high she leaps when done, and how long one leap takes, at a stage.
function leapOf(stage: number): { height: number; seconds: number } {
  const svg = sprite('celebrating', stage)
  const height = Number(/@keyframes leap\{[^@]*?translateY\(-([\d.]+)px\) rotate/.exec(svg)?.[1])
  const seconds = Number(/\.s-done \.whole\{animation:leap ([\d.]+)s/.exec(svg)?.[1])
  return { height, seconds }
}

test('the hatchling bounces light and quick, the grown serpent moves slow and heavy', () => {
  const leaps = [1, 2, 3, 4, 5].map(leapOf)
  expect(leaps[1]).toEqual({ height: 26, seconds: 0.85 })
  for (let i = 1; i < leaps.length; i++) {
    expect(leaps[i]!.height).toBeLessThan(leaps[i - 1]!.height)
    expect(leaps[i]!.seconds).toBeGreaterThan(leaps[i - 1]!.seconds)
  }
})

test('her shadow on the water shrinks as she leaps, in step with her', () => {
  const cases = [['asking', 'shadow-hop', 'waiting'], ['celebrating', 'shadow-leap', 'done'], ['writing', 'shadow-swim', 'working'], ['idle', 'shadow-breathe', 'idle']] as const
  for (const [mood, keyframes, status] of cases) {
    const svg = sprite(mood, 3)
    expect(svg.match(/<ellipse class="shadow"/g)?.length).toBe(1)
    expect(svg).toContain(`@keyframes ${keyframes}{`)
    // the same length as her own motion
    const seconds = new RegExp(String.raw`\.s-${status} \.whole\{animation:\w+ ([\d.]+)s`).exec(svg)?.[1]
    expect(seconds).toBeDefined()
    expect(svg).toContain(`.s-${status} .shadow{animation:${keyframes} ${seconds}s`)
  }
})

test('water splashes where she lands, and only when she jumps', () => {
  for (const mood of ['asking', 'celebrating', 'greeting'] as const) expect(sprite(mood).match(/class="drop"/g)?.length).toBe(6)
  for (const mood of ['idle', 'writing', 'failed', 'thinking'] as const) expect(sprite(mood)).not.toContain('class="drop"')
})

test('an error is a start and then a soft tremble, not an endless shake', () => {
  const svg = sprite('failed')
  expect(svg).toMatch(/\.s-error \.whole\{animation:jolt [\d.]+s ease-out 1,tremble /)
  expect(svg).not.toContain('@keyframes shake')
})

test('her glow is a cheap aura, never a filter redrawn each frame, and she keeps still when motion is reduced', () => {
  const moods = ['greeting', 'idle', 'thinking', 'writing', 'asking', 'scared', 'celebrating', 'failed'] as const
  for (const mood of moods) {
    for (const svg of [sprite(mood, 4), sprite(mood, 4, { kind: 'level', level: 9, stage: 4 })]) {
      expect(svg).not.toContain('drop-shadow')
      expect(svg).not.toContain('saturate')
      expect(svg).toContain('@media (prefers-reduced-motion: reduce){*{animation:none!important}}')
    }
  }
})

test('in the light theme the glow and halo are fainter, so her pale body keeps its contrast', () => {
  const svg = sprite('asking')
  expect(svg).toContain('<radialGradient id="aura-o"><stop offset="0" stop-color="#F5B400" stop-opacity="0.5"/>')
  expect(svg).toContain('<radialGradient id="aura-c"><stop offset="0" stop-color="#F5B400" stop-opacity="0.2"/>')
  const halos = svg.match(/<circle class="halo"[^>]*>/g) ?? []
  expect(halos.length).toBe(2)
  expect(halos.filter(h => h.includes('fill-opacity=".55"')).length).toBe(1)
})

// --- Each system's own voice, notifications and floating window ---

// A fresh store each time: the test engine keeps what the mod writes to it.
const noWindow = () => ({ prefs: { isHidden: false, isMuted: false, isFloating: false } })
const scriptOf = (r: Ran) => r.env.NARSIL_SCRIPT ?? ''

test('on macOS Narsil speaks and notifies with its own scripts, detached, never PowerShell', async ($, on) => {
  const runs: Ran[] = []
  engine(on, null, { os: 'mac', runs, store: noWindow() })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.command.run({ command: 'narsil', args: 'prueba', ...TYPED })

  const launched = runs.filter(r => r.argv[0] === '/bin/sh' && r.argv[1] === '-c')
  for (const r of launched) {
    expect(r.argv[2]).toBe('nohup /bin/sh "$NARSIL_SCRIPT" </dev/null >/dev/null 2>&1 &')
  }
  const voice = launched.find(r => scriptOf(r).endsWith('/overlay/speak.sh'))
  expect(voice?.env.NARSIL_TEXT).toBe('Hola, soy Narsil. Así sonaré cuando termine.')
  const toast = launched.find(r => scriptOf(r).endsWith('/overlay/toast.sh'))
  expect(toast?.env.NARSIL_TITLE).toBe('Narsil · Así te avisaré')
  expect(toast?.env.NARSIL_TEXT).toBe('Haz clic para volver a esta conversación.')
  expect(runs.some(r => r.argv[0] === 'powershell.exe')).toBe(false)
})

test('Narsil speaks of herself in the first person', async ($, on) => {
  const runs: Ran[] = []
  engine(on, null, { os: 'mac', runs, store: noWindow() })
  let shouldFail = false
  on('tool.call', () => (shouldFail ? { isError: true, result: 'boom', text: 'boom' } : { result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const spoken = () => runs.filter(r => scriptOf(r).endsWith('/overlay/speak.sh')).map(r => r.env.NARSIL_TEXT)

  await finishTurn($)
  expect(spoken()).toContain('Ya está, ya terminé.')

  await $.turn.start({ text: 'otra', turnId: 'err' })
  await $.turn.complete({ reason: 'error', answer: '', durationMs: 1000, isAborted: false, turnId: 'err', error: 'api' } as never)
  expect(spoken()).toContain('Uy, me detuve por un error.')

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(spoken()).toContain('Te necesito.')

  shouldFail = true
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  expect(spoken()).toContain('Creo que esto se está repitiendo.')
  expect(spoken().some(t => String(t).includes('Narsil'))).toBe(false)
})

test('on macOS the floating window starts through start.sh with the overlay token', async ($, on) => {
  const runs: Ran[] = []
  engine(on, null, { os: 'mac', runs, store: noWindow() })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const answer = await $.command.run({ command: 'narsil', args: 'flotante', ...TYPED })

  expect(JSON.stringify(answer)).toContain('ventana flotante activada')
  const start = runs.find(r => r.argv[0] === '/bin/sh' && String(r.argv[1]).endsWith('/overlay/start.sh'))
  expect(start?.env.NARSIL_TOKEN).toBe('secret-token')
  expect(start?.env.NARSIL_PORT).toBe('47190')
})

test('with the window on but down, an event starts it again and shows there, never as a notification', async ($, on) => {
  const runs: Ran[] = []
  const posts = engine(on, null, { os: 'windows', runs, isOverlayDown: true })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)

  expect(runs.some(r => String(r.env.NARSIL_SERVER).endsWith('\\overlay\\server.cjs'))).toBe(true)
  const asked = posts.find(p => p.url.endsWith('/event'))
  expect(asked?.body.kind).toBe('question')
  expect(asked?.body.title).toBe('Te necesito')
  expect(runs.some(r => scriptOf(r).endsWith('toast.ps1'))).toBe(false)
})

test('on Windows Narsil still speaks and starts the window through PowerShell', async ($, on) => {
  const runs: Ran[] = []
  engine(on, null, { os: 'windows', runs, store: noWindow() })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.command.run({ command: 'narsil', args: 'prueba', ...TYPED })
  await $.command.run({ command: 'narsil', args: 'flotante', ...TYPED })

  const powershell = runs.filter(r => r.argv[0] === 'powershell.exe')
  expect(powershell.some(r => scriptOf(r).endsWith('\\overlay\\speak.ps1'))).toBe(true)
  expect(powershell.some(r => scriptOf(r).endsWith('\\overlay\\toast.ps1'))).toBe(true)
  expect(powershell.some(r => String(r.env.NARSIL_SERVER).endsWith('\\overlay\\server.cjs'))).toBe(true)
  expect(runs.some(r => r.argv[0] === '/bin/sh')).toBe(false)
})

test('on another system Narsil runs none of her scripts', async ($, on) => {
  const runs: Ran[] = []
  engine(on, null, { os: 'linux', runs, store: noWindow() })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.command.run({ command: 'narsil', args: 'prueba', ...TYPED })
  await $.command.run({ command: 'narsil', args: 'flotante', ...TYPED })

  expect(runs.filter(r => r.argv[0] !== 'uname')).toEqual([])
})

// --- The prompt cache and the next steps ---

const STEPS = '1. Ejecuta los tests de register.tsx\n2. Revisa el diff antes del commit\n3. Prueba el overlay en vivo'

// Answers the next-steps call with `steps` and any tip call with TIP; records
// which of the two each call was.
function stepsModel(on: On, steps = STEPS): string[] {
  const kinds: string[] = []
  on('model.complete', (_, e) => {
    const isSteps = String(e.system).includes('próximos pasos')
    kinds.push(isSteps ? 'steps' : 'tip')
    return { value: { isAnswered: true as const, text: isSteps ? steps : TIP, usage: USAGE } }
  })
  return kinds
}

async function bandTexts($: Engine, surface: 'terminal' | 'desktop'): Promise<string[]> {
  const ui = await $.ui.mount({ ...BAND, surface })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  await ui.unmount()
  return texts
}

test('after a turn the band counts down the prompt cache, and says when it has gone cold', async ($, on) => {
  stepsModel(on)
  const { posts, clock } = await tipEngine($, on, { hasSteps: true })
  expect((await bandTexts($, 'desktop')).some(t => t.includes('Caché'))).toBe(false)

  await finishTurn($)
  await clock.settle()
  // Off a plan the cache lasts 5 minutes.
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await bandTexts($, surface)).toContain('🧊 Caché: 5 min')
  }
  await clock.advance(3 * MINUTE)
  expect(await bandTexts($, 'desktop')).toContain('🧊 Caché: 2 min')
  expect(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.cache).toBe('🧊 Caché: 2 min')

  await clock.advance(2 * MINUTE + 2000)
  expect(await bandTexts($, 'desktop')).toContain('🧊 Caché fría: el próximo mensaje se cobra completo')

  // A new turn writes the cache again: no clock while Claude works.
  await $.turn.start({ text: 'sigue', turnId: 'next' })
  expect((await bandTexts($, 'desktop')).some(t => t.includes('Caché'))).toBe(false)
})

test('on a plan the cache lasts an hour, and /narsil cache sets it by hand', async ($, on) => {
  stepsModel(on)
  const { clock } = await tipEngine($, on, { hasSteps: true, hasPlan: true })
  await finishTurn($)
  await clock.settle()
  expect(await bandTexts($, 'desktop')).toContain('🧊 Caché: 60 min')

  const answer = await $.command.run({ command: 'narsil', args: 'cache 5', ...TYPED })
  expect(JSON.stringify(answer)).toContain('5 min')
  expect(await bandTexts($, 'desktop')).toContain('🧊 Caché: 5 min')
})

test('a few minutes after a turn Narsil offers next steps, and one click puts it in the prompt', async ($, on) => {
  const kinds = stepsModel(on)
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  const { posts, clock } = await tipEngine($, on, { hasSteps: true })
  await finishTurn($)
  await clock.settle()
  expect(kinds).toEqual(['tip'])

  await clock.advance(3 * MINUTE + 2000)
  await clock.settle()
  expect(kinds).toEqual(['tip', 'steps'])
  const state = posts.filter(p => p.url.endsWith('/state')).at(-1)
  expect(state?.body.steps).toEqual(['Ejecuta los tests de register.tsx', 'Revisa el diff antes del commit', 'Prueba el overlay en vivo'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'step-2' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'step-1' })
  await ui.unmount()
  expect(filled).toEqual(['Revisa el diff antes del commit'])
  // A picked step clears the others.
  const after = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await after.find({ key: 'step-0' })).toBeUndefined()
  await after.unmount()

  // Asked once per finished turn.
  await clock.advance(10 * MINUTE)
  expect(kinds).toEqual(['tip', 'steps'])
})

test('a new turn before the minutes pass, or /narsil pasos off, offers no next steps', async ($, on) => {
  const kinds = stepsModel(on)
  const { clock } = await tipEngine($, on, { hasSteps: true })
  await finishTurn($)
  await clock.advance(1 * MINUTE)
  await $.turn.start({ text: 'otra cosa', turnId: 'again' })
  await clock.advance(5 * MINUTE)
  expect(kinds.includes('steps')).toBe(false)

  const answer = await $.command.run({ command: 'narsil', args: 'pasos off', ...TYPED })
  expect(JSON.stringify(answer)).toContain('desactivados')
  await finishTurn($)
  await clock.advance(5 * MINUTE)
  await clock.settle()
  expect(kinds.includes('steps')).toBe(false)
})

test('the next-steps prompt asks for short actionable steps in neutral wording', () => {
  expect(STEPS_SYSTEM).toContain('próximos pasos')
  expect(STEPS_SYSTEM).toContain('lenguaje neutro')
  expect(parseSteps('- Uno\n2) Dos\n\n3. Tres\n4. Cuatro')).toEqual(['Uno', 'Dos', 'Tres'])
  expect(parseSteps('SKIP')).toEqual([])
})
// The engine with a clock the test moves, where every spawn starts the
// subagent `ids` names next.
async function agentEngine($: Engine, on: On, ids: string[]) {
  let n = 0
  on('agent.spawn', () => ({ model: 'haiku', agentId: ids[n++] ?? `a${n}` }))
  return tipEngine($, on)
}

const spawn = ($: Engine, description: string, subagentType = 'general-purpose') =>
  $.agent.spawn({ prompt: description, description, subagentType })

const agentDone = ($: Engine, agentId: string, reason: 'answer' | 'aborted' | 'error' = 'answer', durationMs = 80_000) =>
  $.turn.complete({ reason, answer: 'hecho', durationMs, isAborted: reason === 'aborted', turnId: `${agentId}-turn`, agentId } as never)

const chips = async ($: Engine, surface: 'terminal' | 'desktop' = 'desktop') =>
  (await bandTexts($, surface)).filter(t => /^(🐍|✓|✗|■)/.test(t))

test('each subagent shows its type, how long it has run, and when it has gone quiet', async ($, on) => {
  const { posts, clock } = await agentEngine($, on, ['a1', 'a2'])
  await spawn($, 'Map the overlay', 'Explore')
  await spawn($, 'Review the tests')
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await chips($, surface)).toEqual(['🐍🔍 Map the overlay', '🐍 Review the tests'])
  }

  await clock.advance(2 * MINUTE)
  expect(await chips($)).toEqual(['🐍🔍 Map the overlay · 2 min', '🐍 Review the tests · 2 min'])
  // The explorer reads a file: it is busy, the reviewer is not.
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/overlay.html', agentId: 'a1' } as never)
  await clock.advance(4 * MINUTE)
  expect(await chips($)).toEqual(['🐍🔍 Map the overlay · 6 min', '🐍 Review the tests · 6 min · sin actividad'])

  const sent = posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.agents as { text: string; color: string }[]
  expect(sent.map(a => a.text)).toEqual(['🐍🔍 Map the overlay · 6 min', '🐍 Review the tests · 6 min · sin actividad'])
  expect(sent[1]?.color).toBe('#F5B400')
})

test('a finished subagent stays a few seconds with how it ended, then leaves', async ($, on) => {
  const { posts, clock } = await agentEngine($, on, ['a1', 'a2', 'a3'])
  await spawn($, 'Map the overlay', 'Plan')
  await spawn($, 'Review the tests')
  await spawn($, 'Write the docs')
  await clock.advance(80_000)

  await agentDone($, 'a1')
  await agentDone($, 'a2', 'error')
  await agentDone($, 'a3', 'aborted')
  expect(await chips($)).toEqual([
    '✓ Map the overlay · terminado en 1 min 20 s',
    '✗ Review the tests · falló',
    '■ Write the docs · detenido',
  ])
  const sent = posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.agents as { color: string }[]
  expect(sent.map(a => a.color)).toEqual(['#22B573', '#F0435A', '#8A90A6'])

  await clock.advance(12_000)
  expect(await chips($)).toEqual([])
  expect(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.agents).toEqual([])
  // The main conversation is still where it was: a subagent's end is not hers.
  expect(posts.some(p => p.url.endsWith('/event'))).toBe(false)
})

test('the subagent chips show each type with its own mark', () => {
  const at = { id: 'x', task: 'Tarea', startedAt: 0, lastActiveAt: 0, isBackground: false }
  expect(agentChip({ ...at, type: 'Explore' }, 0).text).toBe('🐍🔍 Tarea')
  expect(agentChip({ ...at, type: 'Plan' }, 0).text).toBe('🐍📜 Tarea')
  expect(agentChip({ ...at, type: 'claude-code-guide' }, 0).text).toBe('🐍📖 Tarea')
  expect(agentChip({ ...at, type: 'general-purpose' }, 0).text).toBe('🐍 Tarea')
  expect(agentChip({ ...at, type: 'mi-agente' }, 0).text).toBe('🐍✨ Tarea')
})

// --- Loops, a permission left waiting, and the session's summary ---

// The tip the floating window was last sent, whole.
function windowTip(posts: Posted[]): unknown {
  return posts.filter(p => p.url.endsWith('/state')).pop()?.body.tip
}

function events(posts: Posted[], title: string): Posted[] {
  return posts.filter(p => p.url.endsWith('/event') && p.body.title === title)
}

test('the same command failing three times in a row is warned about once, as a loop', async ($, on) => {
  model(on, 'SKIP')
  let shouldFail = true
  on('tool.call', () => (shouldFail ? { isError: true, result: 'boom', text: 'boom' } : { result: {} }))
  const { posts, clock } = await tipEngine($, on, { hasTools: false })
  await $.turn.start({ text: 'arregla los tests', turnId: 'loop' })

  for (let i = 0; i < 2; i++) {
    shouldFail = true
    await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
    shouldFail = false
    await $.tool.call({ tool: 'Edit', file_path: 'C:/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  }
  await clock.settle()
  expect(events(posts, 'Veo un bucle')).toHaveLength(0)

  shouldFail = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await clock.settle()
  const warned = events(posts, 'Veo un bucle')
  expect(warned).toHaveLength(1)
  expect(warned[0]!.body.kind).toBe('question')
  expect(warned[0]!.body.text).toBe('El comando «npm test» ha fallado 3 veces seguidas. Esto se está repitiendo: ¿lo replanteamos?')
  expect(windowTip(posts)).toBe(warned[0]!.body.text)
})

test('a success starts the count over, and a new turn too', async ($, on) => {
  model(on, 'SKIP')
  let shouldFail = true
  on('tool.call', () => (shouldFail ? { isError: true, result: 'boom', text: 'boom' } : { result: {} }))
  const { posts, clock } = await tipEngine($, on, { hasTools: false })
  await $.turn.start({ text: 'arregla', turnId: 'a' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  shouldFail = false
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  shouldFail = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await $.turn.start({ text: 'otra vez', turnId: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await clock.settle()

  expect(events(posts, 'Veo un bucle')).toHaveLength(0)
})

test('the same file edited six times in one turn is warned about as a loop', async ($, on) => {
  model(on, 'SKIP')
  const { posts, clock } = await tipEngine($, on)
  await $.turn.start({ text: 'arregla', turnId: 'edits' })
  for (let i = 0; i < 7; i++) {
    await $.tool.call({ tool: 'Edit', file_path: 'C:/repo/app.ts', old_string: 'a', new_string: 'b' } as never)
  }
  await clock.settle()

  const warned = events(posts, 'Veo un bucle')
  expect(warned).toHaveLength(1)
  expect(warned[0]!.body.text).toBe('app.ts lleva 6 ediciones en este turno. Esto se está repitiendo: ¿lo replanteamos?')
})

test('a permission left waiting two minutes is insisted on once, even while you look', async ($, on) => {
  model(on, 'SKIP')
  on('classic.PermissionRequest', () => ({}))
  const { posts, clock } = await tipEngine($, on)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm i' }, permission_mode: 'default' })

  await clock.advance(MINUTE + 50_000)
  await clock.settle()
  expect(events(posts, 'Sigo esperándote')).toHaveLength(0)

  await clock.advance(12_000)
  await clock.settle()
  await clock.advance(10 * MINUTE)
  await clock.settle()
  const nudged = events(posts, 'Sigo esperándote')
  expect(nudged).toHaveLength(1)
  expect(nudged[0]!.body.kind).toBe('question')
  expect(nudged[0]!.body.force).toBe(true)
  expect(nudged[0]!.body.text).toBe('Sigo esperándote desde hace 2 min: pido permiso para usar Bash.')
})

test('a permission or question answered in time is not insisted on', async ($, on) => {
  model(on, 'SKIP')
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  const { posts, clock } = await tipEngine($, on)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm i' }, permission_mode: 'default' })
  await clock.advance(MINUTE)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'x' } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.advance(5 * MINUTE)
  await clock.settle()

  expect(events(posts, 'Sigo esperándote')).toHaveLength(0)
})

// Half an hour of beats: slow on a busy machine, hence the longer time.
test('/narsil resumen sums the session up, and so does a 30-minute pause after a turn', { timeoutMs: 15_000 }, async ($, on) => {
  model(on, 'SKIP')
  const { posts, clock } = await tipEngine($, on)
  await finishTurn($, 'C:/repo/a.ts')
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await finishTurn($, 'C:/repo/b.ts')

  const asked = await $.command.run({ command: 'narsil', args: 'resumen', ...TYPED })
  expect(asked.text).toBe('Narsil: 📋 Sesión de 0 min: 2 turnos (1 min 24 s de trabajo) · 2 archivos editados (a.ts, b.ts) · 1 comando, 0 fallos.')

  await clock.advance(29 * MINUTE)
  await clock.settle()
  expect(String(windowTip(posts) ?? '')).not.toContain('📋')
  await clock.advance(MINUTE + 2000)
  await clock.settle()
  expect(windowTip(posts)).toBe('📋 Sesión de 30 min: 2 turnos (1 min 24 s de trabajo) · 2 archivos editados (a.ts, b.ts) · 1 comando, 0 fallos.')
})

test('a conversation taken up again keeps counting its session, kept across restarts', async ($, on) => {
  model(on, 'SKIP')
  on('session.id', () => ({ value: 'conv-1' }))
  // what the conversation had done before Claude Code was closed
  const earlier = { ...emptyStats(1_000_000 - 10 * MINUTE), turns: 3, workedMs: 120_000, files: ['x.ts'], commands: 2 }
  const store: Record<string, unknown> = { 'stats:conv-1': earlier }
  await tipEngine($, on, { store })

  await finishTurn($)

  const asked = await $.command.run({ command: 'narsil', args: 'resumen', ...TYPED })
  expect(asked.text).toBe('Narsil: 📋 Sesión de 10 min: 4 turnos (2 min 42 s de trabajo) · 2 archivos editados (x.ts, register.tsx) · 2 comandos, 0 fallos.')
  expect((store['stats:conv-1'] as { turns: number }).turns).toBe(4)
})

test('only the last 20 conversations keep their counts, and an odd stored value is ignored', async ($, on) => {
  model(on, 'SKIP')
  on('session.id', () => ({ value: 'conv-new' }))
  const store: Record<string, unknown> = { xp: 10, 'stats:conv-new': 'not a count' }
  for (let i = 0; i < 25; i++) store[`stats:old-${i}`] = { ...emptyStats(0), turns: 1 }
  await tipEngine($, on, { store })

  await finishTurn($)

  const kept = Object.keys(store).filter(key => key.startsWith('stats:'))
  expect(kept.length).toBe(20)
  expect(kept).toContain('stats:conv-new')
  expect(kept).toContain('stats:old-24')
  expect(kept).not.toContain('stats:old-0')
  expect(store.xp).toBe(20)
  expect((store['stats:conv-new'] as { turns: number }).turns).toBe(1)
})

test('the summary names three files at most, and counts subagents and context', () => {
  const stats = { ...emptyStats(0), turns: 1, workedMs: 30_000, files: ['a', 'b', 'c', 'd'], commands: 2, failures: 1, agents: 1 }
  expect(summaryText(stats, 65 * MINUTE, 40.4)).toBe(
    '📋 Sesión de 1 h 5 min: 1 turno (30 s de trabajo) · 4 archivos editados (a, b, c…) · 2 comandos, 1 fallo · 1 subagente · contexto 40 %.',
  )
  expect(summaryText(emptyStats(0), 0, null)).toBe('📋 Sesión de 0 min: 0 turnos · ningún archivo editado · 0 comandos, 0 fallos.')
})

// --- Experience ---

test('Narsil keeps her experience across sessions, and celebrates a new level', async ($, on) => {
  model(on, 'SKIP')
  const store: Record<string, unknown> = { xp: 95 }
  const { posts } = await tipEngine($, on, { store })
  expect(await bandTexts($, 'terminal')).toContain('⭐ Nivel 1 · 95/100 XP')
  expect(await bandTexts($, 'desktop')).toContain('· ⭐ Nivel 1 · 95/100 XP')

  await finishTurn($)

  expect(store.xp).toBe(105)
  expect(await bandTexts($, 'desktop')).toContain('· ⭐ Nivel 2 · 5/200 XP')
  expect(await bandTexts($, 'desktop')).toContain('¡He subido al nivel 2! ⭐')
  expect(posts.filter(p => p.url.endsWith('/state')).pop()?.body.xp).toBe('⭐ Nivel 2 · 5/200 XP')
  const asked = await $.command.run({ command: 'narsil', args: 'nivel', ...TYPED })
  expect(asked.text).toMatch(/^Narsil: ⭐ Nivel 2 · 5\/200 XP · etapa 1 de 5\. /)
})

test('passing tests and finished subagents earn experience; failures and stopped turns do not', async ($, on) => {
  model(on, 'SKIP')
  let shouldFail = false
  on('tool.call', () => (shouldFail ? { isError: true, result: 'boom', text: 'boom' } : { result: {} }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))
  const store: Record<string, unknown> = {}
  await tipEngine($, on, { store, hasTools: false })

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(store.xp).toBe(5)
  shouldFail = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await $.turn.start({ text: 'para', turnId: 'stop' })
  await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 1000, isAborted: true, turnId: 'stop' })
  expect(store.xp).toBe(5)

  await spawn($, 'Explorar', 'Explore')
  await agentDone($, 'a1')
  expect(store.xp).toBe(8)
})

test('another conversation’s experience is added to, never overwritten', async ($, on) => {
  model(on, 'SKIP')
  const store: Record<string, unknown> = { xp: 10 }
  await tipEngine($, on, { store })
  store.xp = 50
  await finishTurn($)
  expect(store.xp).toBe(60)
})

test('Narsil grows at levels 5, 10, 20 and 35, and says so', async ($, on) => {
  expect([1, 4, 5, 9, 10, 19, 20, 34, 35, 80].map(stageOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  model(on, 'SKIP')
  // 1000 XP is level 5.
  const store: Record<string, unknown> = { xp: 995 }
  await tipEngine($, on, { store })
  await finishTurn($)
  expect(await bandTexts($, 'desktop')).toContain('¡He crecido! Nivel 5, etapa 2 de 5 🌊')
  const asked = await $.command.run({ command: 'narsil', args: 'nivel', ...TYPED })
  expect(asked.text).toContain('· etapa 2 de 5.')
  expect(asked.text).toContain('crezco en los niveles 5, 10, 20, 35.')
})

async function bandArt($: Engine): Promise<string> {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const art = (await ui.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Narsil:'))
  await ui.unmount()
  return String(art?.props.source ?? '')
}

test('a new level plays its own celebration for a while, in the band and the window', async ($, on) => {
  model(on, 'SKIP')
  const store: Record<string, unknown> = { xp: 95 }
  const { posts, clock } = await tipEngine($, on, { store })
  expect(await bandArt($)).not.toContain('class="burst"')

  await finishTurn($)

  const art = await bandArt($)
  expect(art).toContain('class="burst"')
  expect(art).toContain('>NIVEL 2<')
  expect(art).not.toContain('class="rays"')
  expect(String(posts.filter(p => p.url.endsWith('/state')).pop()?.body.svg)).toContain('>NIVEL 2<')
  await clock.advance(8000)
  await clock.settle()
  expect(await bandArt($)).not.toContain('class="burst"')
})

test('a new stage plays its growth: a flash, light rays and the new stage', async ($, on) => {
  model(on, 'SKIP')
  // 1000 XP is level 5, stage 2.
  const store: Record<string, unknown> = { xp: 995 }
  const { clock } = await tipEngine($, on, { store })

  await finishTurn($)

  const art = await bandArt($)
  expect(art).toContain('class="rays"')
  expect(art).toContain('class="evolve"')
  expect(art).toContain('>¡ETAPA 2!<')
  await clock.advance(11_000)
  await clock.settle()
  expect(await bandArt($)).not.toContain('class="rays"')
})

test('the celebrations stay within the Svg size limit at every stage', () => {
  for (let stage = 1; stage <= 5; stage++) {
    for (const mood of ['celebrating', 'idle', 'writing'] as const) {
      const leveled = sprite(mood, stage, { kind: 'level', level: 12, stage })
      const grown = sprite(mood, stage, { kind: 'grew', level: 20, stage })
      expect(leveled).toContain('>NIVEL 12<')
      expect(grown).toContain(`>¡ETAPA ${stage}!<`)
      for (const svg of [leveled, grown]) {
        expect(svg.length).toBeLessThan(131072)
        expect(svg.match(/href="data:image\/png;base64,/g)?.length).toBe(2)
      }
    }
  }
})

test('a stage draws its own art, its base pose where one is missing, and the stage before where a theme is', () => {
  // A stage far past the drawn ones, so the real art is left as it is.
  const drawn = { src: 'data:image/png;base64,ETAPA9', width: 100, height: 150 }
  const lastDark = Math.max(...Object.keys(ART).map(Number).filter(s => ART[s].oscuro?.trabajando))
  ART[9] = { claro: { base: drawn } }
  try {
    const grown = sprite('writing', 9)
    // light: stage 9 has no working pose, so its base; dark: the last stage drawn in dark
    expect(grown).toContain('href="data:image/png;base64,ETAPA9"')
    expect(grown).toContain(String(ART[lastDark].oscuro?.trabajando.src))
    // stage 10 has none of its own, so it shows stage 9
    expect(sprite('writing', 10)).toContain('ETAPA9')
    // the hatchling shows her own art in both themes
    const hatchling = sprite('writing', 1)
    expect(hatchling).toContain(String(ART[1].claro?.trabajando.src))
    expect(hatchling).toContain(String(ART[1].oscuro?.trabajando.src))
  } finally {
    delete ART[9]
  }
})

test('levels need 100, 200, 300 XP more each, and odd stored values count as none', () => {
  expect(levelOf(0)).toEqual({ level: 1, into: 0, needed: 100 })
  expect(levelOf(99).level).toBe(1)
  expect(levelOf(100)).toEqual({ level: 2, into: 0, needed: 200 })
  expect(levelOf(300)).toEqual({ level: 3, into: 0, needed: 300 })
  expect(xpLabel(420)).toBe('⭐ Nivel 3 · 120/300 XP')
  expect(xpOf('12')).toBe(0)
  expect(xpOf(-5)).toBe(0)
  expect(xpOf(Number.NaN)).toBe(0)
  expect(xpOf(12.7)).toBe(12)
})
