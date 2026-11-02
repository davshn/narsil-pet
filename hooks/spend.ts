// What Claude has cost on this computer: today and since Narsil began
// counting, summed over every conversation. Each conversation reports its
// own running cost (as /cost totals it); only what it adds since its last
// report is counted, so a conversation counts once however often it reports.
// On a Pro or Max plan the figure is what the same tokens would cost on the
// API, not what you pay. Pure functions over plain values: the hooks module
// reads, stores and draws.

// The store key: shared by every conversation on this computer.
export const SPEND_KEY = 'spend'
// The conversations remembered, so a long-lived store stays small.
const MAX_SESSIONS = 200

export type Spend = { day: string; today: number; total: number; sessions: Record<string, number> }

// The local day a moment falls on: "today" starts at your midnight.
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const isAmount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

// What the store holds, or a fresh count for anything odd.
export function spendOf(saved: unknown, day: string): Spend {
  const s = saved as Partial<Spend> | null
  if (!s || typeof s !== 'object' || !isAmount(s.total) || !isAmount(s.today) || typeof s.day !== 'string') return { day, today: 0, total: 0, sessions: {} }
  const sessions: Record<string, number> = {}
  for (const [id, usd] of Object.entries(s.sessions ?? {})) if (isAmount(usd)) sessions[id] = usd
  return { day: s.day, today: s.today, total: s.total, sessions }
}

// The count after `session` reports `usd` so far: what it added since its
// last report goes to today and to the total. A report below the last one
// (the conversation started its count over) adds nothing and becomes the
// new mark. Another day starts today at zero.
export function addSpend(s: Spend, session: string, usd: number, day: string): Spend {
  if (!isAmount(usd)) return s
  const last = s.sessions[session]
  const added = last === undefined ? usd : Math.max(0, usd - last)
  const today = (s.day === day ? s.today : 0) + added
  const ids = Object.keys(s.sessions).filter(id => id !== session).slice(-(MAX_SESSIONS - 1))
  const sessions = Object.fromEntries([...ids.map(id => [id, s.sessions[id]] as const), [session, usd] as const])
  return { day, today, total: s.total + added, sessions }
}

// "$1.23"; under a cent, "<$0.01"; nothing yet, "$0".
export function usdLabel(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

// The band's line: "💵 Hoy $1.23 · total $45.60".
export function spendLabel(s: { today: number; total: number }): string {
  return `💵 Hoy ${usdLabel(s.today)} · total ${usdLabel(s.total)}`
}
