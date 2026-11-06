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
  // Quiet mode: no voice, no turn-finished alerts, no automatic tips or next
  // steps; a question or an error still tells you. Leaves the rest as it was.
  isQuiet: boolean
  // The phone: the private ntfy.sh topic its notifications go to (null until
  // /narsil movil makes one), and whether they go.
  phoneTopic: string | null
  isPhoneOn: boolean
  // The key that seals what goes to the topic, for your own phone app
  // (/narsil movil clave); null: it goes in the clear, as the ntfy app reads.
  phoneKey: string | null
}

// The tip on show: its text, why it was given (TipKind) and when. Faded: it
// has left the band, and only the floating window still shows it. Windowed:
// it opened in a window of its own, so neither the band nor the floating
// window shows it.
export type Tip = { text: string; kind: string; at: number; isFaded?: boolean; isWindowed?: boolean }

// The open conversations, by state, as the floating window counts them.
export type Fleet = Record<Status, number> & { total: number }

// One task of a conversation's list (hooks/tasks.ts); `running` is
// background work still in flight.
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'running'
export type TaskItem = { id: string; text: string; status: TaskStatus }

// One open conversation as the hub serves it to every other: its state and
// what its own band shows, the most important conversation first.
export type FleetSession = {
  sessionId: string
  title: string
  mood: Mood
  status: Status
  headline: string
  model: string | null
  changedAt: number
  // its context window's fill, and what fills it (null until measured)
  context: { percent: number; note: string } | null
  contextDetail: ContextDetail | null
  cache: string | null
  agents: readonly AgentChip[]
  tasks: readonly TaskItem[]
  // how the phone tells it apart (conversationTag); '' when unknown
  conversation: string
}

// What the band has open: one conversation (null: this one; '' none), its
// context's breakdown or not, and which page of the list.
export type FleetView = { open: string | null; isContext: boolean; page: number }

// One limit's fill, 0 to 100, and when its window starts over (ISO 8601).
export type Meter = { percent: number; resetsAt?: string }

// What this session has spent: the context window (null until the first
// response) and the account's 5-hour and weekly windows (null off a plan).
export type Usage = {
  context: { percent: number; tokens: number; window: number } | null
  fiveHour: Meter | null
  week: Meter | null
}

// What fills the context window, as /context breaks it down: each part (a
// category of /context, the compaction reserve, the space left) with its
// tokens and the color it is drawn in, the tokens in use and the window
// measured against, and when it was read. Shown in place of the bars while
// the person has the detail open.
export type ContextPart = { name: string; tokens: number; color: string }
export type ContextDetail = { parts: readonly ContextPart[]; total: number; window: number; at: number }

// The prompt cache since the last turn ended (`at`): how long it lasts and
// the whole minutes it has left, 0 once it has gone cold.
export type Cache = { at: number; minutes: number; left: number }

// A subagent: its task and type, the model it runs on, when it started and
// last used a tool, whether it runs in the background, and how it ended once
// it has.
export type AgentRun = {
  id: string
  task: string
  type: string
  startedAt: number
  lastActiveAt: number
  isBackground: boolean
  model?: string
  endedAt?: number
  outcome?: 'done' | 'failed' | 'stopped'
}

// How a subagent shows: its chip's text and color.
export type AgentChip = { text: string; color: string }

// A moment of her growth celebrated on top of whatever she is doing: a new
// level, or a new stage (which is a new level too).
export type Milestone = { kind: 'level' | 'grew'; level: number; stage: number }

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
    'narsil-pet': { pet: Pet; prefs: Prefs; sessions: readonly FleetSession[]; tasks: readonly TaskItem[]; view: FleetView; tip: Tip | null; usage: Usage; agents: readonly AgentRun[]; agentChips: readonly AgentChip[]; cache: Cache | null; steps: Steps | null; stats: Stats | null; xp: number; milestone: (Milestone & { at: number }) | null; model: string | null; contextDetail: ContextDetail | null }
  }
}
