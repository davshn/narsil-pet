// What Narsil watches over a whole session: work going round in circles, a
// permission left waiting, and what the session has done so far. Pure
// functions over plain values: the hooks module owns the events.

import type { Stats } from '../types'
import { took } from './agents'

// The same step failing this many times in a row, or the same file edited
// this many times in one turn, reads as a loop.
export const REPEAT_FAILS = 3
export const REPEAT_EDITS = 6
// How long a permission or a question may wait before Narsil insists.
export const NUDGE_AFTER_MS = 2 * 60_000
// How long after the last turn, with nothing new, Narsil sums the session up.
export const IDLE_SUMMARY_MS = 30 * 60_000
// The files kept by name for the summary; past this they are only counted.
const MAX_FILES = 200

export function emptyStats(startedAt: number): Stats {
  return { startedAt, turns: 0, workedMs: 0, files: [], moreFiles: 0, commands: 0, failures: 0, agents: 0 }
}

export function addFile(stats: Stats, file: string): Stats {
  if (!file || stats.files.includes(file)) return stats
  if (stats.files.length >= MAX_FILES) return { ...stats, moreFiles: stats.moreFiles + 1 }
  return { ...stats, files: [...stats.files, file] }
}

// The loop warning, or null: `failStreak` is how many times in a row the same
// step has failed, `edits` how many times this turn the file was edited.
export function loopWarning(what: string, failStreak: number, edits: number): string | null {
  if (failStreak === REPEAT_FAILS) return `${what} ha fallado ${failStreak} veces seguidas. Esto se está repitiendo: ¿lo replanteamos?`
  if (edits === REPEAT_EDITS) return `${what} lleva ${edits} ediciones en este turno. Esto se está repitiendo: ¿lo replanteamos?`
  return null
}

export function nudgeText(what: string, waitedMs: number): string {
  return `Sigo esperándote desde hace ${took(waitedMs)}: ${what}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// "Sesión de 1 h 5 min: 4 turnos (12 min de trabajo) · 3 archivos editados
// (a.ts, b.ts, c.ts) · 7 comandos, 1 fallo · 2 subagentes · contexto 40 %".
export function summaryText(stats: Stats, now: number, contextPercent: number | null): string {
  const minutes = Math.max(0, Math.round((now - stats.startedAt) / 60_000))
  const length = minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`
  const fileCount = stats.files.length + stats.moreFiles
  const named = stats.files.slice(0, 3).join(', ') + (fileCount > 3 ? '…' : '')
  const parts = [
    `${plural(stats.turns, 'turno', 'turnos')}${stats.workedMs > 0 ? ` (${took(stats.workedMs)} de trabajo)` : ''}`,
    fileCount > 0 ? `${plural(fileCount, 'archivo editado', 'archivos editados')} (${named})` : 'ningún archivo editado',
    `${plural(stats.commands, 'comando', 'comandos')}, ${plural(stats.failures, 'fallo', 'fallos')}`,
  ]
  if (stats.agents > 0) parts.push(plural(stats.agents, 'subagente', 'subagentes'))
  if (contextPercent !== null) parts.push(`contexto ${Math.round(contextPercent)} %`)
  return `📋 Sesión de ${length}: ${parts.join(' · ')}.`
}

// Each conversation's counts are kept in the store under this prefix and its
// id, so a conversation taken up again after Claude Code restarts keeps
// counting; only the last KEEP_STATS conversations are kept.
export const STATS_PREFIX = 'stats:'
export const KEEP_STATS = 20

const COUNTS = ['startedAt', 'turns', 'workedMs', 'moreFiles', 'commands', 'failures', 'agents'] as const

// A stored value from any version, or none: the counts, or null.
export function statsOf(stored: unknown): Stats | null {
  if (!stored || typeof stored !== 'object') return null
  const s = stored as Record<string, unknown>
  if (!COUNTS.every(key => typeof s[key] === 'number' && Number.isFinite(s[key]))) return null
  if (!Array.isArray(s.files) || !s.files.every(file => typeof file === 'string')) return null
  const n = (key: (typeof COUNTS)[number]) => s[key] as number
  return {
    startedAt: n('startedAt'),
    turns: n('turns'),
    workedMs: n('workedMs'),
    files: (s.files as string[]).slice(0, MAX_FILES),
    moreFiles: n('moreFiles'),
    commands: n('commands'),
    failures: n('failures'),
    agents: n('agents'),
  }
}
