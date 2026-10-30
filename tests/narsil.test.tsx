import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

// Stands in for the engine and the floating window: records what the mod
// posts, and answers /summary with `summary`.
function engine(on: On, summary: Record<string, number> | null = null): Posted[] {
  const posts: Posted[] = []
  on('store.get', (_, e) => ({ value: e.key === 'overlayToken' ? 'secret-token' : undefined }))
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_abc-123' : undefined }))
  on('session.cwd', () => ({ value: 'C:/Proyectos/landing' }))
  on('command.register', () => ({ value: { command: 'narsil' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('http.fetch', (_, e) => {
    if (e.init?.method === 'POST' && e.init.body) {
      posts.push({ url: e.url, token: e.init.headers?.['x-narsil-token'], body: JSON.parse(e.init.body) })
    }
    const isSummary = e.url.endsWith('/summary')
    return { value: { status: 200, ok: !isSummary || summary !== null, headers: {}, text: isSummary ? JSON.stringify(summary) : '' } }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  // the test engine has no clock: answer its calls here
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.after', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
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

test('a permission Claude must ask for pops up as a question', async ($, on) => {
  const posts = engine(on)
  on('tool.check', () => ({ decision: 'ask' as const }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })

  const asked = posts.find(p => p.url.endsWith('/event'))
  expect(asked?.body.kind).toBe('question')
  expect(asked?.body.text).toBe('Pide permiso para usar Bash.')
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
