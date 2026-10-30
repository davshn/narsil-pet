import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteResult, On } from 'claude-code'

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
  on('store.set', () => ({ value: undefined }))
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
  expect(await ui.find({ type: 'Text', text: 'Narsil está leyendo: app.ts' })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Narsil está ejecutando: npm test' })).toBeDefined()
  await ui.unmount()

  shouldFail = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /TRABAJANDO/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /Ha fallado un paso \(Bash\); Narsil sigue trabajando/ })).toBeDefined()
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
  expect(last?.body.headline).toBe('Narsil está editando: a.ts')
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
  expect(await ui.find({ type: 'Text', text: 'Narsil te necesita: tiene una pregunta para ti' })).toBeDefined()
  await ui.unmount()
})

test('a permission dialog you must answer pops up as a question', async ($, on) => {
  const posts = engine(on)
  on('classic.PermissionRequest', () => ({}))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, permission_mode: 'default' })

  const asked = posts.find(p => p.url.endsWith('/event'))
  expect(asked?.body.kind).toBe('question')
  expect(asked?.body.text).toBe('Pide permiso para usar Bash.')
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

  expect(JSON.stringify(answer)).toContain('4 conversaciones abiertas: 2 trabajando · 1 terminado · 1 parada')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '4 conversaciones abiertas: 2 trabajando · 1 terminado · 1 parada' })).toBeDefined()
  await ui.unmount()
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
    const svg = sprite(mood)
    expect(svg.match(/href="data:image\/png;base64,/g)?.length).toBe(2)
    expect(svg.length).toBeLessThan(131072)
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
  expect(event?.body.title).toBe('Narsil te necesita')
  for (const post of posts.filter(p => p.url.endsWith('/state'))) {
    expect(String(post.body.headline)).not.toContain('Claude')
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Narsil está buscando: "TODO"' })).toBeDefined()
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
// `everyMinutes` shortens the throttle, so a test of several tips moves the
// clock (and the 2-second heartbeat with it) only a little.
async function tipEngine(
  $: Engine,
  on: On,
  { store = {}, hasTools = true, everyMinutes }: { store?: Record<string, unknown>; hasTools?: boolean; everyMinutes?: number } = {},
) {
  const posts = engine(on, null, { hasClock: false, store })
  const clock = mock.clock(on, { now: 1_000_000 })
  if (hasTools) on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
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
  const head = texts.find(t => t.text.startsWith('Narsil ha terminado'))
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

test('Narsil moves visibly in every state', () => {
  const moods = ['greeting', 'idle', 'thinking', 'talking', 'reading', 'searching', 'writing', 'running', 'asking', 'scared', 'celebrating', 'failed'] as const
  for (const mood of moods) {
    const svg = sprite(mood)
    // the water she swims in, and bubbles rising through it
    expect(svg).toContain('class="ripple"')
    expect(svg.match(/class="bub"/g)?.length).toBe(7)
  }
  // a whole-body motion of its own for each state, far larger than a bob
  expect(sprite('writing')).toContain('@keyframes swim{')
  expect(sprite('writing')).toMatch(/translate\(0,-7px\) rotate\(3deg\)/)
  expect(sprite('celebrating')).toMatch(/translateY\(-26px\) rotate\(-10deg\)/)
  expect(sprite('celebrating').match(/class="confetti"/g)?.length).toBe(12)
  expect(sprite('asking')).toContain('class="aura"')
  expect(sprite('idle')).not.toContain('class="aura"')
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

const NO_WINDOW = { prefs: { isHidden: false, isMuted: false, isFloating: false } }
const scriptOf = (r: Ran) => r.env.NARSIL_SCRIPT ?? ''

test('on macOS Narsil speaks and notifies with its own scripts, detached, never PowerShell', async ($, on) => {
  const runs: Ran[] = []
  engine(on, null, { os: 'mac', runs, store: NO_WINDOW })
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

test('on macOS the floating window starts through start.sh with the overlay token', async ($, on) => {
  const runs: Ran[] = []
  engine(on, null, { os: 'mac', runs, store: NO_WINDOW })
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
  expect(asked?.body.title).toBe('Narsil te necesita')
  expect(runs.some(r => scriptOf(r).endsWith('toast.ps1'))).toBe(false)
})

test('on Windows Narsil still speaks and starts the window through PowerShell', async ($, on) => {
  const runs: Ran[] = []
  engine(on, null, { os: 'windows', runs, store: NO_WINDOW })
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
  engine(on, null, { os: 'linux', runs, store: NO_WINDOW })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.command.run({ command: 'narsil', args: 'prueba', ...TYPED })
  await $.command.run({ command: 'narsil', args: 'flotante', ...TYPED })

  expect(runs.filter(r => r.argv[0] !== 'uname')).toEqual([])
})
