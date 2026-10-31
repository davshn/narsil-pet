// Narsil grows with the work she sees through: experience for each finished
// turn, each test run that passes and each subagent that finishes, kept
// across sessions. Pure functions over plain values: the hooks module owns
// the store and the events.

export const XP_KEY = 'xp'

export const XP_GAIN = {
  turn: 10,
  tests: 5,
  agent: 3,
} as const

export type XpReason = keyof typeof XP_GAIN

// Level 1 needs 100 XP to reach level 2, level 2 needs 200 more, and so on.
const PER_LEVEL = 100

export type Level = { level: number; into: number; needed: number }

export function levelOf(xp: number): Level {
  let level = 1
  let left = Math.max(0, Math.floor(xp))
  while (left >= level * PER_LEVEL) {
    left -= level * PER_LEVEL
    level += 1
  }
  return { level, into: left, needed: level * PER_LEVEL }
}

// Narsil grows up in stages: the first level of each, from the hatchling
// (stage 1) to the grown serpent (stage 5).
export const STAGE_FROM = [1, 5, 10, 20, 35] as const
export const STAGES = STAGE_FROM.length

export function stageOf(level: number): number {
  return STAGE_FROM.filter(from => level >= from).length || 1
}

// A stored value from any version, or none: a whole number of XP.
export function xpOf(stored: unknown): number {
  return typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0
}

// "⭐ Nivel 3 · 120/300 XP".
export function xpLabel(xp: number): string {
  const { level, into, needed } = levelOf(xp)
  return `⭐ Nivel ${level} · ${into}/${needed} XP`
}
