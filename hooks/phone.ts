// Narsil on your phone (and the watch that mirrors it): what needs you goes
// to a private topic on ntfy.sh, which the ntfy app follows. Pure functions
// over plain values: the hooks module sends and counts.

import { levelColor } from './usage'

export const NTFY_URL = 'https://ntfy.sh'
// The store key of how many went today, across every conversation.
export const PHONE_KEY = 'phone'
// ntfy.sh takes 250 a day for free: Narsil stops short of it.
export const PHONE_DAILY = 200

export type PhoneKind = 'done' | 'question' | 'error'
export type PhoneCount = { day: string; sent: number }

// The day a moment falls on, in UTC: "2026-10-31".
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// Today's count from what the store holds: another day's, or an odd value,
// counts as none.
export function countOf(saved: unknown, day: string): PhoneCount {
  const s = saved as Partial<PhoneCount> | null
  const sent = s && typeof s === 'object' && s.day === day && typeof s.sent === 'number' && s.sent >= 0 ? Math.floor(s.sent) : 0
  return { day, sent }
}

// A topic nobody guesses: whoever knows its name can read it.
export function newTopic(uuid: string): string {
  return `narsil-${uuid.replace(/[^0-9a-f]/gi, '').toLowerCase().slice(0, 20)}`
}

const PRIORITY: Record<PhoneKind, number> = { done: 3, question: 4, error: 4 }
const TAGS: Record<PhoneKind, string> = { done: 'white_check_mark', question: 'raising_hand', error: 'warning' }

// Her art as the repository publishes it: the phone fetches the icon itself.
export const ART_URL = 'https://raw.githubusercontent.com/davshn/narsil-pet/main/assets'
const POSE: Record<PhoneKind, string> = { done: 'terminado', question: 'necesita', error: 'error' }

// Narsil at her stage, in the pose that fits the alert: the hatchling's art
// sits at the root of assets, each later stage in its own folder.
export function phoneIcon(kind: PhoneKind, stage: number): string {
  return artUrl(POSE[kind], stage)
}

export function artUrl(pose: string, stage: number): string {
  return `${ART_URL}/${stage > 1 ? `etapa${stage}/` : ''}${pose}-oscuro.png`
}

// One open conversation as an alert lists it: its name and its state.
export type FleetLine = { title: string; label: string }

// Every conversation open as the alert goes, one a line, under the alert's
// own text; nothing when this is the only one.
export function fleetText(lines: readonly FleetLine[]): string {
  if (lines.length < 2) return ''
  return `Conversaciones:\n${lines.map(l => `● ${l.title || 'conversación'} · ${l.label}`).join('\n')}`
}

// What ntfy.sh is sent, as its JSON form takes it. `where` names the
// conversation; `isLast` says no more come today; `fleet`, every open
// conversation (fleetText), goes under the text.
export function phoneMessage(topic: string, kind: PhoneKind, title: string, text: string, where: string, stage: number, isLast: boolean, fleet = '') {
  const body = fleet ? `${text}\n\n${fleet}` : text
  return {
    topic,
    title: where ? `Narsil · ${title} · ${where}` : `Narsil · ${title}`,
    message: isLast ? `${body}\n(último aviso de hoy: mañana sigo)` : body,
    priority: PRIORITY[kind],
    tags: [TAGS[kind]],
    icon: phoneIcon(kind, stage),
    actions: [OPEN_CLAUDE],
  }
}

// A button under the alert. Nothing links to the conversation itself from a
// phone: this one opens the Claude app, where Remote Control lists it.
const OPEN_CLAUDE = { action: 'view', label: 'Abrir Claude', url: 'https://claude.ai/code' }

// The topic the Firefox extension reads Narsil's state from: not followed by
// push, so its messages never show as notifications.
export function statusTopic(topic: string): string {
  return `${topic}-estado`
}

// The topic the phone app leaves its Web Push subscription on, as it opens:
// ntfy.sh drops a subscription whose delivery failed once, and the mod
// registers it again before each alert, so the alerts do not wait for you
// to open the app. Never followed by push.
export function pushTopic(topic: string): string {
  return `${topic}-push`
}

export type PushSubscription = { endpoint: string; auth: string; p256dh: string }
export const PUSH_KEY = 'phonePush'

// A subscription as the app sends it (or as the store keeps it); null for
// anything else, so nothing but an https endpoint and its keys reaches ntfy.sh.
export function pushSubscriptionOf(value: unknown): PushSubscription | null {
  const v = value as Partial<PushSubscription> | null
  if (!v || typeof v !== 'object') return null
  const { endpoint, auth, p256dh } = v
  if (typeof endpoint !== 'string' || !/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 1000) return null
  if (typeof auth !== 'string' || typeof p256dh !== 'string' || !/^[\w-]{1,200}$/.test(auth) || !/^[\w-]{1,200}$/.test(p256dh)) return null
  return { endpoint, auth, p256dh }
}

// What ntfy.sh says of the day's messages from this network, as
// GET /v1/account answers it: a usage row the extension shows with the
// account's limits, counted down to its reset. ntfy.sh counts by IP, in a
// day of its own that starts at an hour hashed from the IP, not at midnight.
// `extra`: messages about to go that the answer does not count yet. Null
// for anything else.
export function ntfyRow(account: unknown, extra = 0): { key: 'ntfy'; label: string; percent: number; color: string; note: string; resetsAt: number } | null {
  const a = account as { limits?: { messages?: unknown }; stats?: { messages?: unknown; reset_at?: unknown } } | null
  const limit = a?.limits?.messages
  const used = a?.stats?.messages
  const resetsAt = a?.stats?.reset_at
  if (typeof limit !== 'number' || typeof used !== 'number' || typeof resetsAt !== 'number' || limit <= 0) return null
  const sent = Math.min(limit, used + extra)
  const percent = (sent / limit) * 100
  return { key: 'ntfy', label: 'ntfy hoy', percent, color: levelColor(percent), note: `${sent}/${limit} mensajes`, resetsAt }
}

// What the Firefox extension is sent of the state, as a JSON message on the
// status topic.
export function phoneStatus(topic: string, state: Record<string, unknown>) {
  return { topic: statusTopic(topic), message: JSON.stringify(state), priority: 1 }
}

// How to follow the topic, for /narsil movil.
export function phoneHelp(topic: string): string {
  return (
    `Instala la app ntfy (Google Play o F-Droid; también hay para iPhone), pulsa + y suscríbete al tema ${topic} en ntfy.sh. ` +
    'Tu reloj Wear OS mostrará sus notificaciones si tienes activadas las de ntfy en la app del reloj. ' +
    'Quien conozca el nombre del tema puede leer los avisos: no lo compartas (/narsil movil nuevo crea otro).'
  )
}

// What ntfy.sh is sent when a key seals it: the title and the text go inside
// the sealed message, and only "Narsil" shows outside. Only an app that
// holds the key reads it (the ntfy app shows noise).
export function sealedMessage<M extends { title?: string; message: string }>(m: M, sealed: string): M {
  return { ...m, ...(m.title ? { title: 'Narsil' } : {}), message: sealed }
}

// What goes inside the seal.
export function sealedPayload(m: { title?: string; message: string }): string {
  return JSON.stringify(m.title ? { title: m.title, message: m.message } : { message: m.message })
}
