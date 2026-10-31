// A page to look over Narsil's art as the band animates it: every mood, in
// the light and the dark theme, for the stages of her growth asked for.
//   node tools/preview.mjs          then open http://localhost:47391/
//   http://localhost:47391/?etapas=1,2   (default: stage 1)
// The art is read at start: run tools/build-art.ps1, then restart this.
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The hooks import each other without a suffix, as the engine resolves them.
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context)
      } catch {
        // not a .ts file: resolved as written below
      }
    }
    return next(specifier, context)
  },
})

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { sprite } = await import(pathToFileURL(join(root, 'hooks', 'sprite.ts')).href)

const PORT = 47391
const MOODS = ['greeting', 'idle', 'thinking', 'talking', 'reading', 'searching', 'writing', 'running', 'asking', 'scared', 'celebrating', 'failed']
const CARD = { claro: '#F7F6FB', oscuro: '#16182A' }
const DARK = /@media \(prefers-color-scheme: dark\)\{((?:[^{}]|\{[^{}]*\})*)\}/g

// The sprite with its theme fixed instead of following the viewer's system.
function fixed(svg, theme) {
  return svg.replace(DARK, (_, rules) => (theme === 'oscuro' ? rules : ''))
}

function page(stages) {
  const sections = stages.flatMap(stage =>
    ['claro', 'oscuro'].map(
      theme =>
        `<section style="background:${CARD[theme]};color:${theme === 'oscuro' ? '#E8E8F0' : '#222'}">` +
        `<h2>Etapa ${stage} · ${theme}</h2><div class="row">` +
        // Each as an image of its own: inline, their styles and ids would mix.
        MOODS.map(mood => `<figure><img width="225" height="201" alt="${mood}" src="data:image/svg+xml;base64,${Buffer.from(fixed(sprite(mood, stage), theme)).toString('base64')}"><figcaption>${mood}</figcaption></figure>`).join('') +
        `</div></section>`,
    ),
  )
  return (
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Narsil: animaciones</title>` +
    `<style>body{margin:0;font-family:system-ui,sans-serif;background:#888}section{padding:12px 20px}h2{margin:4px 0 8px;font-size:18px}` +
    `.row{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;text-align:center}figcaption{font-size:13px;opacity:.7}</style></head>` +
    `<body>${sections.join('')}</body></html>`
  )
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (url.pathname !== '/') {
    res.writeHead(404).end()
    return
  }
  const asked = (url.searchParams.get('etapas') ?? '1').split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 5)
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(asked.length > 0 ? asked : [1]))
}).listen(PORT, '127.0.0.1', () => console.log(`Narsil preview on http://localhost:${PORT}/`))
