// Narsil's advice: what the mod remembers of the work in progress, how it
// becomes the prompt of one small completion, and how the reply becomes a tip.
// Pure functions over plain values: the hooks module owns the calls.

// Why a tip was asked for.
export type TipKind = 'review' | 'debug' | 'pacing' | 'asked'

export type Call = { tool: string; detail: string }
export type Failure = { tool: string; error: string }

// What the hooks module collects. Module variables: losing it on a reload is
// harmless, the next turn fills it again.
export type Context = {
  prompt: string
  calls: Call[]
  failures: Failure[]
  // Files edited or written this turn, by name, with how many times.
  touched: Map<string, number>
  durationMs: number
  answer: string
  // What the turn changed, as git shows it: read just before the tip is asked.
  diff: string
  // Where the project stands (recent commits, uncommitted files, pending
  // tasks): read just before the next steps are asked.
  project: string
}

export const MAX_CALLS = 15
export const MAX_FAILURES = 5
export const MAX_CONTEXT = 6000
export const MAX_ANSWER = 1500
export const MAX_DIFF = 3000
export const MAX_PROJECT = 2000
// The model is asked for 300 characters and often writes a few more: those
// show whole, and only a runaway tip is cut, at its last full sentence.
export const ASKED_TIP = 300
export const MAX_TIP = 450

export function emptyContext(): Context {
  return { prompt: '', calls: [], failures: [], touched: new Map(), durationMs: 0, answer: '', diff: '', project: '' }
}

export function remember<T>(list: T[], item: T, max: number): void {
  list.push(item)
  if (list.length > max) list.splice(0, list.length - max)
}

// Drops what looks like a secret: `name=value` pairs whose name says key,
// token, secret or password, and long base64 or hex runs.
export function sanitize(text: string): string {
  return text
    .replace(/[^\s"'`]*(key|token|secret|password)[^\s"'`]*\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, '[oculto]')
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, '[oculto]')
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// Like clip, but keeps both ends: an answer says what it did first and what is
// left last, so the middle is what goes.
export function ends(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const head = Math.floor(max / 3)
  return `${flat.slice(0, head)} … ${flat.slice(flat.length - (max - head - 3))}`
}

// Like clip, but keeps the lines: a diff or a list reads by its lines.
function cut(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

function minutes(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`
}

const NO_ROUTINE =
  'Nada de comprobaciones rutinarias (ejecutar los tests, revisar el push o el commit, mirar si el error ya no sale).'

const DESIGN =
  'Comenta una decisión de diseño de lo que se hizo: por qué se hizo así, qué alternativa había y qué se gana o se pierde con cada una, o cómo mejorar esa funcionalidad.'

const REASON: Record<TipKind | 'steps', string> = {
  review: `El turno acaba de terminar. ${DESIGN} ${NO_ROUTINE}`,
  debug: 'Una herramienta ha fallado varias veces: da un consejo para depurarlo.',
  pacing: 'El turno lleva mucho tiempo: da un consejo de ritmo o de dividir la tarea.',
  asked: `La persona te pide un consejo ahora. ${DESIGN} ${NO_ROUTINE}`,
  steps: 'Propón cómo seguir con el proyecto: qué falta por hacer, qué mejorar o qué funcionalidad viene después.',
}

// The context as the model reads it: sanitized, at most MAX_CONTEXT characters.
export function describe(ctx: Context, kind: TipKind | 'steps'): string {
  const lines = [`Motivo: ${REASON[kind]}`]
  if (ctx.prompt) lines.push(`Último mensaje de la persona: ${clip(ctx.prompt, 400)}`)
  if (ctx.touched.size > 0) {
    const files = [...ctx.touched].map(([file, n]) => (n > 1 ? `${file} (${n} veces)` : file))
    lines.push(`Archivos editados en este turno: ${files.join(', ')}`)
  }
  if (ctx.failures.length > 0) {
    lines.push('Fallos recientes:')
    for (const f of ctx.failures) lines.push(`- ${f.tool}: ${clip(f.error, 200)}`)
  }
  if (ctx.calls.length > 0) {
    lines.push('Últimas herramientas usadas:')
    for (const c of ctx.calls) lines.push(`- ${c.tool}${c.detail && c.detail !== c.tool ? `: ${clip(c.detail, 80)}` : ''}`)
  }
  if (ctx.durationMs > 0) lines.push(`Duración del turno: ${minutes(ctx.durationMs)}`)
  if (ctx.answer) lines.push(`Respuesta final: ${ends(ctx.answer, MAX_ANSWER)}`)
  // Only the kinds that weigh the work read what it changed or where the
  // project stands; a debugging or pacing tip has no use for either.
  if (ctx.diff && kind !== 'debug' && kind !== 'pacing') lines.push(`Cambios (git):\n${cut(ctx.diff, MAX_DIFF)}`)
  if (ctx.project && kind === 'steps') lines.push(`Estado del proyecto:\n${cut(ctx.project, MAX_PROJECT)}`)
  const all = sanitize(lines.join('\n'))
  return all.length > MAX_CONTEXT ? `${all.slice(0, MAX_CONTEXT - 1)}…` : all
}

export const SYSTEM = [
  'Eres Narsil, una vieja serpiente marina sabia que acompaña a quien programa.',
  'Das UN consejo sabio y concreto sobre el trabajo en curso, el que daría alguien con experiencia que revisa el trabajo.',
  'Reglas:',
  `- Escribe en español, en dos o tres frases, como mucho ${ASKED_TIP} caracteres.`,
  '- Sigue el motivo que se te da. Cuando trate del diseño, nombra la decisión concreta (una función, un archivo, un enfoque),',
  '  la alternativa y por qué una u otra; el diff de los cambios te dice qué se hizo.',
  '- Menciona algo concreto del contexto; nada de motivación genérica ni datos inventados.',
  '- Puedes usar como mucho una metáfora del mar.',
  '- Habla como Narsil, en femenino; no nombres a ningún asistente ni a "Claude".',
  '- El femenino es solo para ti: a la persona háblale de tú con lenguaje neutro, sin suponer su género',
  '  (nada de "juntas", "juntos", "listo" o "lista"; di "contigo", "cuando quieras").',
  '- No repitas ninguno de los consejos anteriores.',
  '- Si no hay nada útil que decir, responde exactamente SKIP.',
  'Responde solo con el consejo (o SKIP), sin comillas ni prefijos.',
].join('\n')

export function prompt(context: string, recent: readonly string[]): string {
  const before = recent.length > 0 ? `\n\nConsejos anteriores (no los repitas):\n${recent.map(t => `- ${t}`).join('\n')}` : ''
  return `Contexto del trabajo:\n${context}${before}\n\nTu consejo:`
}

// The question `/narsil consejo profundo` appends to the session's own transcript.
export function forkPrompt(recent: readonly string[]): string {
  return `${SYSTEM}\n\nMira esta conversación hasta aquí y da tu consejo sobre ella.${
    recent.length > 0 ? `\nConsejos anteriores (no los repitas):\n${recent.map(t => `- ${t}`).join('\n')}` : ''
  }\nTu consejo:`
}

// A tip broken into lines of at most `width` characters, at most `max` of
// them (the last one ending in … when it had to be cut). The band draws each
// as a line of its own, so a long tip never runs past the band's edge.
export function lines(text: string, width: number, max = 3): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    // A word longer than a line (a path, a URL) is cut into pieces.
    for (let piece = word; piece; piece = piece.slice(width)) {
      const chunk = piece.slice(0, width)
      if (!line) line = chunk
      else if (line.length + 1 + chunk.length <= width) line += ` ${chunk}`
      else {
        out.push(line)
        line = chunk
      }
    }
  }
  if (line) out.push(line)
  if (out.length <= max) return out
  const last = out[max - 1]!
  return [...out.slice(0, max - 1), `${last.length < width ? last : last.slice(0, width - 1)}…`]
}

// The reply as a tip, or null when there is nothing to show (SKIP, empty).
export function parse(reply: string): string | null {
  const text = reply
    .trim()
    .replace(/^["'«“]+|["'»”]+$/g, '')
    .replace(/^(consejo|tip)\s*:\s*/i, '')
    .replace(/\bClaude\b/g, 'Narsil')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || /^skip\b/i.test(text)) return null
  if (text.length <= MAX_TIP) return text
  const sentence = /^.*[.!?](?=\s)/.exec(text.slice(0, MAX_TIP))?.[0]
  if (sentence && sentence.length > MAX_TIP / 2) return sentence
  const cut = text.slice(0, MAX_TIP - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > MAX_TIP / 2 ? cut.slice(0, space) : cut}…`
}

// The next steps Narsil offers a few minutes after a finished turn: each one
// a prompt the person can put in the box with one click.
export const MAX_STEPS = 3
export const MAX_STEP = 90

export const STEPS_SYSTEM = [
  'Eres Narsil, una vieja serpiente marina sabia que acompaña a quien programa.',
  'El turno terminó hace unos minutos: propón los próximos pasos que la persona podría pedir ahora.',
  'Responden a "¿cómo seguimos con el proyecto?" y "¿qué nos falta por hacer?": la siguiente tarea pendiente,',
  'una funcionalidad que completa lo que se hizo, o una mejora de diseño que vale la pena.',
  'Reglas:',
  `- Entre uno y ${MAX_STEPS} pasos, uno por línea, en español, como mucho ${MAX_STEP} caracteres cada uno.`,
  '- Cada paso es una petición en imperativo que se le puede enviar tal cual (por ejemplo: "Añade reintentos con backoff a net.ts").',
  `- ${NO_ROUTINE}`,
  '- Concretos y sacados del contexto: las tareas pendientes, los commits recientes, los archivos sin commit; nada inventado.',
  '- Usa lenguaje neutro, sin suponer el género de la persona; no nombres a ningún asistente ni a "Claude".',
  '- Si no hay nada útil que proponer, responde exactamente SKIP.',
  'Responde solo con los pasos (o SKIP), sin comillas ni introducción.',
].join('\n')

// The unfinished tasks of a task file (`odd/tasks/<feature>.md`): its unticked
// `- [ ]` lines, and any line under `## Tasks` that says it is pending. What
// is done and the log stay out.
export function pendingTasks(text: string): string[] {
  const out: string[] = []
  let section = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      section = heading[1]!.toLowerCase()
      continue
    }
    if (section.startsWith('log')) continue
    if (/^[-*]\s+\[ \]\s+/.test(line)) out.push(line.replace(/^[-*]\s+\[ \]\s+/, ''))
    else if (section.startsWith('tasks') && /\b(pending|pendiente|todo|in progress)\b/i.test(line)) out.push(line.replace(/^[-*|]\s*/, ''))
  }
  return out
}

export function stepsPrompt(context: string): string {
  return `Contexto del trabajo:\n${context}\n\nPróximos pasos:`
}

// The reply as at most MAX_STEPS steps; none for SKIP or an empty reply.
export function parseSteps(reply: string): string[] {
  if (/^\s*skip\b/i.test(reply)) return []
  return reply
    .split('\n')
    .map(line =>
      line
        .trim()
        .replace(/^([-*•]|\d+[.)])\s*/, '')
        .replace(/^["'«“]+|["'»”]+$/g, '')
        .replace(/\bClaude\b/g, 'Narsil')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, MAX_STEPS)
    .map(step => (step.length > MAX_STEP ? `${step.slice(0, MAX_STEP - 1)}…` : step))
}
