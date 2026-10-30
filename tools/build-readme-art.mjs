// Draws every mood of Narsil's, in the light and the dark theme, as animated
// SVGs for the README: assets/readme/<mood>-<claro|oscuro>.svg. Each is the
// same picture the band shows (hooks/sprite.ts), with its theme fixed instead
// of following the viewer's system, on a card of that theme.
//   node tools/build-readme-art.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
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

const MOODS = ['greeting', 'idle', 'thinking', 'talking', 'reading', 'searching', 'writing', 'running', 'asking', 'scared', 'celebrating', 'failed']
const CARD = { claro: '#F7F6FB', oscuro: '#16182A' }
const DARK = /@media \(prefers-color-scheme: dark\)\{((?:[^{}]|\{[^{}]*\})*)\}/g

function fixed(svg, theme) {
  const styled = svg.replace(DARK, (_, rules) => (theme === 'oscuro' ? rules : ''))
  const card = `<rect x="0" y="-14" width="150" height="134" rx="14" fill="${CARD[theme]}"/>`
  return styled.replace('</style>', `</style>${card}`)
}

const out = join(root, 'assets', 'readme')
mkdirSync(out, { recursive: true })
for (const mood of MOODS) {
  for (const theme of ['claro', 'oscuro']) writeFileSync(join(out, `${mood}-${theme}.svg`), fixed(sprite(mood), theme))
}
console.log(`${MOODS.length * 2} SVGs in assets/readme`)
