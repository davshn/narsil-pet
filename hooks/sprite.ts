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
//   - effects around her: the state's glow, a pulsing aura, ring or halo,
//     bubbles, water rings and a wave, confetti when done, props.

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

// The picture of a mood in a theme at a stage of her growth, with the name of
// the pose it shows. A pose not drawn yet for her stage shows her base pose of
// that stage, and a stage not drawn yet in a theme the one before it.
function art(mood: Mood, theme: Theme, stage: number): { pose: string; image: Art } {
  const wanted = mood === 'greeting' ? 'hola' : POSE[statusOf(mood)]
  const other: Theme = theme === 'claro' ? 'oscuro' : 'claro'
  for (const t of [theme, other]) {
    for (let s = stage; s >= 1; s--) {
      for (const pose of [wanted, 'base']) {
        const image = ART[s]?.[t]?.[pose]
        if (image) return { pose: s === 1 ? `${pose}-${t}` : `etapa${s}/${pose}-${t}`, image }
      }
    }
  }
  throw new Error('hooks/art.ts holds no art: run tools/build-art.ps1')
}

// Where she stands in the 150 x 120 box.
const BOX = { centerX: 44, top: 2, height: 116 }

// Where each picture has her head (its center) and her neck (where the head
// turns, and below which the head layer fades into the body), as fractions of
// the picture: each pose holds its head somewhere else. A later stage is
// keyed etapa<N>/<pose>-<theme>; one not measured yet takes the default.
type Layout = { headX: number; headY: number; neckY: number }
const LAYOUT: Record<string, Layout> = {
  // stage 1, the hatchling
  'base-claro': { headX: 0.4, headY: 0.3, neckY: 0.45 },
  'hola-claro': { headX: 0.4, headY: 0.32, neckY: 0.46 },
  'trabajando-claro': { headX: 0.4, headY: 0.34, neckY: 0.48 },
  'necesita-claro': { headX: 0.4, headY: 0.34, neckY: 0.48 },
  'parada-claro': { headX: 0.4, headY: 0.34, neckY: 0.48 },
  'terminado-claro': { headX: 0.4, headY: 0.25, neckY: 0.36 },
  'error-claro': { headX: 0.4, headY: 0.25, neckY: 0.36 },
  'base-oscuro': { headX: 0.38, headY: 0.33, neckY: 0.48 },
  'hola-oscuro': { headX: 0.4, headY: 0.32, neckY: 0.47 },
  'trabajando-oscuro': { headX: 0.38, headY: 0.38, neckY: 0.52 },
  'necesita-oscuro': { headX: 0.38, headY: 0.37, neckY: 0.5 },
  'parada-oscuro': { headX: 0.38, headY: 0.37, neckY: 0.5 },
  'terminado-oscuro': { headX: 0.38, headY: 0.2, neckY: 0.3 },
  'error-oscuro': { headX: 0.38, headY: 0.22, neckY: 0.31 },
  // stage 2
  'etapa2/base-claro': { headX: 0.43, headY: 0.31, neckY: 0.46 },
  'etapa2/base-oscuro': { headX: 0.35, headY: 0.2, neckY: 0.3 },
  'etapa2/trabajando-claro': { headX: 0.42, headY: 0.29, neckY: 0.43 },
  'etapa2/trabajando-oscuro': { headX: 0.35, headY: 0.21, neckY: 0.31 },
  'etapa2/parada-claro': { headX: 0.42, headY: 0.3, neckY: 0.44 },
  'etapa2/parada-oscuro': { headX: 0.35, headY: 0.21, neckY: 0.31 },
  'etapa2/necesita-claro': { headX: 0.41, headY: 0.28, neckY: 0.42 },
  'etapa2/necesita-oscuro': { headX: 0.35, headY: 0.21, neckY: 0.31 },
  'etapa2/terminado-claro': { headX: 0.41, headY: 0.27, neckY: 0.41 },
  'etapa2/terminado-oscuro': { headX: 0.38, headY: 0.18, neckY: 0.27 },
  'etapa2/error-claro': { headX: 0.42, headY: 0.27, neckY: 0.41 },
  'etapa2/error-oscuro': { headX: 0.4, headY: 0.18, neckY: 0.27 },
  'etapa2/hola-claro': { headX: 0.41, headY: 0.26, neckY: 0.4 },
  'etapa2/hola-oscuro': { headX: 0.35, headY: 0.2, neckY: 0.3 },
}
const DEFAULT_LAYOUT: Layout = { headX: 0.5, headY: 0.2, neckY: 0.36 }

const MOTION: Record<Status, { swim: number; swimSeconds: number }> = {
  working: { swim: 4.6, swimSeconds: 1.2 },
  idle: { swim: 2, swimSeconds: 5 },
  waiting: { swim: 2.6, swimSeconds: 2.2 },
  done: { swim: 3.6, swimSeconds: 0.9 },
  error: { swim: 3.4, swimSeconds: 0.4 },
}

const STYLE = `
:root{--edge:#ABA4C4;--gold:#E6B23A;--water:#7CC6F2;--card:#FFFFFF}
@media (prefers-color-scheme: dark){:root{--edge:#9FB7E0;--gold:#E9A93A;--water:#5FA6E6;--card:#F4F6FF}}
.th-oscuro{display:none}
@media (prefers-color-scheme: dark){.th-claro{display:none}.th-oscuro{display:inline}}
.enter{transform-box:fill-box;transform-origin:50% 100%;animation:enter .6s cubic-bezier(.3,1.7,.5,1) 1}
.whole{transform-box:fill-box;transform-origin:50% 100%}
.s-working .whole{animation:swim 1.2s ease-in-out infinite}
.m-thinking .whole{animation:ponder 2.4s ease-in-out infinite}
.m-scared .whole{animation:jolt .5s ease-out 2,swim 1.2s ease-in-out 1s infinite}
.s-idle .whole{animation:breathe 4.2s ease-in-out infinite}
.m-idle .whole{filter:saturate(.9)}
.m-greeting .whole{animation:hop .9s cubic-bezier(.3,0,.4,1) 3,breathe 4.2s ease-in-out 2.7s infinite}
.s-waiting .whole{animation:hop 1s cubic-bezier(.3,0,.4,1) infinite}
.s-done .whole{animation:leap .85s ease-in-out 6}
.s-error .whole{animation:shake .14s linear infinite}
.glow-working{filter:drop-shadow(0 0 2.4px rgba(59,139,255,.85))}
.glow-waiting{filter:drop-shadow(0 0 3px rgba(245,180,0,.95))}
.glow-done{filter:drop-shadow(0 0 3px rgba(34,181,115,.9))}
.glow-error{filter:drop-shadow(0 0 3px rgba(240,67,90,.95))}
.aura{transform-box:fill-box;transform-origin:center;animation:aura 1.6s ease-in-out infinite}
.s-error .aura{animation-duration:.5s}
.head{transform-box:view-box}
.s-working .head{animation:nod 1.2s ease-in-out infinite}
.m-thinking .head{animation:tilt 2.4s ease-in-out infinite}
.s-idle .head{animation:doze 4.2s ease-in-out infinite}
.s-waiting .head{animation:tilt 1s ease-in-out infinite}
.s-done .head{animation:nod .42s ease-in-out 12}
.bub{animation:rise 3s ease-in infinite;opacity:0}
.s-working .bub{animation-duration:1.3s}.s-idle .bub{animation-duration:5.5s}.s-done .bub{animation-duration:1s}
.ripple{transform-box:fill-box;transform-origin:center;animation:ripple 2.4s ease-out infinite;opacity:0}
.s-working .ripple{animation-duration:1.4s}.s-done .ripple{animation-duration:.85s}.s-idle .ripple{animation-duration:4.2s}
.wave{animation:wave 2.6s linear infinite}
.s-working .wave{animation-duration:1.3s}.s-idle .wave{animation-duration:6s}
.confetti{transform-box:fill-box;transform-origin:center;animation:confetti 1.4s ease-in infinite;opacity:0}
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
@keyframes enter{0%{transform:scale(.7) translateY(10px);opacity:.2}100%{transform:scale(1);opacity:1}}
@keyframes swim{0%,100%{transform:translate(0,0) rotate(-3deg)}25%{transform:translate(2px,-5px) rotate(0)}50%{transform:translate(0,-7px) rotate(3deg)}75%{transform:translate(-2px,-3px) rotate(0)}}
@keyframes ponder{0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(-4px) rotate(-4deg)}70%{transform:translateY(-2px) rotate(3deg)}}
@keyframes breathe{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-4px) scale(.985,1.035)}}
@keyframes hop{0%,100%{transform:translateY(0) scale(1,1)}12%{transform:translateY(0) scale(1.08,.9)}40%{transform:translateY(-12px) scale(.95,1.07)}62%{transform:translateY(0) scale(1.05,.94)}78%{transform:translateY(-3px) scale(1,1)}}
@keyframes leap{0%,100%{transform:translateY(0) rotate(0) scale(1,1)}14%{transform:translateY(0) scale(1.1,.88)}48%{transform:translateY(-26px) rotate(-10deg) scale(.94,1.08)}70%{transform:translateY(-6px) rotate(6deg)}86%{transform:translateY(0) scale(1.06,.93)}}
@keyframes shake{0%,100%{transform:translateX(0) rotate(0)}25%{transform:translateX(-4px) rotate(-2.5deg)}75%{transform:translateX(4px) rotate(2.5deg)}}
@keyframes jolt{0%{transform:translate(0,0) rotate(0)}20%{transform:translate(-5px,-6px) rotate(-6deg)}45%{transform:translate(4px,0) rotate(4deg)}70%{transform:translate(-2px,-2px) rotate(-2deg)}100%{transform:none}}
@keyframes aura{0%,100%{transform:scale(.85);opacity:.45}50%{transform:scale(1.15);opacity:1}}
@keyframes nod{0%,100%{transform:rotate(-4.5deg)}50%{transform:rotate(4.5deg) translateY(1px)}}
@keyframes doze{0%,100%{transform:rotate(-1.5deg) translateY(.5px)}50%{transform:rotate(5deg) translateY(2.5px)}}
@keyframes tilt{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(6deg) translateY(-1.5px)}}
@keyframes rise{0%{transform:translate(0,0) scale(.6);opacity:0}15%{opacity:.95}50%{transform:translate(3px,-40px) scale(1)}100%{transform:translate(-2px,-84px) scale(1.25);opacity:0}}
@keyframes ripple{0%{transform:scale(.3);opacity:.75}100%{transform:scale(1.6);opacity:0}}
@keyframes wave{from{transform:translateX(0)}to{transform:translateX(-24px)}}
@keyframes confetti{0%{transform:translate(0,0) rotate(0);opacity:0}10%{opacity:1}100%{transform:translate(var(--dx),46px) rotate(320deg);opacity:0}}
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

// The soft glow behind her: fainter in the light theme, where a strong color
// washes out her pale body.
function aura(status: Status, id: string, strength: number): string {
  const color = STATUS_COLOR[status]
  return (
    `<radialGradient id="aura-${id}"><stop offset="0" stop-color="${color}" stop-opacity="${strength}"/>` +
    `<stop offset=".6" stop-color="${color}" stop-opacity="${r1(strength * 0.4)}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`
  )
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
function pictureDefs(mood: Mood, theme: Theme, stage: number): string {
  const { pose, image } = art(mood, theme, stage)
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

function picture(mood: Mood, status: Status, theme: Theme, stage: number): string {
  const { pose, image } = art(mood, theme, stage)
  const at = place(image, pose)
  const id = theme === 'claro' ? 'c' : 'o'
  const glow = status === 'idle' ? '' : ` glow-${status}`
  return (
    `<g class="th-${theme}">` +
    (status === 'idle' ? '' : `<ellipse class="aura" cx="${BOX.centerX}" cy="${r1(BOX.top + BOX.height * 0.55)}" rx="${r1(at.width * 0.55)}" ry="${r1(BOX.height * 0.46)}" fill="url(#aura-${id})"/>`) +
    badge(mood, status, at.headX, at.headY, theme) +
    `<g class="enter"><g class="whole${glow}">` +
    `<g filter="url(#swim)"><use href="#art-${id}"/></g>` +
    `<g class="head" style="transform-origin:${at.headX}px ${at.neckY}px" mask="url(#head-${id})"><use href="#art-${id}"/></g>` +
    `</g></g>` +
    `</g>`
  )
}

function bubbles(): string {
  const at: Array<[number, number, number, number]> = [
    [30, 112, 0, 2.2],
    [58, 114, 1.2, 2.8],
    [22, 108, 2.1, 1.6],
    [66, 110, 0.6, 2],
    [44, 116, 1.7, 3.2],
    [14, 114, 0.9, 1.8],
    [74, 116, 2.5, 2.4],
  ]
  return at
    .map(([x, y, d, r]) => `<circle class="bub" style="animation-delay:${d}s" cx="${x}" cy="${y}" r="${r}" fill="rgba(124,198,242,.18)" stroke="var(--water)" stroke-width="1.2"/>`)
    .join('')
}

// The water she swims in: rings spreading where she meets it, and a wave.
function water(): string {
  const rings = [0, 0.8, 1.6]
    .map(d => `<ellipse class="ripple" style="animation-delay:${d}s" cx="${BOX.centerX}" cy="116" rx="30" ry="5" fill="none" stroke="var(--water)" stroke-width="1.4"/>`)
    .join('')
  let wave = 'M-24 116'
  for (let x = -24; x < 174; x += 12) wave += ` q3 -3 6 0 t6 0`
  return `${rings}<path class="wave" d="${wave}" fill="none" stroke="var(--water)" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>`
}

// A burst of confetti when a job is done.
function confetti(): string {
  const colors = ['#FF6B9A', '#FFD166', '#06D6A0', '#4CC9F0', '#B388FF']
  return Array.from({ length: 12 }, (_, i) => {
    const x = 18 + ((i * 37) % 120)
    const dx = ((i * 17) % 30) - 15
    const delay = r1((i * 0.13) % 1.4)
    return `<rect class="confetti" style="animation-delay:${delay}s;--dx:${dx}px" x="${x}" y="${-10 + ((i * 7) % 14)}" width="4" height="2.4" rx=".6" fill="${colors[i % colors.length]}"/>`
  }).join('')
}

// What says the state at a glance, around her head.
function badge(mood: Mood, status: Status, x: number, y: number, theme: Theme): string {
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
      // fainter in the light theme, over her pale body
      return `<circle class="halo" cx="${x}" cy="${y}" r="25" fill="${color}"${theme === 'claro' ? ' fill-opacity=".55"' : ''}/>`
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
      confetti() +
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

// Stage: how grown she is, 1 (the hatchling) to 5 (see stageOf in xp.ts).
export function sprite(mood: Mood, stage = 1): string {
  const status = statusOf(mood)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -14 150 134" width="150" height="134">` +
    `<defs><linearGradient id="screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B5BD6" stop-opacity=".35"/><stop offset="1" stop-color="#5B5BD6" stop-opacity="0"/></linearGradient>${aura(status, 'o', 0.5)}${aura(status, 'c', 0.2)}${swimFilter(status)}${THEMES.map(theme => pictureDefs(mood, theme, stage)).join('')}</defs>` +
    `<style>${STYLE}</style>` +
    `<g class="s-${status} m-${mood}">` +
    water() +
    THEMES.map(theme => picture(mood, status, theme, stage)).join('') +
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
