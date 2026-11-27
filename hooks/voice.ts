// What Narsil says aloud at the end of a turn you started by voice (saying
// "Narsil" and dictating): a short spoken summary, so you can answer by voice
// too. Pure functions over plain values: the hooks module owns the calls.

// How recently the ear must have sent a message (Enter) for the prompt that
// follows to count as yours by voice.
export const VOICE_SENT_MS = 5000

// The longest answer the summary is asked about, and the longest spoken text.
const MAX_ANSWER = 6000
const MAX_SPOKEN = 400

export const SPOKEN_SYSTEM = [
  'You turn the final answer of a coding assistant into what a voice assistant says aloud to the person who asked by voice.',
  'Write it in the language of the answer.',
  'Two or three short sentences: what was done and where it stands now, including anything not done or not verified.',
  'If the answer ends with a question to the person, end with that question, so they can answer by voice.',
  'No markdown, lists, code, file paths, commands, URLs or symbols: plain words a speech synthesizer reads well.',
  'Reply with the spoken text only.',
].join(' ')

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

// What the model wrote, as spoken text; empty when there is nothing to say.
export function spokenOf(reply: string): string {
  const text = plainText(reply)
  return text.length > MAX_SPOKEN ? `${text.slice(0, MAX_SPOKEN - 1).replace(/\s\S*$/, '')}…` : text
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
