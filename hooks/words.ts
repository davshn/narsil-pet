// How Narsil puts things into words: what each state is called, the headline
// and her asides, how a tool call reads, which commands are tests or cannot
// be taken back, the tip's lines and the cache's label. Pure functions over
// plain values: the hooks module owns the events.

import type { Cache, Fleet, Mood, Status } from '../types'
import { lines } from './advice'
import { levelColor } from './usage'

// What each state is called, the same everywhere it shows.
export const STATUS_LABEL: Record<Status, string> = {
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
export function headline(mood: Mood, detail: string): string {
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
export const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
export const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
export const WRITING_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

// A command that runs a project's tests.
export const TEST_COMMAND =
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

export function dangerOf(command: string): string | null {
  return DANGEROUS_COMMANDS.find(([, pattern]) => pattern.test(command))?.[0] ?? null
}

export const MOOD_BY_TOOL: Record<string, Mood> = {
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

export function pick(mood: Mood): string {
  const options = LINES[mood]
  return options[Math.floor(Math.random() * options.length)] ?? ''
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function describeCall(tool: string, input: unknown): string {
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

export function fleetSummary(f: Fleet | null): string {
  if (!f || f.total < 2) return ''
  const parts = (['working', 'waiting', 'error', 'done', 'idle'] as const)
    .filter(s => f[s] > 0)
    .map(s => `${f[s]} ${COUNT_LABEL[s][f[s] === 1 ? 0 : 1]}`)
  return `${f.total} conversaciones abiertas: ${parts.join(' · ')}`
}

export function summary(answer: string, took: string): string {
  const first = answer.replace(/[#*_`>]/g, '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return first ? `He terminado (${took}): ${first.slice(0, 120)}` : `He terminado (${took}).`
}

export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`
}

export function ago(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 5) return 'ahora mismo'
  return seconds >= 60 ? `hace ${Math.round(seconds / 60)} min` : `hace ${seconds} s`
}

// The desktop band's tip lines, in characters: short enough to fit beside
// Narsil in a narrow window, since the band's width cannot be read from here.
export const TIP_LINE = 60
// Subagents listed in the band at most; the window lists as many.
export const MAX_AGENTS_SHOWN = 6

// The tip as the band draws it, '💡' ahead of its first line.
export function tipLines(text: string, width: number): string[] {
  return lines(`💡 ${text}`, width)
}

export function cacheLeft(at: number, minutes: number, now: number): number {
  return Math.max(0, Math.ceil((at + minutes * 60_000 - now) / 60_000))
}

export function cacheLabel(c: Cache): string {
  return c.left > 0 ? `🧊 Caché: ${c.left} min` : '🧊 Caché fría: el próximo mensaje se cobra completo'
}

// The color of what the cache has spent of its life: green while fresh.
export function cacheColor(c: Cache): string {
  return levelColor(100 - (c.left / c.minutes) * 100)
}
