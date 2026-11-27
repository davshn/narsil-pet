// What Narsil says aloud at the end of a turn you started by voice (saying
// "Narsil" and dictating): a short spoken summary, so you can answer by voice
// too. Pure functions over plain values: the hooks module owns the calls.

// How recently the ear must have sent a message (Enter) for the prompt that
// follows to count as yours by voice.
export const VOICE_SENT_MS = 5000

// The longest answer the summary is asked about, and about the longest spoken
// text: past it, whole sentences only.
const MAX_ANSWER = 6000
const MAX_SPOKEN = 600

export const SPOKEN_SYSTEM = [
  'You turn the final answer of a coding assistant into what a voice assistant says aloud to the person who asked by voice.',
  'Write it in the language of the answer.',
  'Two or three short sentences: what was done and where it stands now, including anything not done or not verified.',
  'If the answer ends with a question to the person, end with that question, so they can answer by voice.',
  'No markdown, lists, code, file paths, commands, URLs or symbols: plain words a speech synthesizer reads well.',
  'Reply with the spoken text only.',
].join(' ')

// What the assistant needs from you in the middle of a turn you started by
// voice: a question with its choices, a plan, or a permission.
export const ASK_SYSTEM = [
  'A coding assistant has stopped in the middle of its work because it needs the person, who is working by voice and may not be looking at the screen.',
  'Tell them aloud what it needs, in the language of the request, in one to three short sentences.',
  'For a question, say the question and each choice, so they can answer by voice.',
  'For a plan, say in a few words what it would do, and that they approve it on screen.',
  'For a permission, say what it wants to run or change, and that they approve it on screen.',
  'No markdown, lists, code, file paths, commands, URLs or symbols: plain words a speech synthesizer reads well.',
  'Reply with the spoken text only.',
].join(' ')

export type Ask =
  | { kind: 'question'; questions: { question: string; options: string[] }[] }
  | { kind: 'plan'; plan: string }
  | { kind: 'permission'; tool: string; input: string }

// A tool's input as words for Haiku: a command or a file when it has one,
// else its fields.
export function inputText(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const fields = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'url', 'path', 'description']) {
    if (typeof fields[key] === 'string' && fields[key]) return String(fields[key])
  }
  try {
    return JSON.stringify(input).slice(0, 2000)
  } catch {
    return ''
  }
}

// What an asking tool's call (AskUserQuestion, ExitPlanMode) asks.
export function askOf(call: Record<string, unknown>, isPlan: boolean): Ask {
  if (isPlan) return { kind: 'plan', plan: typeof call.plan === 'string' ? call.plan : '' }
  const questions = Array.isArray(call.questions) ? call.questions : []
  return {
    kind: 'question',
    questions: questions.map(q => {
      const item = (q ?? {}) as { question?: unknown; options?: unknown }
      const options = Array.isArray(item.options) ? item.options : []
      return {
        question: typeof item.question === 'string' ? item.question : '',
        options: options.map(o => String((o as { label?: unknown })?.label ?? '')).filter(Boolean),
      }
    }),
  }
}

export function askPrompt(ask: Ask): string {
  if (ask.kind === 'question') {
    const asked = ask.questions.map(q => `Question: ${q.question}\nChoices: ${q.options.join(' | ')}`).join('\n\n')
    return `The assistant asks the person:\n\n${asked}`
  }
  if (ask.kind === 'plan') return `The assistant has a plan for the person to approve:\n\n${ask.plan.slice(0, MAX_ANSWER)}`
  return `The assistant asks permission to use the tool ${ask.tool}, with:\n\n${ask.input.slice(0, 2000)}`
}

// Without the model: the question and its choices read as they are, or a
// plain line for a plan or a permission.
export function fallbackAsk(ask: Ask): string {
  if (ask.kind === 'question') {
    const asked = ask.questions.map(q => {
      const choices = q.options.length > 1 ? `${q.options.slice(0, -1).join(', ')}, o ${q.options.at(-1)}.` : q.options.join('')
      return [plainText(q.question), choices].filter(Boolean).join(' ')
    })
    return spokenOf(['Tengo una pregunta para ti.', ...asked].join(' '))
  }
  if (ask.kind === 'plan') return 'Tengo un plan para que lo apruebes en la pantalla.'
  return `Necesito tu permiso para usar ${ask.tool}. Apruébalo en la pantalla.`
}

export function spokenPrompt(answer: string, ask: string | null): string {
  const asked = ask ? `\n\nThe question the assistant asked the person:\n${ask}` : ''
  return `The assistant's final answer:\n\n${answer.slice(0, MAX_ANSWER)}${asked}`
}

// Plain words from markdown: no code blocks, inline code marks, emphasis,
// headings, list marks or links.
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Whole sentences, never one cut in the middle: past `max`, the sentences
// that fit (the first one whole, however long); a last sentence left
// unfinished (no closing mark, as when the model ran out of room) is dropped
// when one before it ends.
export function wholeSentences(text: string, max: number): string {
  // A mark ends a sentence only before a space or the end, so "listen.ps1" or
  // "4.2.2" stay whole.
  const sentences = (text.match(/[\s\S]*?[.!?…]+(?=\s|$)/g) ?? []).map(s => s.trim()).filter(Boolean)
  if (sentences.length === 0) return text
  const kept: string[] = []
  for (const sentence of sentences) {
    if (kept.length > 0 && [...kept, sentence].join(' ').length > max) break
    kept.push(sentence)
  }
  return kept.join(' ')
}

// What the model wrote, as spoken text; empty when there is nothing to say.
export function spokenOf(reply: string): string {
  return wholeSentences(plainText(reply), MAX_SPOKEN)
}

// Without the model: the answer's first sentence, and its closing question
// (or the question asked) when there is one.
export function fallbackSpoken(answer: string, ask: string | null): string {
  const firstLine = answer.split('\n').map(plainText).find(Boolean) ?? ''
  const first = (firstLine.match(/^.*?[.!?](\s|$)/)?.[0] ?? firstLine).trim().replace(/[:;,]$/, '.')
  const sentences = plainText(answer).match(/[^.!?]*\?/g) ?? []
  const question = plainText(ask ?? '') || (sentences.at(-1) ?? '').trim()
  const said = first.endsWith('?') ? first : [first, question].filter(Boolean).join(' ')
  return spokenOf(said)
}
