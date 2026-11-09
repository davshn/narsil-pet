import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteResult, On } from 'claude-code'

import { STEPS_SYSTEM, SYSTEM, ends, parse, parseSteps } from '../hooks/advice'
import { agentChip, modelLabel } from '../hooks/agents'
import { emptyStats, isClaudesCall, summaryText } from '../hooks/watch'
import { levelOf, stageOf, xpLabel, xpOf } from '../hooks/xp'
import { VOICE, say } from '../hooks/words'
import { ART } from '../hooks/art'
import { sprite } from '../hooks/sprite'
import { phoneStatus, sealedPayload } from '../hooks/phone'
import { SEAL_PREFIX, fromBase64Url, hmac, newKey, seal, sealedLength, toBase64Url, unseal as openSealed } from '../hooks/seal'

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
    isOverlayStale = false,
    stateReply = () => '',
    pushReply = () => '',
    account = '',
    git = () => '',
    files = {},
    fleet = [],
  }: {
    hasClock?: boolean
    store?: Record<string, unknown>
    os?: 'windows' | 'mac' | 'linux'
    runs?: Ran[]
    isOverlayDown?: boolean
    // an older server holds the port: it answers the ping the old way
    isOverlayStale?: boolean
    // what the window's server answers a pushed state
    stateReply?: (body: Record<string, unknown>) => string
    // what the phone app left on its push topic, as ntfy.sh's poll returns it
    pushReply?: () => Promise<string> | string
    // what ntfy.sh's /v1/account answers
    account?: string
    // what each git command prints (argv without the leading "git")
    git?: (args: readonly string[]) => string
    // the project's files the mod may read, by path
    files?: Record<string, string>
    // the other conversations the hub serves at /sessions
    fleet?: Record<string, unknown>[]
  } = {},
): Posted[] {
  const posts: Posted[] = []
  let isUp = !isOverlayDown
  let isStale = isOverlayStale
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
  on('http.fetch', async (_, e) => {
    if (e.url.endsWith('/v1/account')) return { value: { status: account ? 200 : 503, ok: Boolean(account), headers: {}, text: account } }
    if (e.url.includes('-push/json')) {
      const message = await pushReply()
      return { value: { status: 200, ok: true, headers: {}, text: message ? `${JSON.stringify({ event: 'message', message })}
` : '' } }
    }
    if (isStale && e.url.endsWith('/ping')) return { value: { status: 200, ok: true, headers: {}, text: 'narsil' } }
    if (isStale && e.url.endsWith('/quit')) {
      isStale = false
      isUp = false
      return { value: { status: 204, ok: true, headers: {}, text: '' } }
    }
    if (!isUp) return { value: { status: 503, ok: false, headers: {}, text: '' } }
    if (e.init?.method === 'POST' && e.init.body) {
      posts.push({ url: e.url, token: e.init.headers?.['x-narsil-token'], body: JSON.parse(e.init.body) })
    }
    if (e.url.endsWith('/sessions')) {
      const isTrusted = e.init?.headers?.['x-narsil-token'] === 'secret-token'
      return { value: { status: isTrusted ? 200 : 403, ok: isTrusted, headers: {}, text: JSON.stringify(fleet) } }
    }
    const isSummary = e.url.endsWith('/summary')
    if (e.url.endsWith('/state') && e.init?.body) return { value: { status: 200, ok: true, headers: {}, text: stateReply(JSON.parse(e.init.body)) } }
    const text = isSummary ? JSON.stringify(summary) : e.url.endsWith('/ping') && (isOverlayDown || isOverlayStale) ? 'narsil 3' : ''
    return { value: { status: 200, ok: !isSummary || summary !== null, headers: {}, text } }
  })
  on('process.run', (_, e) => {
    runs.push({ argv: e.argv, env: e.init?.env ?? {} })
    // the window's server, started through PowerShell or start.sh
    if (e.init?.env?.NARSIL_SERVER || String(e.argv[1]).endsWith('/overlay/start.sh')) isUp = true
    const stdout = e.argv[0] === 'uname' ? `${uname}\n` : e.argv[0] === 'git' ? git(e.argv.slice(1).filter(a => a !== '--no-pager')) : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // The engine hands the hooks absolute paths: `files` is keyed relative to
  // the project, so a path matches the key it ends with.
  const fileAt = (path: string) => Object.keys(files).find(f => path.replace(/\\/g, '/').endsWith(`/${f}`))
  on('fs.read', (_, e) => {
    const key = fileAt(e.path)
    if (key === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: files[key]! }
  })
  on('fs.list', (_, e) => {
    const dir = e.path.replace(/\\/g, '/')
    const names = Object.keys(files)
      .filter(f => fileAt(`${dir}/${f.split('/').pop()}`) === f)
      .map(f => f.split('/').pop()!)
    if (names.length === 0) throw new Error(`ENOENT: ${e.path}`)
    return { value: names.map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }
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
  // the drawing goes with the change of state, not with each heartbeat after
  const drawn = posts.filter(p => p.url.endsWith('/state') && p.body.svg).at(-1)
  expect(drawn?.body.status).toBe('working')
  expect(String(drawn?.body.svg).startsWith('<svg')).toBe(true)
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

test('the open conversations are counted by state for /narsil estado, and the band lists them instead', async ($, on) => {
  const fleet = [other('local_a', 'working', 'running', 'a'), other('local_b', 'working', 'running', 'b'), other('local_c', 'done', 'celebrating', 'c')]
  engine(on, null, { hasClock: false, fleet })
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  const answer = await $.command.run({ command: 'narsil', args: 'estado', ...TYPED })

  expect(JSON.stringify(answer)).toContain('4 conversaciones abiertas: 2 trabajando · 1 terminada · 1 parada')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /conversaciones abiertas/ })).toBeUndefined()
  await ui.unmount()
})

// The labels of a drawing's buttons (find matches a Button by its type alone).
// Each button's label without the spaces that pad it to its column.
const labels = async (ui: Awaited<ReturnType<Engine['ui']['mount']>>) => (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label).trimEnd())

// Another conversation as the hub serves it.
const other = (sessionId: string, status: string, mood: string, title: string, extra: Record<string, unknown> = {}) => ({
  sessionId,
  title,
  mood,
  status,
  headline: `${title} va`,
  model: 'Opus',
  changedAt: 5,
  context: { percent: 30, note: '60k / 200k' },
  contextDetail: null,
  cache: null,
  agents: [],
  tasks: [],
  ...extra,
})

test('the band lists every open conversation with its state and context, and Narsil wears the most important', async ($, on) => {
  const fleet = [
    other('local_work', 'working', 'running', 'api'),
    other('local_fail', 'error', 'failed', 'web', { context: { percent: 90, note: '180k / 200k' } }),
  ]
  engine(on, null, { hasClock: false, fleet })
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // the error comes first, and Narsil shows it, with its conversation
    expect(await ui.find({ type: 'Text', text: /ERROR/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /web: web va/ })).toBeDefined()
    // one row per conversation, this one marked; each with its own context
    for (const title of ['▸ web', '▸ api', '▾ landing']) expect(await labels(ui)).toContain(title)
    // this conversation leads the list whatever its state, the others ranked
    expect((await labels(ui)).filter(l => /^[▸▾] /.test(l))).toEqual(['▾ landing', '▸ web', '▸ api'])
    expect(await ui.find({ type: 'Text', text: '90 %' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '30 %' })).toBeDefined()
    // states and titles take the same characters, so the bars line up
    // (the desktop heading also leads with the state; the rows are the last three)
    const states = (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).filter(t => t.startsWith('● ')).slice(-3)
    expect(states.map(t => t.trimEnd())).toEqual(['● PARADA', '● ERROR', '● TRABAJANDO'])
    expect(new Set(states.map(t => t.length)).size).toBe(1)
    const titles = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label)).filter(l => /^[▸▾] /.test(l))
    expect(new Set(titles.map(t => t.length)).size).toBe(1)
    await ui.unmount()
  }
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const art = (await desk.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Narsil:'))
  expect(art?.props.alt).toBe('Narsil: ERROR, web: web va')
  await desk.unmount()
})

test('a conversation opened from the band shows its context, what fills it, its tasks and its subagents', async ($, on) => {
  const detail = { parts: [{ name: 'Messages', tokens: 50_000, color: '#7C6CF0' }], total: 50_000, window: 200_000, at: 1 }
  const fleet = [
    other('local_work', 'working', 'running', 'api', {
      contextDetail: detail,
      agents: [{ text: '🐍 Explore · busca el bug', color: '#3B8BFF' }],
      tasks: [
        { id: '1', text: 'Leer el código', status: 'completed' },
        { id: '2', text: 'Arreglar el bug', status: 'in_progress' },
      ],
    }),
  ]
  engine(on, null, { hasClock: false, fleet })
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Arreglar el bug/ })).toBeUndefined()
  await ui.press({ key: 'conv-local_work' })
  await ui.unmount()

  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await labels(ui)).toContain('▾ api')
  // a line parts the list from what the open conversation shows
  expect(await ui.find({ type: 'Text', text: /^─+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ● Leer el código' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ◐ Arreglar el bug' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '🐍 Explore · busca el bug' })).toBeDefined()
  // its context is not told a second time: only its tasks and subagents open
  expect(await labels(ui)).not.toContain('Contexto')
  expect(await ui.find({ type: 'Text', text: '60k / 200k' })).toBeUndefined()
  // its percent opens what fills its context
  await ui.press({ key: 'usage-context' })
  await ui.unmount()

  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Messages/ })).toBeDefined()
  // its title again closes it
  await ui.press({ key: 'conv-local_work' })
  await ui.unmount()
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Arreglar el bug/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^─+$/ })).toBeUndefined()
  await ui.unmount()
})

test('the band and the phone name this conversation by its title, the folder only until it has one', async ($, on) => {
  const posts = phoneEngine(on)
  on('classic.UserPromptSubmit', () => ({}))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'narsil', args: 'movil', ...BY_PHONE })
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await labels(ui)).toContain('▾ landing')
  await ui.unmount()

  await $.classic.UserPromptSubmit({ prompt: 'ordena la lista', session_title: 'Ordenar sesiones' } as never)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await labels(ui)).toContain('▾ Ordenar sesiones')
  await ui.unmount()
  await fromPhone($)
  await finishTurn($)
  expect(toPhone(posts).at(-1)?.title).toBe('Narsil · He terminado · Ordenar sesiones')
})

test('the band pages through many conversations, four at a time', async ($, on) => {
  const fleet = ['a', 'b', 'c', 'd', 'e'].map((t, i) => ({ ...other(`local_${t}`, 'done', 'celebrating', t), changedAt: 100 - i }))
  engine(on, null, { hasClock: false, fleet })
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Conversaciones 1/2' })).toBeDefined()
  expect(await labels(ui)).not.toContain('▸ e')
  await ui.press({ key: 'page-next' })
  await ui.unmount()
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Conversaciones 2/2' })).toBeDefined()
  expect(await labels(ui)).toContain('▸ e')
  await ui.unmount()
})

test('the task tools leave this conversation its list, for the band and the hub', async ($, on) => {
  const posts = engine(on)
  on('tool.call', (_, e) => ({ result: e.tool === 'TaskCreate' ? { task: { id: '7', subject: 'Escribir el test' } } : {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Leer', status: 'completed', activeForm: 'Leyendo' }] } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Escribir el test', description: '' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '  ● Leer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ◐ Escribir el test' })).toBeDefined()
  await ui.unmount()
  const last = posts.filter(p => p.url.endsWith('/state')).at(-1)
  expect(last?.body.tasks).toEqual([
    { id: '1', text: 'Leer', status: 'completed' },
    { id: '7', text: 'Escribir el test', status: 'in_progress' },
  ])

  // the desktop app's own plan replaces the list, and moves it along
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'Uno', status: 'in_progress' }, { content: 'Dos', status: 'pending' }] } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)
  expect(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.tasks).toEqual([
    { id: '1', text: 'Uno', status: 'completed' },
    { id: '2', text: 'Dos', status: 'in_progress' },
  ])

  // the app's next-step box closes the turn and checks the plan off, with no
  // last update_plan
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Listo.' } as never)
  expect(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.tasks).toEqual([
    { id: '1', text: 'A', status: 'completed' },
    { id: '2', text: 'B', status: 'completed' },
  ])
  const closed = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await closed.find({ type: 'Text', text: '  ● B' })).toBeDefined()
  await closed.unmount()
})

test('the counts agree in number with how many conversations each holds', async ($, on) => {
  const states = ['working', 'idle', 'waiting', 'waiting', 'done', 'done', 'error', 'error']
  engine(on, null, { hasClock: false, fleet: states.map((status, i) => other(`local_${i}`, status, 'idle', `c${i}`)) })
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

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

type Asked = { model: string; prompt: string; system?: string; effort?: string }

// Stands in for the model: records each completion asked for and answers
// with `reply`, a text or a whole result.
function model(on: On, reply: string | ModelCompleteResult = TIP): Asked[] {
  const asked: Asked[] = []
  on('model.complete', (_, e) => {
    asked.push({ model: e.model, prompt: e.prompt, system: e.system, effort: e.effort })
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
    stateReply,
    git,
    files,
  }: {
    store?: Record<string, unknown>
    hasTools?: boolean
    everyMinutes?: number
    hasSteps?: boolean
    hasPlan?: boolean
    os?: 'windows' | 'mac' | 'linux'
    runs?: Ran[]
    stateReply?: (body: Record<string, unknown>) => string
    git?: (args: readonly string[]) => string
    files?: Record<string, string>
  } = {},
) {
  const posts = engine(on, null, { hasClock: false, store, os, runs, stateReply, git, files })
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
async function finishTurn($: Engine, file = 'C:/repo/hooks/register.tsx', answer = 'Listo: he cambiado el registro.') {
  const turnId = `t${++turns}`
  await $.turn.start({ text: 'arregla el registro', turnId })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' } as never)
  await $.turn.complete({ reason: 'answer', answer, durationMs: 42_000, isAborted: false, turnId })
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
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 20_000, window: 200_000, percent: 10 }, rateLimits: [{ kind: 'five_hour', percentUsed: 18 }] } }) as never)
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

test('/narsil discreto keeps her quiet, and /narsil normal brings everything back', async ($, on) => {
  const asked = model(on)
  const runs: Ran[] = []
  const { clock } = await tipEngine($, on, { os: 'mac', runs, store: noWindow(), hasSteps: true })
  const spoken = () => runs.filter(r => scriptOf(r).endsWith('/overlay/speak.sh')).map(r => r.env.NARSIL_TEXT)
  const toasts = () => runs.filter(r => scriptOf(r).endsWith('/overlay/toast.sh')).map(r => r.env.NARSIL_TITLE)

  const quiet = await $.command.run({ command: 'narsil', args: 'discreto', ...TYPED })
  expect(quiet.text).toContain('modo discreto')
  await finishTurn($)
  await clock.settle()
  await clock.advance(11 * MINUTE)
  await clock.settle()
  // no voice, no "done" alert, no automatic tip, no next steps
  expect(spoken()).toEqual([])
  expect(toasts()).toEqual([])
  expect(asked.length).toBe(0)
  // what needs you still reaches you, silently
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(toasts()).toEqual(['Narsil · Te necesito'])
  expect(spoken()).toEqual([])
  const status = await $.command.run({ command: 'narsil', args: '', ...TYPED })
  expect(JSON.stringify(status)).toContain('Modo discreto activado')

  await $.command.run({ command: 'narsil', args: 'normal', ...TYPED })
  await finishTurn($)
  await clock.settle()
  expect(spoken().some(t => VOICE.done.includes(String(t)))).toBe(true)
  expect(toasts()).toContain('Narsil · He terminado')
  expect(asked.length).toBeGreaterThan(0)
})

test('prefs stored before tips existed get the tip defaults', async ($, on) => {
  await tipEngine($, on, { store: { prefs: { isHidden: false, isMuted: true, isFloating: false } } })

  const answer = await $.command.run({ command: 'narsil', args: '', ...TYPED })

  expect(JSON.stringify(answer)).toContain('la voz apagada')
  expect(JSON.stringify(answer)).toContain('Consejos activados (como mucho uno cada 30 min)')
})

test('a stored 10, the old default, becomes the new 30 once; a 10 chosen after that stays', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { isAdviceOn: true, adviceEveryMinutes: 10 } }
  await tipEngine($, on, { store })

  const first = await $.command.run({ command: 'narsil', args: '', ...TYPED })
  expect(JSON.stringify(first)).toContain('como mucho uno cada 30 min')
  expect((store.prefs as { adviceEveryMinutes: number }).adviceEveryMinutes).toBe(30)

  await $.command.run({ command: 'narsil', args: 'consejos cada 10', ...TYPED })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const again = await $.command.run({ command: 'narsil', args: '', ...TYPED })
  expect(JSON.stringify(again)).toContain('como mucho uno cada 10 min')
})

test('another stored frequency is kept as it was', async ($, on) => {
  await tipEngine($, on, { store: { prefs: { isAdviceOn: true, adviceEveryMinutes: 5 } } })
  const answer = await $.command.run({ command: 'narsil', args: '', ...TYPED })
  expect(JSON.stringify(answer)).toContain('como mucho uno cada 5 min')
})

test('with the default, a second tip waits 30 minutes', async ($, on) => {
  const asked = model(on)
  let shouldFail = false
  on('tool.call', () => (shouldFail ? { isError: true, result: 'boom', text: 'Error: boom' } : { result: {} }))
  const { clock } = await tipEngine($, on, { hasTools: false })
  await finishTurn($)
  await clock.settle()
  expect(asked.length).toBe(1)

  // a tip of another kind, 20 minutes later: still too soon
  await clock.advance(20 * MINUTE)
  shouldFail = true
  await $.turn.start({ text: 'sigue', turnId: 'late' })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await clock.settle()
  expect(asked.length).toBe(1)

  await clock.advance(11 * MINUTE)
  await $.turn.start({ text: 'otra vez', turnId: 'later' })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await clock.settle()
  expect(asked.length).toBe(2)
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

test('the band shows the 5-hour window and the week once, and the context in its conversation', async ($, on) => {
  const posts = engine(on)
  measured(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.session.measure({ ...MEASURED, changed: [...MEASURED.changed] })

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const bars = (await desk.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Uso:'))
  // no general context bar: there is no general context
  expect(bars?.props.alt).toBe('Uso: 5 horas 18 % (reinicia en 2 h 05 min), semana 91 % (reinicia en 3 d 4 h)')
  // this conversation is open: its percent is the button
  expect(await labels(desk)).toContain('42 %')
  expect(bars?.props.isInteractive).toBeUndefined()
  // Green while there is room, red past 85 %.
  expect(String(bars?.props.source)).toContain('#22B573')
  expect(String(bars?.props.source)).toContain('#F0435A')
  await desk.unmount()

  let term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: '████░░░░░░' })).toBeDefined()
  expect(await labels(term)).toContain('42 %')
  expect(await term.find({ type: 'Text', text: ' 91 %' })).toBeDefined()
  // the tokens come with what fills the context
  expect(await term.find({ type: 'Text', text: '84k / 200k' })).toBeUndefined()
  await term.press({ key: 'usage-context' })
  await term.unmount()
  term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: '84k / 200k' })).toBeDefined()
  await term.unmount()

  const state = posts.filter(p => p.url.endsWith('/state')).at(-1)
  expect((state?.body.usage as unknown[]).length).toBe(3)
})

// /context's rows, as `$.session.usage({ breakdown })` answers them.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 4_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 70_000, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 10_000, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'Deferred tools', tokens: 9_000, color: 'inactive', isDeferred: true, kind: 'deferred' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
    { name: 'Free space', tokens: 83_000, color: 'inactive', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 84_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  percentage: 42,
}

test('a press on the open conversation percent shows what fills the context, and another goes back to the bars', async ($, on) => {
  engine(on)
  measured(on)
  const asked: unknown[] = []
  on('session.usage', (_, e) => {
    asked.push(e?.breakdown)
    return { value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42, ...(e?.breakdown ? { breakdown: BREAKDOWN } : {}) }, rateLimits: [] } } as never
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ ...MEASURED, changed: [...MEASURED.changed] })

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // the context is told once, in its row; the open one's percent is the button
  expect(await labels(desk)).not.toContain('Contexto')
  expect(await labels(desk)).toContain('42 %')
  await desk.press({ key: 'usage-context' })
  await desk.unmount()
  // estimated locally: no token-count requests
  expect(asked).toContain('summary')
  expect(asked).not.toContain('full')

  const open = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const bars = await open.findAll({ type: 'Svg' })
  const detail = bars.find(svg => String(svg.props.alt).startsWith('Contexto:'))
  // biggest first, the reserve and the free space last, on-demand tools left out
  expect(detail?.props.alt).toBe('Contexto: 84k / 200k. Messages 70k, MCP tools 10k, System prompt 4k, Reserva de compactación 33k, Libre 83k')
  expect(String(detail?.props.source)).toContain('35 %')
  await open.unmount()

  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /^Messages/ })).toBeDefined()
  await term.press({ key: 'usage-context' })
  await term.unmount()

  const back = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await back.find({ type: 'Text', text: /^Messages/ })).toBeUndefined()
  expect(await labels(back)).toContain('42 %')
  await back.unmount()
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

test('off a plan, no limits show, and the context is read when the session starts', async ($, on) => {
  engine(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 150_000, window: 200_000, percent: 75 }, rateLimits: [] } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await desk.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('Uso:'))).toBeUndefined()
  // this conversation is open: its percent is the button that opens what fills it
  expect(await labels(desk)).toContain('75 %')
  // this conversation's row bar wears the mod's blue; the percent keeps its level color
  const bars = (await desk.findAll({ type: 'Text' })).filter(t => /[█░▓▒]/.test(String(t.text)))
  expect(bars.map(t => t.props.color)).toContain('#3B8BFF')
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
  let desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await desk.press({ key: 'usage-context' })
  await desk.unmount()
  desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // 2 % a minute: the remaining 40 % in 20 min, told with what fills it
  expect(await desk.find({ type: 'Text', text: '120k / 200k · lleno en ~20 min' })).toBeDefined()
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

  let desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await desk.press({ key: 'usage-context' })
  await desk.unmount()
  desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desk.find({ type: 'Text', text: '40k / 200k' })).toBeDefined()
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
  const cases = [['asking', 'shadow-call', 'waiting'], ['celebrating', 'shadow-leap', 'done'], ['writing', 'shadow-swim', 'working'], ['idle', 'shadow-breathe', 'idle']] as const
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

test('after her leaps of joy she goes back to breathing, and the confetti runs out', () => {
  for (let stage = 1; stage <= 5; stage++) {
    const svg = sprite('celebrating', stage)
    for (const [target, leap, breathe] of [['whole', 'leap', 'breathe'], ['shadow', 'shadow-leap', 'shadow-breathe']] as const) {
      const found = new RegExp(String.raw`\.s-done \.${target}\{animation:${leap} ([\d.]+)s ease-in-out 6,${breathe} [\d.]+s ease-in-out ([\d.]+)s infinite\}`).exec(svg)
      expect(found).not.toBeNull()
      // she starts to breathe just as the last leap lands, not before
      expect(Math.abs(Number(found![2]) - Number(found![1]) * 6)).toBeLessThan(0.005)
    }
  }
  const svg = sprite('celebrating')
  expect(svg).toContain('.confetti{transform-box:fill-box;transform-origin:center;animation:confetti 1.4s ease-in 4;')
  expect(svg).not.toMatch(/animation:confetti [^;]*infinite/)
})

test('waiting for you she hops twice and rests, over and over; her greeting stays three hops', () => {
  for (const stage of [1, 2, 5]) {
    const svg = sprite('asking', stage)
    const seconds = /\.s-waiting \.whole\{animation:call ([\d.]+)s [^;}]* infinite\}/.exec(svg)?.[1]
    expect(seconds).toBeDefined()
    expect(svg).toContain(`.s-waiting .drop{animation:drop-call ${seconds}s linear infinite}`)
    expect(svg).not.toMatch(/\.s-waiting \.whole\{animation:hop /)
    // the second half of the cycle is the rest
    const call = /@keyframes call\{([^@]*)\}(?=@keyframes)/.exec(svg)?.[1] ?? ''
    expect(call.startsWith('0%,25%,50%,100%{transform:translateY(0) scale(1,1)}')).toBe(true)
    const percents = [...call.matchAll(/(?:^|\})([\d.]+)%\{/g)].map(m => Number(m[1]))
    expect(percents).toEqual([3, 10, 15.5, 19.5, 28, 35, 40.5, 44.5])
  }
  const greeting = sprite('greeting', 2)
  expect(greeting).toMatch(/\.m-greeting \.whole\{animation:hop 0\.9s [^;}]* 3,breathe /)
  expect(greeting).toMatch(/@keyframes hop\{0%,100%\{transform:translateY\(0\) scale\(1,1\)\}12%\{/)
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
  // a turn begins aloud, and ends aloud, each in one of several phrases
  expect(VOICE.start).toContain(spoken()[0])
  expect(VOICE.done).toContain(spoken().at(-1))

  await $.turn.start({ text: 'otra', turnId: 'err' })
  await $.turn.complete({ reason: 'error', answer: '', durationMs: 1000, isAborted: false, turnId: 'err', error: 'api' } as never)
  expect(VOICE.error).toContain(spoken().at(-1))

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(VOICE.question).toContain(spoken().at(-1))

  shouldFail = true
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  // no loop alert any more
  expect(spoken()).not.toContain('Creo que esto se está repitiendo.')
  expect(spoken().some(t => String(t).includes('Narsil'))).toBe(false)
})

test('each moment Narsil speaks has several phrases, so she does not always say the same', () => {
  for (const [moment, phrases] of Object.entries(VOICE)) {
    expect([moment, phrases.length >= 4]).toEqual([moment, true])
    expect(new Set(phrases).size).toBe(phrases.length)
  }
  const said = new Set(Array.from({ length: 200 }, () => say('start')))
  expect(said.size).toBeGreaterThan(1)
})

test('what Narsil says is neutral Latin American Spanish: no Spain-only words, the simple past', () => {
  const SPAIN_ONLY = /\b(vale|vaya|vosotros|os|ordenador|tío|tía|guay|coger|móvil|vale la pena)\b/i
  // "ya terminé", not "he terminado"
  const PRESENT_PERFECT = /\b(he|has|ha|hemos|han)\s+\p{L}+(ado|ido)\b/iu
  for (const phrase of Object.values(VOICE).flat()) {
    expect([phrase, SPAIN_ONLY.test(phrase)]).toEqual([phrase, false])
    expect([phrase, PRESENT_PERFECT.test(phrase)]).toEqual([phrase, false])
    // she speaks of herself in the first person, never by name
    expect(phrase.includes('Narsil')).toBe(false)
  }
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

test('an older window server left running is closed and replaced by this version', async ($, on) => {
  const runs: Ran[] = []
  const posts = engine(on, null, { os: 'windows', runs, isOverlayStale: true })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)

  expect(runs.some(r => String(r.env.NARSIL_SERVER).endsWith('\\overlay\\server.cjs'))).toBe(true)
  expect(posts.find(p => p.url.endsWith('/event'))?.body.kind).toBe('question')
  // the new server gets the drawing at once
  expect(posts.some(p => p.url.endsWith('/state') && typeof p.body.svg === 'string')).toBe(true)
})

test('with the window off, the conversation still reaches the hub: started with no window, and pushed to', async ($, on) => {
  const runs: Ran[] = []
  const posts = engine(on, null, { os: 'windows', runs, isOverlayDown: true, hasClock: false, store: noWindow() })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  const server = runs.find(r => String(r.env.NARSIL_SERVER).endsWith('\\overlay\\server.cjs'))
  expect(server?.env.NARSIL_WINDOW).toBe('0')
  await $.tool.call({ tool: 'Edit', file_path: 'C:/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  expect(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.status).toBe('working')
  // an alert still goes as a system notification, not to a window
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(posts.some(p => p.url.endsWith('/event'))).toBe(false)
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
  // the row has room for the state alone; the phone gets the whole warning
  expect(await bandTexts($, 'desktop')).toContain('🧊 Caché fría')
  expect(await bandTexts($, 'desktop')).not.toContain('🧊 Caché fría: el próximo mensaje se cobra completo')
  expect(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.cache).toBe('🧊 Caché fría: el próximo mensaje se cobra completo')

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

  await clock.advance(14 * MINUTE)
  await clock.settle()
  expect(kinds).toEqual(['tip'])

  await clock.advance(MINUTE + 2000)
  await clock.settle()
  expect(kinds).toEqual(['tip', 'steps'])
  const state = posts.filter(p => p.url.endsWith('/state')).at(-1)
  expect(state?.body.steps).toEqual(['Ejecuta los tests de register.tsx', 'Revisa el diff antes del commit', 'Prueba el overlay en vivo'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'step-2' })).toBeDefined()
    // the steps close every conversation, and come with their own line
    expect((await labels(ui)).filter(l => l.startsWith('▾'))).toEqual([])
    expect(await ui.find({ type: 'Text', text: /^─+$/ })).toBeDefined()
    await ui.unmount()
  }
  // a conversation opened hides the steps; all closed again brings them back
  const ownRow = async (ui: Awaited<ReturnType<Engine['ui']['mount']>>) =>
    (await ui.findAll({ type: 'Button' })).find(b => /^[▸▾] /.test(String(b.props.label)))!.key
  let band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const row = String(await ownRow(band))
  await band.press({ key: row })
  await band.unmount()
  band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await labels(band)).filter(l => l.startsWith('▾')).length).toBe(1)
  expect(await band.find({ key: 'step-0' })).toBeUndefined()
  await band.press({ key: row })
  await band.unmount()
  band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'step-0' })).toBeDefined()
  await band.unmount()

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

const DIFF = 'diff --git a/hooks/net.ts b/hooks/net.ts\n+export function retry(times: number) {'

test("a finished turn's tip weighs a design choice of the turn, from its diff, with Haiku at medium effort", async ($, on) => {
  const asked = model(on)
  const { clock } = await tipEngine($, on, { git: args => (args[0] === 'diff' ? DIFF : '') })

  await finishTurn($)
  await clock.settle()

  expect(asked.length).toBe(1)
  expect(asked[0]?.model).toBe('haiku')
  expect(asked[0]?.effort).toBe('medium')
  expect(asked[0]?.prompt).toContain('export function retry(times: number)')
  expect(asked[0]?.prompt).toContain('alternativa')
  // no routine checks: running the tests, the push, whether the error is gone
  expect(asked[0]?.prompt).toContain('comprobaciones rutinarias')
})

test('a long answer reaches the model by both ends, where what is left is said', () => {
  const text = `Hice el cambio. ${'detalle '.repeat(400)}Falta migrar los datos.`
  const shown = ends(text, 300)
  expect(shown.length).toBeLessThanOrEqual(300)
  expect(shown.startsWith('Hice el cambio.')).toBe(true)
  expect(shown.endsWith('Falta migrar los datos.')).toBe(true)
  expect(ends('corta', 300)).toBe('corta')
})

test('a turn that committed its work gives the tip the last commit instead', async ($, on) => {
  const asked = model(on)
  const { clock } = await tipEngine($, on, { git: args => (args[0] === 'show' ? `feat: retry\n${DIFF}` : '') })

  await finishTurn($)
  await clock.settle()

  expect(asked[0]?.prompt).toContain('export function retry(times: number)')
})

test('a failing tool still gets a debugging tip, without reading the diff', async ($, on) => {
  const asked = model(on)
  const runs: Ran[] = []
  on('tool.call', () => ({ isError: true, result: 'boom', text: 'Error: cannot find module ./x' }))
  const { clock } = await tipEngine($, on, { hasTools: false, runs, git: () => DIFF })
  await $.turn.start({ text: 'pasa los tests', turnId: 'debug-diff' })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  await clock.settle()

  expect(asked[0]?.prompt).toContain('depurar')
  expect(asked[0]?.prompt).not.toContain('export function retry')
  expect(runs.some(r => r.argv[0] === 'git')).toBe(false)
})

test('the next steps ask how the project goes on, from its log, its status and its pending tasks', async ($, on) => {
  const asked: Asked[] = []
  on('model.complete', (_, e) => {
    asked.push({ model: e.model, prompt: e.prompt, system: e.system, effort: e.effort })
    return { value: { isAnswered: true as const, text: String(e.system).includes('próximos pasos') ? STEPS : TIP, usage: USAGE } }
  })
  const git = (args: readonly string[]) =>
    args[0] === 'log' ? 'feat: añade el modo oscuro' : args[0] === 'status' ? ' M hooks/net.ts' : ''
  const files = { 'odd/tasks/retry.md': '## Tasks\n- [x] T1 base\n- [ ] T3 reintentos con backoff\n## Log\nL1 algo' }
  const { clock } = await tipEngine($, on, { hasSteps: true, git, files })

  await finishTurn($)
  await clock.settle()
  await clock.advance(15 * MINUTE + 2000)
  await clock.settle()

  const steps = asked.find(a => String(a.system).includes('próximos pasos'))
  expect(steps?.effort).toBe('medium')
  expect(steps?.prompt).toContain('feat: añade el modo oscuro')
  expect(steps?.prompt).toContain('M hooks/net.ts')
  expect(steps?.prompt).toContain('T3 reintentos con backoff')
  // done tasks and the log stay out
  expect(steps?.prompt).not.toContain('T1 base')
  expect(steps?.system).toContain('qué nos falta por hacer')
  expect(steps?.system).toContain('comprobaciones rutinarias')
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
    expect(await chips($, surface)).toEqual(['🐍🔍 Map the overlay · Haiku', '🐍 Review the tests · Haiku'])
  }

  await clock.advance(2 * MINUTE)
  expect(await chips($)).toEqual(['🐍🔍 Map the overlay · Haiku · 2 min', '🐍 Review the tests · Haiku · 2 min'])
  // The explorer reads a file: it is busy, the reviewer is not.
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/overlay.html', agentId: 'a1' } as never)
  await clock.advance(4 * MINUTE)
  expect(await chips($)).toEqual(['🐍🔍 Map the overlay · Haiku · 6 min', '🐍 Review the tests · Haiku · 6 min · sin actividad'])

  const sent = posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.agents as { text: string; color: string }[]
  expect(sent.map(a => a.text)).toEqual(['🐍🔍 Map the overlay · Haiku · 6 min', '🐍 Review the tests · Haiku · 6 min · sin actividad'])
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
    '✓ Map the overlay · Haiku · terminado en 1 min 20 s',
    '✗ Review the tests · Haiku · falló',
    '■ Write the docs · Haiku · detenido',
  ])
  const sent = posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.agents as { color: string }[]
  expect(sent.map(a => a.color)).toEqual(['#22B573', '#F0435A', '#8A90A6'])

  await clock.advance(12_000)
  expect(await chips($)).toEqual([])
  expect(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.agents).toEqual([])
  // The main conversation is still where it was: a subagent's end is not hers.
  expect(posts.some(p => p.url.endsWith('/event'))).toBe(false)
})

test('model ids read as names, whatever their shape', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-5-5')).toBe('Haiku 5.5')
  expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  expect(modelLabel('claude-opus-4-6[1m]')).toBe('Opus 4.6 (1M)')
  expect(modelLabel('haiku')).toBe('Haiku')
  expect(modelLabel('opus[1m]')).toBe('Opus (1M)')
  expect(modelLabel('Opus 5.5')).toBe('Opus 5.5')
  expect(modelLabel('gpt-something')).toBe('gpt-something')
  expect(modelLabel('')).toBe('')
})

test('the band and the window show the main model, and follow a /model change within a heartbeat', async ($, on) => {
  model(on, 'SKIP')
  let main = 'claude-opus-5-5'
  on('session.model', () => ({ value: main }))
  const { posts, clock } = await tipEngine($, on)

  expect(await bandTexts($, 'desktop')).toContain('· Opus 5.5')
  expect((await bandTexts($, 'terminal')).join(' ')).toContain('Opus 5.5')
  expect(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.model).toBe('Opus 5.5')

  main = 'claude-sonnet-5-5'
  await clock.advance(2000)
  await clock.settle()
  expect(await bandTexts($, 'desktop')).toContain('· Sonnet 5.5')
  expect(posts.filter(p => p.url.endsWith('/state')).at(-1)?.body.model).toBe('Sonnet 5.5')
  const status = await $.command.run({ command: 'narsil', args: '', ...TYPED })
  expect(JSON.stringify(status)).toContain('Modelo del hilo principal: Sonnet 5.5.')
})

test('each subagent shows the model it runs on', async ($, on) => {
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  const { clock } = await tipEngine($, on)
  await spawn($, 'Map the overlay', 'Explore')
  expect(await chips($)).toEqual(['🐍🔍 Map the overlay · Haiku 5.5'])
  await clock.advance(80_000)
  await agentDone($, 'a1')
  expect(await chips($)).toEqual(['✓ Map the overlay · Haiku 5.5 · terminado en 1 min 20 s'])
})

test('the subagent chips show each type with its own mark', () => {
  const at = { id: 'x', task: 'Tarea', startedAt: 0, lastActiveAt: 0, isBackground: false }
  expect(agentChip({ ...at, type: 'Explore' }, 0).text).toBe('🐍🔍 Tarea')
  expect(agentChip({ ...at, type: 'Plan' }, 0).text).toBe('🐍📜 Tarea')
  expect(agentChip({ ...at, type: 'claude-code-guide' }, 0).text).toBe('🐍📖 Tarea')
  expect(agentChip({ ...at, type: 'general-purpose' }, 0).text).toBe('🐍 Tarea')
  expect(agentChip({ ...at, type: 'mi-agente' }, 0).text).toBe('🐍✨ Tarea')
})

// --- A permission left waiting, and the session's summary ---

// The tip the floating window was last sent, whole.
function windowTip(posts: Posted[]): unknown {
  return posts.filter(p => p.url.endsWith('/state')).pop()?.body.tip
}

function events(posts: Posted[], title: string): Posted[] {
  return posts.filter(p => p.url.endsWith('/event') && p.body.title === title)
}

test('a command failing again and again, or a file edited again and again, raises no loop alert', async ($, on) => {
  model(on, 'SKIP')
  let shouldFail = true
  on('tool.call', () => (shouldFail ? { isError: true, result: 'boom', text: 'boom' } : { result: {} }))
  const { posts, clock } = await tipEngine($, on, { hasTools: false })
  await $.turn.start({ text: 'arregla los tests', turnId: 'loop' })
  for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' }).catch(() => undefined)
  shouldFail = false
  for (let i = 0; i < 11; i++) await $.tool.call({ tool: 'Edit', file_path: 'C:/repo/app.ts', old_string: 'a', new_string: 'b' } as never)
  await clock.settle()
  expect(events(posts, 'Veo un bucle')).toHaveLength(0)
  expect(String(windowTip(posts) ?? '')).not.toContain('se está repitiendo')
})

// The test engine makes every call as the engine: a call another mod makes
// (narsil-check reading its session at start, say) is told apart by origin.
test('only the tools Claude calls are its work; a call another mod makes is not', () => {
  expect(isClaudesCall({ plugin: 'engine', tier: 'core' })).toBe(true)
  expect(isClaudesCall({ plugin: 'narsil-check', tier: 'user' } as never)).toBe(false)
})

test('a permission left waiting five minutes is insisted on once, even while you look', async ($, on) => {
  model(on, 'SKIP')
  on('classic.PermissionRequest', () => ({}))
  const { posts, clock } = await tipEngine($, on)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm i' }, permission_mode: 'default' })

  await clock.advance(4 * MINUTE + 50_000)
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
  expect(nudged[0]!.body.text).toBe('Sigo esperándote desde hace 5 min: pido permiso para usar Bash.')
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

const states = (posts: Posted[]) => posts.filter(p => p.url.endsWith('/state')).map(p => p.body)

test('the drawing goes to the floating window only when it changes', async ($, on) => {
  model(on, 'SKIP')
  const { posts, clock } = await tipEngine($, on)
  const first = states(posts).length
  expect(String(states(posts).at(-1)?.svg).startsWith('<svg')).toBe(true)

  // heartbeats with nothing new to draw carry no drawing
  await clock.advance(6000)
  await clock.settle()
  const beats = states(posts).slice(first)
  expect(beats.length).toBeGreaterThan(1)
  for (const beat of beats) expect(beat.svg).toBeUndefined()

  // a new state does
  await finishTurn($)
  expect(states(posts).some(s => String(s.svg).includes('class="confetti"'))).toBe(true)
})

test('a window that lost the drawing (its server restarted) gets it again at once', async ($, on) => {
  model(on, 'SKIP')
  let hasDrawing = true
  const { posts, clock } = await tipEngine($, on, {
    stateReply: body => {
      if (body.svg) hasDrawing = true
      return hasDrawing ? '' : 'need-svg'
    },
  })
  hasDrawing = false
  const before = states(posts).length

  await clock.advance(2000)
  await clock.settle()

  const sent = states(posts).slice(before)
  // the heartbeat without it, told it is missing, and the drawing right after
  expect(sent.length).toBeGreaterThanOrEqual(2)
  expect(sent[0]?.svg).toBeUndefined()
  expect(String(sent[1]?.svg).startsWith('<svg')).toBe(true)
  expect(hasDrawing).toBe(true)
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

// What reached ntfy.sh: the phone's notifications.
const toNtfy = (posts: Posted[]) => posts.filter(p => p.url === 'https://ntfy.sh').map(p => p.body)
// The alerts, and apart from them the states the phone app shows.
const toPhone = (posts: Posted[]) => toNtfy(posts).filter(m => !String(m.topic).endsWith('-estado'))
const toStatus = (posts: Posted[]) => toNtfy(posts).filter(m => String(m.topic).endsWith('-estado'))

// The engine, with turns and tools answered.
function phoneEngine(on: On, store: Record<string, unknown> = {}, pushReply?: () => Promise<string> | string, account?: string): Posted[] {
  const posts = engine(on, null, { store, pushReply, account })
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  return posts
}

// Where you write from: Remote Control (your phone, the web) or the desk.
const BY_PHONE = { ...TYPED, origin: { kind: 'bridge' } } as const
const fromPhone = ($: Engine) => $.prompt.submit({ text: 'sigue', wait: false, origin: { kind: 'bridge' } })
const fromDesk = ($: Engine) => $.prompt.submit({ text: 'sigue', wait: false, origin: { kind: 'composer' } })

test('the phone gets the answer beyond its first line, cut at a word with an ellipsis', async ($, on) => {
  const store: Record<string, unknown> = {}
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await $.command.run({ command: 'narsil', args: 'movil', ...BY_PHONE })
  const answer = '## Listo\n\nHe cambiado el **registro** para que valide el correo.\n- ' + 'palabra '.repeat(120)
  await finishTurn($, undefined, answer)
  const message = toPhone(posts)[0]?.message ?? ''
  expect(message.startsWith('He terminado (42 s): Listo\nHe cambiado el registro para que valide el correo.\n- palabra')).toBe(true)
  expect(message.endsWith('palabra…')).toBe(true)
  expect(message.length).toBeLessThanOrEqual(600)
})

test('a question from the phone sends the state too, so the app shows Narsil waiting for you', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  const sent = toStatus(posts)
  expect(sent.length).toBe(1)
  expect(JSON.parse(String(sent[0]?.message)).status).toBe('waiting')
})

test('a turn that fails from the phone sends the state too, so the app shows Narsil stopped', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await $.turn.start({ text: 'arregla el registro', turnId: 'err' })
  await $.turn.complete({ reason: 'error', answer: '', durationMs: 1000, isAborted: false, turnId: 'err', error: 'api' } as never)
  expect(toPhone(posts).map(m => m.priority)).toEqual([4])
  const sent = toStatus(posts)
  expect(sent.length).toBe(1)
  expect(JSON.parse(String(sent[0]?.message)).status).toBe('error')
})

test('as a turn ends from the phone, the app gets what the band shows on the status topic, silently', async ($, on) => {
  const store: Record<string, unknown> = {}
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await $.command.run({ command: 'narsil', args: 'movil', ...BY_PHONE })
  const topic = (store.prefs as { phoneTopic: string }).phoneTopic
  await finishTurn($)
  const sent = toStatus(posts)
  expect(sent.length).toBe(1)
  expect(sent[0]?.topic).toBe(`${topic}-estado`)
  expect(sent[0]?.priority).toBe(1)
  expect(sent[0]?.title).toBeUndefined()
  const state = JSON.parse(String(sent[0]?.message))
  expect(state.status).toBe('done')
  expect(state.statusLabel).toBeTruthy()
  expect(state.headline).toBeTruthy()
  expect(String(state.art)).toMatch(/terminado-oscuro\.png$/)
  expect(typeof state.at).toBe('number')
  expect(state.xp).toBeTruthy()
  expect(Array.isArray(state.usage)).toBe(true)
  expect(state.agents).toBeUndefined()
  // not live: no count of the other conversations, and the cache as when it
  // ends, for the app to count down itself
  expect(state.others).toBeUndefined()
  expect(state.cache).toBeUndefined()
  expect(state.cacheMinutes).toBeGreaterThan(0)
  expect(state.cacheEndsAt - state.at).toBe(state.cacheMinutes * 60)

  // at the desk nothing goes
  await fromDesk($)
  await finishTurn($)
  expect(toStatus(posts).length).toBe(1)
})

test('the state gives each limit its reset as when it comes, for the app to count down', async ($, on) => {
  const store: Record<string, unknown> = {}
  const posts = phoneEngine(on, store)
  measured(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ ...MEASURED, changed: [...MEASURED.changed] })
  await fromPhone($)
  await $.command.run({ command: 'narsil', args: 'movil', ...BY_PHONE })
  await finishTurn($)
  const state = JSON.parse(String(toStatus(posts)[0]?.message))
  const row = (key: string) => state.usage.find((r: { key: string }) => r.key === key)
  expect(row('fiveHour').resetsAt).toBe(Math.floor(Date.parse(IN_2H05) / 1000))
  expect(row('week').resetsAt).toBe(Math.floor(Date.parse(IN_3D) / 1000))
  // no general context: each conversation brings its own, in `sessions`
  expect(row('context')).toBeUndefined()
  expect(state.sessions.map((s: { context: number | null }) => s.context)).toEqual([42])
})

// What a sealed message holds, opened as the phone app opens it.
async function unseal(key: string, sealed: string): Promise<string> {
  const bytes = fromBase64Url(sealed.slice(SEAL_PREFIX.length))
  const k = fromBase64Url(key)
  const utf8 = new TextEncoder()
  const encKey = await hmac(k, utf8.encode('enc'))
  const macKey = await hmac(k, utf8.encode('mac'))
  const nonce = bytes.slice(0, 16)
  const cipher = bytes.slice(16, -32)
  const tag = await hmac(macKey, bytes.slice(0, -32))
  expect(toBase64Url(tag)).toBe(toBase64Url(bytes.slice(-32)))
  const plain = new Uint8Array(cipher.length)
  for (let i = 0; i * 32 < cipher.length; i++) {
    const counter = new Uint8Array([0, 0, 0, i])
    const stream = await hmac(encKey, new Uint8Array([...nonce, ...counter]))
    for (let j = 0; j < 32 && i * 32 + j < cipher.length; j++) plain[i * 32 + j] = cipher[i * 32 + j] ^ stream[j]
  }
  return new TextDecoder().decode(plain)
}

test('/narsil movil clave seals what goes to ntfy.sh; clave off sends it in the clear again', async ($, on) => {
  const store: Record<string, unknown> = {}
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await $.command.run({ command: 'narsil', args: 'movil', ...BY_PHONE })
  const said = await $.command.run({ command: 'narsil', args: 'movil clave', ...BY_PHONE })
  const key = (store.prefs as { phoneKey: string }).phoneKey
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(said.text).toContain(key)
  await finishTurn($, undefined, 'Listo: he cambiado el registro.')

  const alert = toPhone(posts)[0]
  expect(alert?.title).toBe('Narsil')
  expect(String(alert?.message)).toMatch(/^narsil1:/)
  expect(String(alert?.message)).not.toContain('registro')
  const opened = JSON.parse(await unseal(key, String(alert?.message)))
  expect(opened.title).toMatch(/He terminado/)
  expect(opened.message).toContain('he cambiado el registro')

  const status = toStatus(posts)[0]
  expect(status?.title).toBeUndefined()
  const state = JSON.parse(JSON.parse(await unseal(key, String(status?.message))).message)
  expect(state.status).toBe('done')

  await $.command.run({ command: 'narsil', args: 'movil clave off', ...BY_PHONE })
  expect((store.prefs as { phoneKey: string | null }).phoneKey).toBeNull()
  await finishTurn($, undefined, 'Listo otra vez.')
  expect(String(toPhone(posts)[1]?.message)).toContain('Listo otra vez')
})

test('a sealed message stays under the 4096 bytes ntfy.sh keeps as text', async () => {
  const key = newKey()
  const state = { tip: 'ñ'.repeat(1400), steps: ['á'.repeat(200)], headline: 'x' }
  const m = phoneStatus('t', state, true)
  expect((await seal(key, sealedPayload(m))).length).toBeLessThan(4096)
  expect(sealedLength(new TextEncoder().encode(sealedPayload(m)).length)).toBeLessThan(4096)
})

test('the phone gets nothing until /narsil movil is turned on', async ($, on) => {
  const posts = phoneEngine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(toPhone(posts)).toEqual([])
})

test('/narsil movil makes a private topic, says how to follow it, and sends what needs you there', async ($, on) => {
  const store: Record<string, unknown> = {}
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)

  const reply = await $.command.run({ command: 'narsil', args: 'movil', ...BY_PHONE })
  const topic = (store.prefs as { phoneTopic: string }).phoneTopic
  expect(topic).toMatch(/^narsil-[0-9a-f]{20}$/)
  expect(reply.text).toContain(topic)
  expect(reply.text).toContain('ntfy')

  await finishTurn($)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  const sent = toPhone(posts)
  expect(sent.map(m => m.title)).toEqual(['Narsil · He terminado · landing', 'Narsil · Te necesito · landing'])
  expect(sent.every(m => m.topic === topic)).toBe(true)
  expect(sent.map(m => m.priority)).toEqual([3, 4])
  expect(sent[0]?.message).toBe('He terminado (42 s): Listo: he cambiado el registro.')
  // the turn's state and the question's went too, and count
  expect(store.phone).toEqual({ day: '1970-01-01', sent: 4 })

  // the same topic again, and off stops the phone without forgetting it
  await $.command.run({ command: 'narsil', args: 'móvil', ...BY_PHONE })
  expect((store.prefs as { phoneTopic: string }).phoneTopic).toBe(topic)
  const off = await $.command.run({ command: 'narsil', args: 'movil off', ...BY_PHONE })
  expect(off.text).toContain('desactivad')
  await finishTurn($)
  expect(toPhone(posts).length).toBe(2)
  await $.command.run({ command: 'narsil', args: 'movil on', ...BY_PHONE })
  await finishTurn($)
  expect(toPhone(posts).length).toBe(3)
})

test('/narsil movil nuevo changes the topic, and /narsil movil prueba sends one', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)

  const fresh = await $.command.run({ command: 'narsil', args: 'movil nuevo', ...BY_PHONE })
  const topic = (store.prefs as { phoneTopic: string }).phoneTopic
  expect(topic).not.toBe('narsil-0123456789abcdef0123')
  expect(fresh.text).toContain(topic)

  const tried = await $.command.run({ command: 'narsil', args: 'movil prueba', ...TYPED })
  expect(tried.text).toContain('enviado')
  expect(toPhone(posts)).toEqual([expect.objectContaining({ topic, title: 'Narsil · Así te aviso en el móvil · landing' })])
})

test('the phone gets at most 200 a day, says which is the last, and starts again the next day', async ($, on) => {
  const store: Record<string, unknown> = {
    prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true },
    phone: { day: '1970-01-01', sent: 199 },
  }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await finishTurn($)
  const sent = toPhone(posts)
  expect(sent.length).toBe(1)
  expect(String(sent[0]?.message)).toContain('último aviso de hoy')
  expect(store.phone).toEqual({ day: '1970-01-01', sent: 200 })
  const status = await $.command.run({ command: 'narsil', args: 'movil', ...BY_PHONE })
  expect(status.text).toContain('200 de 200')

  // a count of another day, or an odd one, starts from zero
  store.phone = { day: '1969-12-31', sent: 200 }
  await finishTurn($)
  store.phone = 'odd'
  await finishTurn($)
  expect(toPhone(posts).length).toBe(3)
})

test('in quiet mode the phone gets only what needs you', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true, isQuiet: true } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(toPhone(posts).map(m => m.title)).toEqual(['Narsil · Te necesito · landing'])
})

test('each phone alert shows Narsil at her stage, in the pose that fits it', async ($, on) => {
  const art = 'https://raw.githubusercontent.com/davshn/narsil-pet/main/assets'
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  expect(toPhone(posts).at(-1)?.icon).toBe(`${art}/terminado-oscuro.png`)

  // level 10: the third stage
  store.xp = 5000
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(toPhone(posts).at(-1)?.icon).toBe(`${art}/etapa3/necesita-oscuro.png`)
})

test('each phone alert carries a button that opens the Claude app', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  expect(toPhone(posts).at(-1)?.actions).toEqual([{ action: 'view', label: 'Abrir Claude', url: 'https://claude.ai/code' }])
})

test('the phone gets alerts only while you write through Remote Control, never at the desk', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // at the desk: nothing
  await finishTurn($)
  await fromDesk($)
  await finishTurn($)
  expect(toPhone(posts)).toEqual([])
  const status = await $.command.run({ command: 'narsil', args: 'movil', ...TYPED })
  expect(status.text).toContain('Remote Control')

  // a message from the phone: alerts go there
  await fromPhone($)
  await finishTurn($)
  expect(toPhone(posts).length).toBe(1)
  // a command typed at the desk brings you back too
  await $.command.run({ command: 'narsil', args: 'estado', ...TYPED })
  await finishTurn($)
  expect(toPhone(posts).length).toBe(1)
  await $.command.run({ command: 'narsil', args: 'estado', ...BY_PHONE })
  await finishTurn($)
  await fromDesk($)
  await finishTurn($)
  expect(toPhone(posts).length).toBe(2)
})

test('her drawing has no entrance that replays, so redrawing the band never makes her blink', () => {
  for (const mood of ['idle', 'reading', 'celebrating'] as const) {
    const svg = sprite(mood, 2)
    expect(svg).not.toContain('class="enter"')
    expect(svg).not.toContain('animation:enter')
  }
})

test('a tip a little past the 300 characters asked for arrives whole; a runaway one ends at a sentence', () => {
  const long = `${'Separaste el reintento en net.ts en vez de dejarlo en cada llamada. '.repeat(5)}`.trim()
  expect(long.length).toBeGreaterThan(300)
  expect(parse(long)).toBe(long)

  const runaway = `${'Prueba primero el caso que falla. '.repeat(16)}Y después el resto`
  const cut = parse(runaway) ?? ''
  expect(cut.length).toBeLessThanOrEqual(450)
  expect(cut.endsWith('falla.')).toBe(true)
})

test('a turn that ends asking in the desktop app next-step box alerts as a question, with that question', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await $.turn.start({ text: 'arregla el registro', turnId: 'ask' })
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Arreglado.', ask: '¿Lo subo a main?' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Arreglado.', durationMs: 42_000, isAborted: false, turnId: 'ask' })
  const sent = toPhone(posts)
  expect(sent.map(m => [m.title, m.message, m.priority])).toEqual([['Narsil · Te necesito · landing', '¿Lo subo a main?', 4]])
  expect(JSON.parse(String(toStatus(posts).at(-1)?.message)).status).toBe('waiting')

  // a box with no question is a plain finish
  await $.turn.start({ text: 'y ahora', turnId: 'plain' })
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Listo.' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Listo.', durationMs: 42_000, isAborted: false, turnId: 'plain' })
  expect(toPhone(posts).at(-1)?.title).toBe('Narsil · He terminado · landing')
})

test('a turn that ends with background work still running waits for it, and finishes once nothing is left', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  on('classic.Stop', () => ({}))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  const running = [{ id: 'b1', type: 'shell', status: 'running', description: 'npm test', command: 'npm test' }]
  await $.turn.start({ text: 'corre la suite', turnId: 'bg' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: running, session_crons: [] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Espero el aviso.', durationMs: 42_000, isAborted: false, turnId: 'bg' })
  expect(toPhone(posts)).toEqual([])
  expect(JSON.parse(String(toStatus(posts).at(-1)?.message)).status).toBe('working')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /esperando 1 proceso en segundo plano/ })).toBeDefined()
  await band.unmount()

  // the background work wakes the session; that turn leaves nothing behind
  await $.turn.start({ text: '', turnId: 'wake' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Listo.', durationMs: 42_000, isAborted: false, turnId: 'wake' })
  expect(toPhone(posts).map(m => m.title)).toEqual(['Narsil · He terminado · landing'])
  expect(JSON.parse(String(toStatus(posts).at(-1)?.message)).status).toBe('done')
})

test('while you write from the phone in another conversation this one alerts too, and a message at the desk anywhere stops it', async ($, on) => {
  // another conversation saw your last message come from the phone
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true }, remoteOrigin: { isRemote: true, at: 1 } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await finishTurn($)
  expect(toPhone(posts).map(m => m.title)).toEqual(['Narsil · He terminado · landing'])

  // you wrote at the desk, in another conversation
  store.remoteOrigin = { isRemote: false, at: 2 }
  await finishTurn($)
  expect(toPhone(posts).length).toBe(1)

  // where you write here is kept for the others
  await fromPhone($)
  expect((store.remoteOrigin as { isRemote: boolean }).isRemote).toBe(true)
  await fromDesk($)
  expect((store.remoteOrigin as { isRemote: boolean }).isRemote).toBe(false)
})

test('an alert lists every open conversation, and the state leads with the most important and lists them all', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const fleet = [other('local_web', 'error', 'failed', 'web', { conversation: 'abcd1234', context: { percent: 90, note: '' }, cacheEndsAt: 1234, cacheMinutes: 5 })]
  const posts = engine(on, null, { store, fleet, hasClock: false })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  await fromPhone($)
  await finishTurn($)

  const alert = toPhone(posts).at(-1)
  expect(String(alert?.message).endsWith('\n\nConversaciones:\n● web · ERROR\n● landing · TERMINADA')).toBe(true)
  const state = JSON.parse(String(toStatus(posts).at(-1)?.message))
  expect([state.status, state.title, state.headline, state.conversation]).toEqual(['error', 'web', 'web va', 'abcd1234'])
  expect(state.sessions.map((s: { title: string; status: string; isThis: boolean }) => [s.title, s.status, s.isThis])).toEqual([
    ['web', 'error', false],
    ['landing', 'done', true],
  ])
  // every conversation's cache, for the app to count each down
  const [web, landing] = state.sessions
  expect([web.cacheEndsAt, web.cacheMinutes]).toEqual([1234, 5])
  // the head's cache is the most important conversation's, though another sends
  expect([state.cacheEndsAt, state.cacheMinutes]).toEqual([1234, 5])
  expect(landing.cacheMinutes).toBeGreaterThan(0)
  expect(landing.cacheEndsAt).toBe(Math.floor(1_002_000 / 1000) + landing.cacheMinutes * 60)
})

test('each alert and state names its conversation the same way, and two conversations differently', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  let id = 'session-a'
  on('session.id', () => ({ value: id }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  const conversation = JSON.parse(String(toStatus(posts).at(-1)?.message)).conversation
  expect(conversation).toMatch(/^[0-9a-f]{8}$/)
  expect(toPhone(posts).at(-1)?.tags).toEqual(['white_check_mark', `conv-${conversation}`])

  id = 'session-b'
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  const other = JSON.parse(String(toStatus(posts).at(-1)?.message)).conversation
  expect(other).toMatch(/^[0-9a-f]{8}$/)
  expect(other).not.toBe(conversation)
})

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', auth: 'authKey_1', p256dh: 'BPubKey-2' }

test('before each alert the phone app subscription is registered again on ntfy.sh, opened with the key', async ($, on) => {
  const key = newKey()
  const topic = 'narsil-0123456789abcdef0123'
  const store: Record<string, unknown> = { prefs: { phoneTopic: topic, isPhoneOn: true, phoneKey: key } }
  const posts = phoneEngine(on, store, () => seal(key, JSON.stringify({ message: JSON.stringify(SUB) })))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  const urls = posts.map(p => p.url)
  const renewed = urls.indexOf('https://ntfy.sh/v1/webpush')
  expect(posts[renewed]?.body).toEqual({ ...SUB, topics: [topic] })
  // before the alert, which then finds it
  expect(renewed).toBeLessThan(urls.indexOf('https://ntfy.sh'))
  expect(store.phonePush).toEqual(SUB)
})

test('once ntfy.sh forgot what the app left (12 h), the kept subscription is registered; nothing odd reaches it', async ($, on) => {
  const topic = 'narsil-0123456789abcdef0123'
  const store: Record<string, unknown> = { prefs: { phoneTopic: topic, isPhoneOn: true }, phonePush: SUB }
  let left = ''
  const posts = phoneEngine(on, store, () => left)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  const renewals = () => posts.filter(p => p.url === 'https://ntfy.sh/v1/webpush').map(p => p.body)
  expect(renewals()).toEqual([{ ...SUB, topics: [topic] }])

  // something that is not a subscription on the topic: the kept one still goes
  left = JSON.stringify({ endpoint: 'http://evil.example/x', auth: 'a', p256dh: 'b' })
  await finishTurn($)
  expect(renewals().at(-1)).toEqual({ ...SUB, topics: [topic] })
  expect(store.phonePush).toEqual(SUB)
})

test('the state the app shows does not register the subscription; only alerts do', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true }, phonePush: SUB }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  // one alert and one state went: one renewal
  expect(toPhone(posts).length).toBe(1)
  expect(toStatus(posts).length).toBe(1)
  expect(posts.filter(p => p.url === 'https://ntfy.sh/v1/webpush').length).toBe(1)
})

test('what the mod seals, it opens; with another key, or tampered, it does not', async () => {
  const key = newKey()
  const sealed = await seal(key, 'hola Narsil')
  expect(await openSealed(key, sealed)).toBe('hola Narsil')
  expect(await openSealed(newKey(), sealed)).toBeNull()
  const bytes = fromBase64Url(sealed.slice(SEAL_PREFIX.length))
  bytes[20] ^= 1
  expect(await openSealed(key, SEAL_PREFIX + toBase64Url(bytes))).toBeNull()
  expect(await openSealed(key, 'no sellado')).toBeNull()
})

test('the state carries ntfy.sh count of the day, this message included, and when it resets', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const account = JSON.stringify({ limits: { messages: 250 }, stats: { messages: 127, reset_at: 1_793_662_469 } })
  const posts = phoneEngine(on, store, undefined, account)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  const state = JSON.parse(String(toStatus(posts).at(-1)?.message))
  expect(state.usage.at(-1)).toEqual({ key: 'ntfy', label: 'ntfy hoy', percent: (128 / 250) * 100, color: '#22B573', note: '128/250 mensajes', resetsAt: 1_793_662_469 })
})

test('with ntfy.sh count out of reach, the state goes without that row', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fromPhone($)
  await finishTurn($)
  const state = JSON.parse(String(toStatus(posts).at(-1)?.message))
  expect(state.usage.some((r: { key: string }) => r.key === 'ntfy')).toBe(false)
})

test('what Claude costs is no longer counted, kept, shown or sent to the phone', async ($, on) => {
  const store: Record<string, unknown> = { prefs: { phoneTopic: 'narsil-0123456789abcdef0123', isPhoneOn: true } }
  const posts = phoneEngine(on, store)
  measured(on)
  on('session.id', () => ({ value: 'session-a' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ ...MEASURED, cost: { usd: 1.25 }, changed: ['cost'] } as never)
  for (const surface of ['desktop', 'terminal'] as const) expect((await bandTexts($, surface)).some(t => t.startsWith('💵'))).toBe(false)
  expect(store.spend).toBeUndefined()
  await fromPhone($)
  await finishTurn($)
  expect(JSON.parse(String(toStatus(posts).at(-1)?.message)).spend).toBeUndefined()
})

test('a state with many conversations drops their headlines, then the last ones, to fit ntfy.sh', () => {
  const sessions = Array.from({ length: 60 }, (_, i) => ({ conversation: `c${i}`, title: `conversación ${i}`, status: 'working', headline: 'x'.repeat(80), context: 10 }))
  const sent = JSON.parse(phoneStatus('narsil-t', { status: 'working', tip: 'un consejo', steps: ['uno'], sessions }).message)
  expect(new TextEncoder().encode(JSON.stringify(sent)).length).toBeLessThanOrEqual(3900)
  expect([sent.tip, sent.steps]).toEqual([null, []])
  expect(sent.sessions[0]).toEqual({ conversation: 'c0', title: 'conversación 0', status: 'working', context: 10 })
  expect(sent.sessions.length).toBeLessThan(60)
  // a few fit whole
  const few = JSON.parse(phoneStatus('narsil-t', { status: 'working', sessions: sessions.slice(0, 2) }).message)
  expect(few.sessions[1].headline).toBe('x'.repeat(80))
})
