// What Narsil is doing: one mood per kind of activity of Claude's.
export type Mood =
  | 'greeting'
  | 'idle'
  | 'thinking'
  | 'talking'
  | 'reading'
  | 'searching'
  | 'writing'
  | 'running'
  | 'asking'
  | 'scared'
  | 'celebrating'
  | 'failed'

// The state a mood belongs to: each has its own set of animations and color.
export type Status = 'working' | 'idle' | 'waiting' | 'done' | 'error'

export type Pet = { mood: Mood; line: string; detail: string }

export type Prefs = {
  isHidden: boolean
  isMuted: boolean
  isFloating: boolean
  // Narsil's tips: on or off, at most one automatic tip every so many
  // minutes, and whether the turn-finished ones are spoken.
  isAdviceOn: boolean
  adviceEveryMinutes: number
  isAdviceSpoken: boolean
}

// The tip on show: its text, why it was given (TipKind) and when. Faded: it
// has left the band, and only the floating window still shows it.
export type Tip = { text: string; kind: string; at: number; isFaded?: boolean }

// The open conversations, by state, as the floating window counts them.
export type Fleet = Record<Status, number> & { total: number }

// One limit's fill, 0 to 100, and when its window starts over (ISO 8601).
export type Meter = { percent: number; resetsAt?: string }

// What this session has spent: the context window (null until the first
// response) and the account's 5-hour and weekly windows (null off a plan).
export type Usage = {
  context: { percent: number; tokens: number; window: number } | null
  fiveHour: Meter | null
  week: Meter | null
}

declare module 'claude-code' {
  interface PluginState {
    'narsil-pet': { pet: Pet; prefs: Prefs; fleet: Fleet | null; tip: Tip | null; usage: Usage }
  }
}
