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
}

export const MAX_CALLS = 15
export const MAX_FAILURES = 5
export const MAX_CONTEXT = 2000
export const MAX_TIP = 160

export function emptyContext(): Context {
  return { prompt: '', calls: [], failures: [], touched: new Map(), durationMs: 0, answer: '' }
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

function minutes(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`
}

const REASON: Record<TipKind, string> = {
  review: 'El turno acaba de terminar: di qué comprobar o hacer a continuación.',
  debug: 'Una herramienta ha fallado varias veces: da un consejo para depurarlo.',
  pacing: 'El turno lleva mucho tiempo: da un consejo de ritmo o de dividir la tarea.',
  asked: 'La persona te pide un consejo ahora.',
}

// The context as the model reads it: sanitized, at most MAX_CONTEXT characters.
export function describe(ctx: Context, kind: TipKind): string {
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
  if (ctx.answer) lines.push(`Respuesta final: ${clip(ctx.answer, 400)}`)
  const all = sanitize(lines.join('\n'))
  return all.length > MAX_CONTEXT ? `${all.slice(0, MAX_CONTEXT - 1)}…` : all
}

export const SYSTEM = [
  'Eres Narsil, una vieja serpiente marina sabia que acompaña a quien programa.',
  'Das UN consejo breve, sabio y concreto sobre el trabajo en curso.',
  'Reglas:',
  '- Escribe en español, en una o dos frases, como mucho 160 caracteres.',
  '- Menciona algo concreto del contexto: un archivo, un comando, un error, la duración.',
  '- Debe poder ponerse en práctica; nada de motivación genérica ni datos inventados.',
  '- Puedes usar como mucho una metáfora del mar.',
  '- Habla como Narsil, en femenino; no nombres a ningún asistente ni a "Claude".',
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
  const cut = text.slice(0, MAX_TIP - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > MAX_TIP / 2 ? cut.slice(0, space) : cut}…`
}
