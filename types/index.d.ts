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
  // The next steps offered a few minutes after a turn, on or off; how long
  // the prompt cache lasts, in minutes (null: 60 on a plan, 5 off one).
  isNextStepsOn: boolean
  cacheMinutes: number | null
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

// The prompt cache since the last turn ended (`at`): how long it lasts and
// the whole minutes it has left, 0 once it has gone cold.
export type Cache = { at: number; minutes: number; left: number }

// A subagent: its task and type, when it started and last used a tool,
// whether it runs in the background, and how it ended once it has.
export type AgentRun = {
  id: string
  task: string
  type: string
  startedAt: number
  lastActiveAt: number
  isBackground: boolean
  endedAt?: number
  outcome?: 'done' | 'failed' | 'stopped'
}

// How a subagent shows: its chip's text and color.
export type AgentChip = { text: string; color: string }

// The next steps offered for the turn that ended at `at`.
export type Steps = { at: number; items: readonly string[] }

// What the session has done since it started: its turns and the time they
// took, the files edited (by name, up to a limit; the rest counted), the
// commands run, the steps that failed and the subagents started.
export type Stats = {
  startedAt: number
  turns: number
  workedMs: number
  files: readonly string[]
  moreFiles: number
  commands: number
  failures: number
  agents: number
}

declare module 'claude-code' {
  interface PluginState {
    'narsil-pet': { pet: Pet; prefs: Prefs; fleet: Fleet | null; tip: Tip | null; usage: Usage; agents: readonly AgentRun[]; agentChips: readonly AgentChip[]; cache: Cache | null; steps: Steps | null; stats: Stats | null; xp: number }
  }
}
