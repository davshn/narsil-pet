import type { SessionContextBreakdown, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { ContextDetail, Meter, Usage } from '../types'

// How much of Claude's limits this session has spent: the context window and
// the account's 5-hour and weekly windows, as the status line reads them.

export const NO_USAGE: Usage = { context: null, fiveHour: null, week: null }

export function usageOf(m: { context: SessionContextUsage; rateLimits: readonly SessionRateLimit[] }): Usage {
  const window = (kind: string): Meter | null => {
    const limit = m.rateLimits.find(r => r.kind === kind)
    return limit ? { percent: limit.percentUsed, ...(limit.resetsAt ? { resetsAt: limit.resetsAt } : {}) } : null
  }
  const { percent, tokens, window: size } = m.context
  return {
    context: percent === undefined ? null : { percent, tokens: tokens ?? 0, window: size },
    fiveHour: window('five_hour'),
    week: window('seven_day'),
  }
}

export function hasUsage(u: Usage): boolean {
  return u.context !== null || u.fiveHour !== null || u.week !== null
}

// Green while there is room, amber past 60 %, red past 85 %.
export function levelColor(percent: number): string {
  return percent >= 85 ? '#F0435A' : percent >= 60 ? '#F5B400' : '#22B573'
}

export function textBar(percent: number, cells = 10): string {
  const full = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '█'.repeat(full) + '░'.repeat(cells - full)
}

function tokensLabel(n: number): string {
  return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`
}

// A span of minutes as people read it: "13 min", "2 h 05 min", "3 d 4 h".
export function minutesLabel(minutes: number): string {
  if (minutes >= 24 * 60) return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
  return `${minutes} min`
}

// How long until a window starts over.
export function resetIn(resetsAt: string | undefined, now: number): string {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(at)) return ''
  return minutesLabel(Math.max(0, Math.round((at - now) / 60_000)))
}

// One reading of the context window's fill, and when it was taken.
export type ContextSample = { at: number; percent: number }

const BURN_WINDOW_MS = 15 * 60_000
// Past this, an estimate is too far off to be worth showing.
export const MAX_ESTIMATE_MINUTES = 120

// Minutes until the context window fills, at the pace of the last 15 minutes;
// null with less than a minute of readings, or when it is not growing.
export function minutesToFull(samples: readonly ContextSample[], now: number): number | null {
  const recent = samples.filter(s => now - s.at <= BURN_WINDOW_MS)
  const first = recent[0]
  const last = recent.at(-1)
  if (!first || !last) return null
  const minutes = (last.at - first.at) / 60_000
  if (minutes < 1 || last.percent <= first.percent) return null
  const perMinute = (last.percent - first.percent) / minutes
  return Math.max(0, Math.round((100 - last.percent) / perMinute))
}

export type UsageRow = { key: string; label: string; percent: number; note: string; color?: string }

// The bars to draw, in order, each with what it says beside its percentage.
// `toFull`: minutes until the context fills (minutesToFull), when known.
export function usageRows(u: Usage, now: number, toFull: number | null = null): UsageRow[] {
  const rows: UsageRow[] = []
  if (u.context) {
    const fill = toFull !== null && toFull <= MAX_ESTIMATE_MINUTES ? ` · lleno en ~${minutesLabel(toFull)}` : ''
    rows.push({
      key: 'context',
      label: 'Contexto',
      percent: u.context.percent,
      note: `${tokensLabel(u.context.tokens)} / ${tokensLabel(u.context.window)}${fill}`,
    })
  }
  if (u.fiveHour) {
    const reset = resetIn(u.fiveHour.resetsAt, now)
    rows.push({ key: 'fiveHour', label: '5 horas', percent: u.fiveHour.percent, note: reset ? `reinicia en ${reset}` : '' })
  }
  if (u.week) {
    const reset = resetIn(u.week.resetsAt, now)
    rows.push({ key: 'week', label: 'Semana', percent: u.week.percent, note: reset ? `reinicia en ${reset}` : '' })
  }
  return rows
}

function percentLabel(percent: number): string {
  return `${Math.round(percent)} %`
}

// --- What fills the context window, as /context breaks it down ---

// One color per part, in the order they are listed; the free space is grey.
const PART_COLORS = ['#7C6CF0', '#2FA7D8', '#22B573', '#F5B400', '#F07A3A', '#E0559B', '#5B8DEF', '#9C6ADE']
const FREE_COLOR = '#9A98AD'

// The parts worth showing: what occupies the window, then the compaction
// reserve and the space left. Tool schemas loaded on demand sit outside the
// window, and empty rows say nothing.
export function contextDetailOf(b: SessionContextBreakdown, at: number): ContextDetail {
  const shown = b.categories.filter(c => c.kind !== 'deferred' && c.tokens > 0)
  const order = { used: 0, buffer: 1, free: 2 } as const
  const parts = [...shown]
    .sort((x, y) => order[x.kind as keyof typeof order] - order[y.kind as keyof typeof order] || (x.kind === 'used' ? y.tokens - x.tokens : 0))
    .map((c, i) => ({
      name: c.kind === 'free' ? 'Libre' : c.kind === 'buffer' ? 'Reserva de compactación' : c.name,
      tokens: c.tokens,
      color: c.kind === 'used' ? PART_COLORS[i % PART_COLORS.length]! : FREE_COLOR,
    }))
  return { parts, total: b.totalTokens, window: b.rawMaxTokens, at }
}

// The detail as bars, each part's share of the window.
export function contextDetailRows(d: ContextDetail): UsageRow[] {
  const window = Math.max(1, d.window)
  return d.parts.map((p, i) => ({
    key: `part-${i}`,
    label: p.name,
    percent: (p.tokens / window) * 100,
    note: tokensLabel(p.tokens),
    color: p.color,
  }))
}

// One sentence for the detail, for what cannot see it.
export function contextDetailSummary(d: ContextDetail): string {
  const head = `Contexto: ${tokensLabel(d.total)} / ${tokensLabel(d.window)}`
  return `${head}. ${d.parts.map(p => `${p.name} ${tokensLabel(p.tokens)}`).join(', ')}`
}

// One sentence for what cannot see the bars.
export function usageSummary(rows: readonly UsageRow[]): string {
  return `Uso: ${rows.map(r => `${r.label.toLowerCase()} ${percentLabel(r.percent)}${r.note ? ` (${r.note})` : ''}`).join(', ')}`
}

const BAR = { labelWidth: 58, width: 150, rowHeight: 17 }
// The detail's labels are longer ("Reserva de compactación", "MCP tools").
const DETAIL_LABEL_WIDTH = 150

// The size the bars are drawn at, in CSS pixels.
export function usageBox(rows: readonly UsageRow[], labelWidth = BAR.labelWidth): { width: number; height: number } {
  // room for the longest note, "120k / 200k · lleno en ~2 h 05 min"
  return { width: labelWidth + BAR.width + 250, height: rows.length * BAR.rowHeight }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The detail drawn like the bars, with room for its longer labels.
export function contextDetailSvg(d: ContextDetail): string {
  return usageSvg(contextDetailRows(d), DETAIL_LABEL_WIDTH)
}

// The bars as one small SVG for the desktop band: drawn as an image there,
// like Narsil herself. Each bar fills from empty when it is drawn.
export function usageSvg(rows: readonly UsageRow[], labelWidth = BAR.labelWidth): string {
  const { width, height } = usageBox(rows, labelWidth)
  const body = rows
    .map((r, i) => {
      const y = i * BAR.rowHeight
      const fill = Math.round((Math.max(0, Math.min(100, r.percent)) / 100) * BAR.width)
      const color = r.color ?? levelColor(r.percent)
      return (
        `<text class="t" x="0" y="${y + 11}">${escapeXml(r.label)}</text>` +
        `<rect class="track" x="${labelWidth}" y="${y + 4}" width="${BAR.width}" height="8" rx="4"/>` +
        `<rect x="${labelWidth}" y="${y + 4}" width="${fill}" height="8" rx="4" fill="${color}">` +
        `<animate attributeName="width" from="0" to="${fill}" dur=".8s" fill="freeze"/></rect>` +
        `<text class="t b" x="${labelWidth + BAR.width + 8}" y="${y + 11}" style="fill:${color}">${percentLabel(r.percent)}</text>` +
        (r.note ? `<text class="t d" x="${labelWidth + BAR.width + 46}" y="${y + 11}">${escapeXml(r.note)}</text>` : '')
      )
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<style>.t{font:11px system-ui,'Segoe UI',sans-serif;fill:#3A3850}.b{font-weight:700}.d{fill:#6E6A85}.track{fill:rgba(110,106,133,.22)}` +
    `@media (prefers-color-scheme: dark){.t{fill:#ECEBF3}.d{fill:#9A98AD}.track{fill:rgba(255,255,255,.14)}}</style>` +
    body +
    `</svg>`
  )
}
