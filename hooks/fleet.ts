// Every open conversation as one list: the hub's copy of the others with this
// conversation's own fresh entry, the most important first, a page at a time.
// Pure.

import type { Fleet, FleetSession, FleetView, Status } from '../types'

// The band cannot scroll: it shows this many conversations a page.
export const FLEET_PAGE = 4

// An error first, then what needs you, what works, what finished.
export const RANK: Record<Status, number> = { error: 0, waiting: 1, working: 2, done: 3, idle: 4 }

export const NO_VIEW: FleetView = { open: null, isContext: false, page: 0 }

// The hub's list with this conversation's own entry in its place (the hub's
// copy is a heartbeat old), ranked.
export function fleetOf(hub: readonly FleetSession[], own: FleetSession): FleetSession[] {
  return [own, ...hub.filter(s => s.sessionId !== own.sessionId)].sort(
    (a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || b.changedAt - a.changedAt,
  )
}

// How many conversations are in each state, for /narsil estado.
export function countOfStates(list: readonly FleetSession[]): Fleet {
  const counts: Fleet = { working: 0, idle: 0, waiting: 0, done: 0, error: 0, total: list.length }
  for (const s of list) if (s.status in RANK) counts[s.status] += 1
  return counts
}

// One page of the list, the page kept within the list.
export function pageOf(list: readonly FleetSession[], page: number): { rows: FleetSession[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(list.length / FLEET_PAGE))
  const at = Math.min(Math.max(0, page), pages - 1)
  return { rows: list.slice(at * FLEET_PAGE, (at + 1) * FLEET_PAGE), page: at, pages }
}

// Which conversation is open: the one named, this one by default, none.
export function openOf(view: FleetView, ownId: string): string {
  return view.open === null ? ownId : view.open
}

// A press on a conversation's title opens it, or closes it when open.
export function toggleOpen(view: FleetView, sessionId: string, ownId: string): FleetView {
  return { ...view, open: openOf(view, ownId) === sessionId ? '' : sessionId, isContext: false }
}
