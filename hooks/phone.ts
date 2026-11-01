// Narsil on your phone (and the watch that mirrors it): what needs you goes
// to a private topic on ntfy.sh, which the ntfy app follows. Pure functions
// over plain values: the hooks module sends and counts.

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

// What ntfy.sh is sent, as its JSON form takes it. `where` names the
// conversation; `isLast` says no more come today.
export function phoneMessage(topic: string, kind: PhoneKind, title: string, text: string, where: string, stage: number, isLast: boolean) {
  return {
    topic,
    title: where ? `Narsil · ${title} · ${where}` : `Narsil · ${title}`,
    message: isLast ? `${text}\n(último aviso de hoy: mañana sigo)` : text,
    priority: PRIORITY[kind],
    tags: [TAGS[kind]],
    icon: phoneIcon(kind, stage),
  }
}

// The topic the phone app reads Narsil's state from: not followed by push,
// so its messages never show as notifications.
export function statusTopic(topic: string): string {
  return `${topic}-estado`
}

// ntfy.sh turns a message past 4096 bytes into an attachment: the state
// stays under it, counting each character as two (accents take two).
const STATUS_ROOM = 2000

// What the phone app is sent of the state the desktop shows, as a JSON
// message on the status topic; the tip and the next steps go first when it
// does not fit.
export function phoneStatus(topic: string, state: Record<string, unknown>) {
  let message = JSON.stringify(state)
  if (message.length > STATUS_ROOM) message = JSON.stringify({ ...state, tip: null, steps: [] })
  return { topic: statusTopic(topic), message, priority: 1 }
}

// How to follow the topic, for /narsil movil.
export function phoneHelp(topic: string): string {
  return (
    `Instala la app ntfy (Google Play o F-Droid; también hay para iPhone), pulsa + y suscríbete al tema ${topic} en ntfy.sh. ` +
    'Tu reloj Wear OS mostrará sus notificaciones si tienes activadas las de ntfy en la app del reloj. ' +
    'Quien conozca el nombre del tema puede leer los avisos: no lo compartas (/narsil movil nuevo crea otro).'
  )
}
