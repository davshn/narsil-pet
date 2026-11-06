// A conversation's task list, as the tools that keep one leave it: TodoWrite
// (the whole list each time), TaskCreate and TaskUpdate (one task at a time),
// and the desktop app's own plan (mcp__ccd_turn__update_plan). Pure.

import type { TaskItem, TaskStatus } from '../types'

export const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
export const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', PLAN_TOOL])

// The most a conversation shares of its list: the rest is left out.
export const MAX_TASKS = 30
const MAX_TEXT = 120

export const TASK_ICON: Record<TaskStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  running: '⟳',
}

const STATUSES = new Set<TaskStatus>(['pending', 'in_progress', 'completed'])

function clean(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

function statusOf(value: unknown, fallback: TaskStatus = 'pending'): TaskStatus {
  return STATUSES.has(value as TaskStatus) ? (value as TaskStatus) : fallback
}

function capped(list: TaskItem[]): TaskItem[] {
  return list.filter(t => t.text).slice(0, MAX_TASKS)
}

// The list after one call of a tool that keeps it; the same list for any
// other tool or a call it cannot read. `result` is the tool's own result.
export function applyTaskCall(list: readonly TaskItem[], tool: string, input: Record<string, unknown>, result?: unknown): readonly TaskItem[] {
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? (input.todos as Record<string, unknown>[]) : null
    if (!todos) return list
    return capped(todos.map((t, i) => ({ id: String(i + 1), text: clean(t.content), status: statusOf(t.status) })))
  }
  if (tool === 'TaskCreate') {
    const task = (result as { task?: { id?: unknown; subject?: unknown } } | undefined)?.task
    const id = task?.id === undefined ? String(list.length + 1) : String(task.id)
    return capped([...list.filter(t => t.id !== id), { id, text: clean(task?.subject ?? input.subject), status: 'pending' }])
  }
  if (tool === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    if (input.status === 'deleted') return list.filter(t => t.id !== id)
    return list.map(t =>
      t.id === id ? { ...t, text: input.subject === undefined ? t.text : clean(input.subject), status: statusOf(input.status, t.status) } : t,
    )
  }
  if (tool === PLAN_TOOL) return applyPlan(list, input)
  return list
}

// The desktop app's plan: a whole new list, or a step moved along by its
// place (1-based).
function applyPlan(list: readonly TaskItem[], input: Record<string, unknown>): readonly TaskItem[] {
  if (Array.isArray(input.items)) {
    return capped((input.items as Record<string, unknown>[]).map((t, i) => ({ id: String(i + 1), text: clean(t.content), status: statusOf(t.status) })))
  }
  let next = [...list]
  const set = (index: number, status: TaskStatus) => {
    if (next[index]) next[index] = { ...next[index]!, status }
  }
  if (input.advance === true) {
    const at = next.findIndex(t => t.status === 'in_progress')
    if (at >= 0) set(at, 'completed')
    const following = next.findIndex((t, i) => i > at && t.status === 'pending')
    if (following >= 0) set(following, 'in_progress')
  }
  if (Array.isArray(input.done)) for (const n of input.done) if (typeof n === 'number') set(n - 1, 'completed')
  if (typeof input.start === 'number') {
    next = next.map(t => (t.status === 'in_progress' ? { ...t, status: 'pending' } : t))
    set(input.start - 1, 'in_progress')
  }
  return next
}

// The background work still in flight as the main loop stopped, as tasks.
export function backgroundTasks(tasks: readonly { id?: unknown; type?: unknown; description?: unknown; command?: unknown }[] | undefined): TaskItem[] {
  return (tasks ?? []).map((t, i) => {
    const what = clean(t.description || t.command || t.type)
    const kind = t.type === 'shell' ? 'proceso' : t.type === 'monitor' ? 'vigilante' : t.type === 'subagent' ? 'subagente' : String(t.type ?? 'tarea')
    return { id: `bg-${String(t.id ?? i)}`, text: `${kind} en segundo plano: ${what}`, status: 'running' as const }
  })
}
