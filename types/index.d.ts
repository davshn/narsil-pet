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

export type Prefs = { isHidden: boolean; isMuted: boolean; isFloating: boolean }

// The open conversations, by state, as the floating window counts them.
export type Fleet = Record<Status, number> & { total: number }

declare module 'claude-code' {
  interface PluginState {
    'narsil-pet': { pet: Pet; prefs: Prefs; fleet: Fleet | null }
  }
}
