// Narsil's subagents: how each one running, or just ended, shows as a chip.
// Pure functions over plain values: the hooks module owns the events.

import type { AgentRun } from '../types'

// How long a subagent may go without using a tool before it shows as quiet.
export const QUIET_MS = 5 * 60_000
// How long a finished subagent's chip stays, with how it ended.
export const ENDED_SHOWN_MS = 10_000

// Each type's mark beside the serpent: a magnifier for the explorer, a scroll
// for the planner. The general-purpose one goes bare; any other has a spark.
const TYPE_MARK: Record<string, string> = {
  'general-purpose': '',
  Explore: '🔍',
  Plan: '📜',
  'claude-code-guide': '📖',
  fork: '🪞',
}

export type AgentTone = 'running' | 'quiet' | 'done' | 'failed' | 'stopped'

export const TONE_COLOR: Record<AgentTone, string> = {
  running: '#6E6A85',
  quiet: '#F5B400',
  done: '#22B573',
  failed: '#F0435A',
  stopped: '#8A90A6',
}

// A model as a person reads it, from its id or alias: "claude-opus-5-5" is
// "Opus 5.5", "claude-3-5-sonnet-20241022" "Sonnet 3.5", "opus[1m]" "Opus
// (1M)". A name of another family is left as it is.
export function modelLabel(model: string): string {
  const id = model.trim()
  const family = /(opus|sonnet|haiku|fable)/i.exec(id)?.[1]
  if (!family) return id
  const isLong = /\[1m\]/i.test(id)
  // The version is what digits are left once the date and the family go.
  const rest = id.replace(/\[1m\]/gi, '').replace(/\d{8}/g, '').replace(new RegExp(family, 'i'), ' ')
  const version = /(\d+)(?:[-.](\d+))?/.exec(rest)
  const name = family[0]!.toUpperCase() + family.slice(1).toLowerCase()
  const number = version ? ` ${version[1]}${version[2] ? `.${version[2]}` : ''}` : ''
  return `${name}${number}${isLong ? ' (1M)' : ''}`
}

// "45 s", "2 min", "1 min 20 s".
export function took(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const rest = seconds % 60
  return rest ? `${Math.floor(seconds / 60)} min ${rest} s` : `${seconds / 60} min`
}

export function agentChip(run: AgentRun, now: number): { text: string; tone: AgentTone } {
  // The task, and the model it runs on when known.
  const task = run.model ? `${run.task} · ${modelLabel(run.model)}` : run.task
  if (run.outcome === 'done') return { text: `✓ ${task} · terminado en ${took((run.endedAt ?? now) - run.startedAt)}`, tone: 'done' }
  if (run.outcome === 'failed') return { text: `✗ ${task} · falló`, tone: 'failed' }
  if (run.outcome === 'stopped') return { text: `■ ${task} · detenido`, tone: 'stopped' }
  const mark = TYPE_MARK[run.type] ?? '✨'
  const minutes = Math.floor((now - run.startedAt) / 60_000)
  const isQuiet = now - run.lastActiveAt >= QUIET_MS
  const time = minutes >= 1 ? ` · ${minutes} min` : ''
  return { text: `🐍${mark} ${task}${time}${isQuiet ? ' · sin actividad' : ''}`, tone: isQuiet ? 'quiet' : 'running' }
}

// The runs still worth showing: every running one, and the ended ones for
// ENDED_SHOWN_MS.
export function liveRuns(runs: readonly AgentRun[], now: number): AgentRun[] {
  return runs.filter(r => typeof r === 'object' && r !== null && (r.endedAt === undefined || now - r.endedAt < ENDED_SHOWN_MS))
}
