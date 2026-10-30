import type { Mood, Status } from '../types'
import { ART } from './art'
import type { Art } from './art'

// Narsil, a chibi sea serpent, drawn from painted art (hooks/art.ts, made by
// tools/build-art.ps1): one pose per state, a light and a dark version of
// each, the theme picked by the viewer's color scheme. A PNG has no parts to
// move, so the life comes from layers over one image:
//   - the whole picture bobs, leaps or shakes (CSS transforms);
//   - the body undulates under an animated displacement filter (SVG);
//   - a second copy, masked to the head, nods or tilts on its own, sharp;
//   - effects around her: the state's glow, ring or halo, bubbles, props.

export function statusOf(mood: Mood): Status {
  switch (mood) {
    case 'greeting':
    case 'idle':
      return 'idle'
    case 'asking':
      return 'waiting'
    case 'celebrating':
      return 'done'
    case 'failed':
      return 'error'
    default:
      return 'working'
  }
}

export const STATUS_COLOR: Record<Status, string> = {
  working: '#3B8BFF',
  idle: '#8A90A6',
  waiting: '#F5B400',
  done: '#22B573',
  error: '#F0435A',
}

// The pose of each state, as named in assets/raw (base until it is drawn).
const POSE: Record<Status, string> = {
  working: 'trabajando',
  idle: 'parada',
  waiting: 'necesita',
  done: 'terminado',
  error: 'error',
}

type Theme = 'claro' | 'oscuro'
const THEMES: readonly Theme[] = ['claro', 'oscuro']

// The picture of a mood in a theme, with the name of the pose it shows.
function art(mood: Mood, theme: Theme): { pose: string; image: Art } {
  const wanted = mood === 'greeting' ? 'hola' : POSE[statusOf(mood)]
  const other: Theme = theme === 'claro' ? 'oscuro' : 'claro'
  for (const [pose, t] of [[wanted, theme], [wanted, other], ['base', theme], ['base', other]] as const) {
    const image = ART[pose]?.[t]
    if (image) return { pose: `${pose}-${t}`, image }
  }
  throw new Error('hooks/art.ts holds no art: run tools/build-art.ps1')
}

// Where she stands in the 150 x 120 box.
const BOX = { centerX: 44, top: 2, height: 116 }

// Where each picture has her head (its center) and her neck (where the head
// turns, and below which the head layer fades into the body), as fractions of
// the picture: each pose holds its head somewhere else.
type Layout = { headX: number; headY: number; neckY: number }
const LAYOUT: Record<string, Layout> = {
  'base-claro': { headX: 0.42, headY: 0.19, neckY: 0.36 },
  'base-oscuro': { headX: 0.55, headY: 0.17, neckY: 0.34 },
  'trabajando-claro': { headX: 0.38, headY: 0.17, neckY: 0.33 },
  'trabajando-oscuro': { headX: 0.64, headY: 0.19, neckY: 0.33 },
  'parada-claro': { headX: 0.36, headY: 0.19, neckY: 0.34 },
  'parada-oscuro': { headX: 0.7, headY: 0.26, neckY: 0.36 },
  'necesita-claro': { headX: 0.38, headY: 0.16, neckY: 0.31 },
  'necesita-oscuro': { headX: 0.5, headY: 0.17, neckY: 0.31 },
  'terminado-claro': { headX: 0.38, headY: 0.17, neckY: 0.3 },
  'terminado-oscuro': { headX: 0.5, headY: 0.17, neckY: 0.3 },
  'error-claro': { headX: 0.36, headY: 0.16, neckY: 0.29 },
  'error-oscuro': { headX: 0.5, headY: 0.18, neckY: 0.31 },
  'hola-claro': { headX: 0.38, headY: 0.16, neckY: 0.3 },
  'hola-oscuro': { headX: 0.5, headY: 0.16, neckY: 0.3 },
}
const DEFAULT_LAYOUT: Layout = { headX: 0.5, headY: 0.2, neckY: 0.36 }

const MOTION: Record<Status, { swim: number; swimSeconds: number }> = {
  working: { swim: 2.6, swimSeconds: 1.6 },
  idle: { swim: 1.1, swimSeconds: 6 },
  waiting: { swim: 1.4, swimSeconds: 3 },
  done: { swim: 2.2, swimSeconds: 1.2 },
  error: { swim: 2, swimSeconds: 0.5 },
}

const STYLE = `
:root{--edge:#ABA4C4;--gold:#E6B23A;--water:#7CC6F2;--card:#FFFFFF}
@media (prefers-color-scheme: dark){:root{--edge:#9FB7E0;--gold:#E9A93A;--water:#5FA6E6;--card:#F4F6FF}}
.th-oscuro{display:none}
@media (prefers-color-scheme: dark){.th-claro{display:none}.th-oscuro{display:inline}}
.enter{transform-box:fill-box;transform-origin:50% 100%;animation:enter .45s cubic-bezier(.3,1.6,.5,1) 1}
.s-working .whole{animation:bob 1.4s ease-in-out infinite}
.s-idle .whole{animation:bob 5.5s ease-in-out infinite}
.m-idle .whole{filter:saturate(.94)}
.s-waiting .whole{animation:bob 2.2s ease-in-out infinite}
.s-done .whole{animation:leap .7s ease-in-out 4}
.s-error .whole{animation:shake .16s linear infinite}
.glow-working{filter:drop-shadow(0 0 1.6px rgba(59,139,255,.75))}
.glow-waiting{filter:drop-shadow(0 0 2px rgba(245,180,0,.85))}
.glow-done{filter:drop-shadow(0 0 2px rgba(34,181,115,.8))}
.glow-error{filter:drop-shadow(0 0 2px rgba(240,67,90,.85))}
.head{transform-box:view-box}
.s-working .head{animation:nod 1.4s ease-in-out infinite}
.s-idle .head{animation:doze 5.5s ease-in-out infinite}
.s-waiting .head{animation:tilt 1.3s ease-in-out infinite}
.s-done .head{animation:nod .7s ease-in-out 4}
.bub{animation:rise 3.6s ease-in infinite;opacity:0}
.s-working .bub{animation-duration:1.5s}.s-idle .bub{animation-duration:6.5s}
.ring{transform-box:fill-box;transform-origin:center;animation:spin 1.2s linear infinite}
.halo{transform-box:fill-box;transform-origin:center;animation:pulse 1.1s ease-in-out infinite}
.pop{transform-box:fill-box;transform-origin:center;animation:pop .55s ease-in-out infinite alternate}
.zz{animation:zz 3.2s ease-out infinite;opacity:0}
.spark{transform-box:fill-box;transform-origin:center;animation:twinkle 1.3s ease-in-out infinite}
.dot{animation:fade 1.2s ease-in-out infinite}
.scan{animation:scan 1.4s ease-in-out infinite}
.sweep{animation:sweep 2.2s ease-in-out infinite}
.code{stroke-dasharray:30;animation:draw 1.6s linear infinite}
.cur{animation:cur 1s steps(1) infinite}
.flash{animation:flash .9s ease-out 1;opacity:0}
@keyframes enter{0%{transform:scale(.86);opacity:.4}100%{transform:scale(1);opacity:1}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes leap{0%,100%{transform:translateY(0) scale(1,1)}15%{transform:translateY(0) scale(1.04,.95)}50%{transform:translateY(-13px) scale(.97,1.04)}}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}
@keyframes nod{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(2.5deg)}}
@keyframes doze{0%,100%{transform:rotate(-1deg) translateY(.5px)}50%{transform:rotate(3deg) translateY(1.5px)}}
@keyframes tilt{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(4deg) translateY(-1px)}}
@keyframes rise{0%{transform:translateY(0);opacity:0}15%{opacity:.9}100%{transform:translateY(-70px);opacity:0}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{transform:scale(.88);opacity:.3}50%{transform:scale(1.08);opacity:.7}}
@keyframes pop{from{transform:scale(.88)}to{transform:scale(1.1)}}
@keyframes zz{0%{transform:translate(0,0);opacity:0}20%{opacity:.9}100%{transform:translate(10px,-18px);opacity:0}}
@keyframes twinkle{0%,100%{transform:scale(.4);opacity:.2}50%{transform:scale(1.1);opacity:1}}
@keyframes fade{0%,100%{opacity:.2}50%{opacity:1}}
@keyframes scan{0%,100%{transform:translateX(-1.6px)}50%{transform:translateX(1.6px)}}
@keyframes sweep{0%,100%{transform:translate(0,0)}25%{transform:translate(6px,-5px)}50%{transform:translate(11px,1px)}75%{transform:translate(4px,5px)}}
@keyframes draw{from{stroke-dashoffset:30}to{stroke-dashoffset:0}}
@keyframes cur{50%{opacity:0}}
@keyframes flash{0%{opacity:.6}100%{opacity:0}}
`

const r1 = (n: number) => Math.round(n * 10) / 10

// Where a picture lands in the box, and its head and neck there.
function place(image: Art, pose: string) {
  const layout = LAYOUT[pose] ?? DEFAULT_LAYOUT
  const width = (BOX.height * image.width) / image.height
  const left = BOX.centerX - width / 2
  return {
    left: r1(left),
    width: r1(width),
    headX: r1(left + width * layout.headX),
    headY: r1(BOX.top + BOX.height * layout.headY),
    neckY: r1(BOX.top + BOX.height * layout.neckY),
  }
}

function swimFilter(status: Status): string {
  const { swim, swimSeconds } = MOTION[status]
  return (
    `<filter id="swim" x="-15%" y="-5%" width="130%" height="110%">` +
    `<feTurbulence type="turbulence" baseFrequency="0.012 0.05" numOctaves="1" seed="3" result="noise">` +
    `<animate attributeName="baseFrequency" dur="${swimSeconds}s" values="0.012 0.05;0.017 0.068;0.012 0.05" repeatCount="indefinite"/>` +
    `</feTurbulence>` +
    `<feDisplacementMap in="SourceGraphic" in2="noise" scale="${swim}" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`
  )
}

// Her picture in one theme: the state's mark around her head, the body under
// the swim filter, and the head again on top, sharp, turning about the neck.
// Its definitions (pictureDefs) all go in the one root <defs>.
function pictureDefs(mood: Mood, theme: Theme): string {
  const { pose, image } = art(mood, theme)
  const at = place(image, pose)
  const id = theme === 'claro' ? 'c' : 'o'
  // The head layer fades out below the neck, so it blends into the body.
  return (
    `<image id="art-${id}" href="${image.src}" x="${at.left}" y="${BOX.top}" width="${at.width}" height="${BOX.height}"/>` +
    `<linearGradient id="fade-${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${r1(at.neckY - 8)}" x2="0" y2="${r1(at.neckY + 6)}">` +
    `<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>` +
    `<mask id="head-${id}" maskUnits="userSpaceOnUse" x="0" y="-14" width="150" height="134"><rect x="0" y="-14" width="150" height="134" fill="url(#fade-${id})"/></mask>`
  )
}

function picture(mood: Mood, status: Status, theme: Theme): string {
  const { pose, image } = art(mood, theme)
  const at = place(image, pose)
  const id = theme === 'claro' ? 'c' : 'o'
  const glow = status === 'idle' ? '' : ` glow-${status}`
  return (
    `<g class="th-${theme}">` +
    badge(mood, status, at.headX, at.headY) +
    `<g class="enter"><g class="whole${glow}">` +
    `<g filter="url(#swim)"><use href="#art-${id}"/></g>` +
    `<g class="head" style="transform-origin:${at.headX}px ${at.neckY}px" mask="url(#head-${id})"><use href="#art-${id}"/></g>` +
    `</g></g>` +
    `</g>`
  )
}

function bubbles(): string {
  const at: Array<[number, number, number]> = [
    [30, 112, 0],
    [58, 114, 1.2],
    [22, 108, 2.1],
    [66, 110, 0.6],
  ]
  return at
    .map(([x, y, d]) => `<circle class="bub" style="animation-delay:${d}s" cx="${x}" cy="${y}" r="2" fill="none" stroke="var(--water)" stroke-width="1.1"/>`)
    .join('')
}

// What says the state at a glance, around her head.
function badge(mood: Mood, status: Status, x: number, y: number): string {
  const color = STATUS_COLOR[status]
  if (mood === 'scared') {
    // a failed step: a red flash, then she works on
    return `<circle class="flash" cx="${x}" cy="${y}" r="26" fill="${STATUS_COLOR.error}"/>`
  }
  switch (status) {
    case 'working':
      return `<circle class="ring" cx="${x}" cy="${y}" r="24" fill="none" stroke="${color}" stroke-width="2.4" stroke-dasharray="10 7" stroke-linecap="round" opacity=".85"/>`
    case 'waiting':
    case 'error':
      return `<circle class="halo" cx="${x}" cy="${y}" r="25" fill="${color}" opacity=".45"/>`
    default:
      return ''
  }
}

function props(mood: Mood, status: Status): string {
  const prop = 'var(--edge)'
  const card = 'var(--card)'
  if (status === 'idle' && mood !== 'greeting') {
    return [0, 1.1, 2.2]
      .map((d, i) => `<text class="zz" style="animation-delay:${d}s" x="${76 + i * 6}" y="${24 - i * 5}" font-family="system-ui, sans-serif" font-weight="800" font-size="${9 + i * 2}" fill="${STATUS_COLOR.idle}">z</text>`)
      .join('')
  }
  if (mood === 'greeting') {
    return (
      `<text x="88" y="34" font-family="system-ui, sans-serif" font-weight="800" font-size="14" fill="#FF6B9A">¡Hola!</text>` +
      `<path class="pop" d="M134 18 c-3 -4 -9 -1 -6 4 l6 6 l6 -6 c3 -5 -3 -8 -6 -4 z" fill="#FF6B9A"/>`
    )
  }
  if (status === 'waiting') {
    return (
      `<g class="pop"><circle cx="104" cy="22" r="15" fill="${STATUS_COLOR.waiting}" stroke="#B88500" stroke-width="1.4"/>` +
      `<path d="M91 30 l-10 5 l13 1 z" fill="${STATUS_COLOR.waiting}" stroke="#B88500" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<text x="104" y="29.5" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="21" fill="#5A4000">?</text></g>`
    )
  }
  if (status === 'error') {
    return (
      `<g class="pop"><text x="92" y="36" font-family="system-ui, sans-serif" font-weight="900" font-size="30" fill="${STATUS_COLOR.error}">!</text>` +
      `<text x="106" y="30" font-family="system-ui, sans-serif" font-weight="900" font-size="20" fill="${STATUS_COLOR.error}">!</text></g>`
    )
  }
  if (status === 'done') {
    const sparkAt: Array<[number, number, number]> = [
      [86, 14, 0],
      [140, 30, 0.4],
      [16, 22, 0.8],
      [126, 6, 1.1],
    ]
    const sparks = sparkAt
      .map(([x, y, d]) => `<path class="spark" style="animation-delay:${d}s" d="M${x} ${y - 5} l1.4 3.6 l3.6 1.4 l-3.6 1.4 l-1.4 3.6 l-1.4 -3.6 l-3.6 -1.4 l3.6 -1.4 z" fill="var(--gold)"/>`)
      .join('')
    return (
      sparks +
      `<circle cx="110" cy="52" r="13" fill="${STATUS_COLOR.done}"/>` +
      `<path d="M104 52 l4.4 4.4 l8 -8.6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
    )
  }
  // working: what she is busy with
  switch (mood) {
    case 'thinking':
      return (
        `<circle cx="76" cy="22" r="2.4" fill="${card}" stroke="${prop}" stroke-width="1.1"/>` +
        `<circle cx="84" cy="14" r="3.8" fill="${card}" stroke="${prop}" stroke-width="1.1"/>` +
        `<rect x="92" y="0" width="46" height="22" rx="11" fill="${card}" stroke="${prop}" stroke-width="1.3"/>` +
        [104, 115, 126].map((x, i) => `<circle class="dot" style="animation-delay:${i * 0.2}s" cx="${x}" cy="11" r="2.8" fill="${STATUS_COLOR.working}"/>`).join('')
      )
    case 'talking':
      return (
        `<path d="M92 8 h46 a6 6 0 0 1 6 6 v14 a6 6 0 0 1 -6 6 h-34 l-10 6 v-6 h-2 a6 6 0 0 1 -6 -6 v-14 a6 6 0 0 1 6 -6 z" fill="${card}" stroke="${prop}" stroke-width="1.2"/>` +
        ([
          [16, 40, 0],
          [22, 30, 0.4],
          [28, 20, 0.8],
        ] as Array<[number, number, number]>)
          .map(([y, w, d]) => `<path class="code" style="animation-delay:${d}s" d="M96 ${y} h${w}" stroke="${STATUS_COLOR.working}" stroke-width="2" stroke-linecap="round"/>`)
          .join('')
      )
    case 'reading':
      return (
        `<g transform="translate(96 34) rotate(-4)"><rect width="44" height="32" rx="2" fill="#FFF7DD" stroke="#C9A54E" stroke-width="1.2"/>` +
        `<path d="M5 6 h34 M5 11 h30 M5 16 h32 M5 21 h22 M5 26 h28" stroke="#C9A54E" stroke-width="1.1"/>` +
        `<rect class="scan" x="3" y="4" width="38" height="4.5" fill="${STATUS_COLOR.working}" opacity=".25"/></g>`
      )
    case 'searching':
      return (
        `<g class="sweep"><circle cx="108" cy="38" r="11" fill="rgba(150,210,255,.35)" stroke="${prop}" stroke-width="3"/>` +
        `<path d="M116 46 l11 11" stroke="${prop}" stroke-width="4.5" stroke-linecap="round"/></g>`
      )
    case 'writing':
    case 'running': {
      const screen =
        mood === 'running'
          ? `<text x="98" y="46" font-family="monospace" font-size="9" fill="#06D6A0">$ run</text>` +
            `<text x="98" y="57" font-family="monospace" font-size="9" fill="#06D6A0">&gt;</text>` +
            `<rect class="cur" x="105" y="50" width="5.5" height="8" fill="#06D6A0"/>`
          : `<path class="code" d="M98 40 h22" stroke="#FF79C6" stroke-width="2.2" stroke-linecap="round"/>` +
            `<path class="code" style="animation-delay:.4s" d="M104 46 h30" stroke="#8BE9FD" stroke-width="2.2" stroke-linecap="round"/>` +
            `<path class="code" style="animation-delay:.8s" d="M104 52 h18" stroke="#50FA7B" stroke-width="2.2" stroke-linecap="round"/>` +
            `<path class="code" style="animation-delay:1.2s" d="M98 58 h26" stroke="#F1FA8C" stroke-width="2.2" stroke-linecap="round"/>`
      return (
        `<rect x="92" y="32" width="52" height="34" rx="3" fill="#1E1F29" stroke="#8A8FA3" stroke-width="1.5"/>` +
        `<rect x="92" y="32" width="52" height="34" rx="3" fill="url(#screen)"/>` +
        screen +
        `<path d="M86 66 h64 l-5 7 h-54 z" fill="#C3C7D4" stroke="#8A8FA3" stroke-width="1.1"/>`
      )
    }
    case 'scared':
      return `<text class="pop" x="90" y="30" font-family="system-ui, sans-serif" font-weight="900" font-size="22" fill="${STATUS_COLOR.error}">!</text>`
    default:
      return ''
  }
}

export function sprite(mood: Mood): string {
  const status = statusOf(mood)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -14 150 134" width="150" height="134">` +
    `<defs><linearGradient id="screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B5BD6" stop-opacity=".35"/><stop offset="1" stop-color="#5B5BD6" stop-opacity="0"/></linearGradient>${swimFilter(status)}${THEMES.map(theme => pictureDefs(mood, theme)).join('')}</defs>` +
    `<style>${STYLE}</style>` +
    `<g class="s-${status} m-${mood}">` +
    THEMES.map(theme => picture(mood, status, theme)).join('') +
    bubbles() +
    props(mood, status) +
    `</g>` +
    `</svg>`
  )
}

// Terminal fallback: a face and the state's mark.
export const FACE: Record<Mood, string> = {
  greeting: '~(^ᴗ^)~ ¡hola!',
  idle: '~(-ᴗ-)~ z',
  thinking: '~(•ᴗ•)~ …',
  talking: '~(•o•)~ ✎',
  reading: '~(•ᴗ•)~ 📜',
  searching: '~(•ᴗ•)~ 🔍',
  writing: '~(•ᴗ•)~ 💻',
  running: '~(•ᴗ•)~ >_',
  asking: '~(•o•)~ ?',
  scared: '~(•△•)~ !',
  celebrating: '~(^ᴗ^)~ ✓',
  failed: '~(>△<)~ ✗',
}
