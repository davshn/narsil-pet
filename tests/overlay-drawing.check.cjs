// How the floating window changes Narsil's drawing, run on the page's own
// script over a small stand-in for the browser, with a clock of its own.
//   node tests/overlay-drawing.check.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const page = process.argv[2] || path.join(__dirname, '..', 'overlay', 'overlay.html')
const script = /<script>([\s\S]*?)<\/script>/.exec(fs.readFileSync(page, 'utf8'))[1]

let now = 1000
let timers = []
const setTimeoutFake = (run, wait = 0) => {
  const timer = { at: now + wait, run }
  timers.push(timer)
  return timer
}
const settle = () => new Promise(resolve => setImmediate(resolve))
async function advance(ms) {
  const end = now + ms
  for (;;) {
    const next = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0]
    if (!next) break
    timers = timers.filter(t => t !== next)
    now = next.at
    next.run()
    await settle()
  }
  now = end
  await settle()
}

class Element {
  children = []
  style = {}
  classList = {
    add: name => this.classes.add(name),
    remove: name => this.classes.delete(name),
  }
  classes = new Set()
  parent = null
  addEventListener() {}
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
  }
  replaceChildren(...nodes) {
    this.children = []
    this.append(...nodes)
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this)
    this.parent = null
  }
  getBoundingClientRect() {
    return {}
  }
}

const blobs = []
const revoked = []
class FakeImage extends Element {
  decode() {
    return Promise.resolve()
  }
}
let source = null
const byId = new Map()
const context = vm.createContext({
  document: {
    getElementById: id => byId.get(id) ?? byId.set(id, new Element()).get(id),
    querySelector: () => ({ content: 'key' }),
    createElement: () => new Element(),
    addEventListener() {},
    visibilityState: 'visible',
  },
  Image: FakeImage,
  Blob: class {
    constructor([text]) {
      this.text = text
    }
  },
  URL: {
    createObjectURL: blob => {
      blobs.push(blob.text)
      return `blob:${blobs.length}`
    },
    revokeObjectURL: url => revoked.push(url),
  },
  EventSource: class {
    constructor() {
      source = this
    }
  },
  performance: { now: () => now },
  setTimeout: setTimeoutFake,
  setInterval() {},
  requestAnimationFrame: run => run(),
  addEventListener() {},
  fetch: () => Promise.resolve(),
  screenX: 0,
  screenY: 0,
  outerWidth: 300,
  outerHeight: 400,
})
vm.runInContext(script, context)

const send = svg => source.onmessage({ data: JSON.stringify({ sessions: [{ sessionId: 's', status: 'working', title: 't', headline: 'h', svg }], event: null }) })
const box = context.document.getElementById('sprite')
const shown = () => box.children.filter(c => c.classes.has('shown')).length

async function main() {
  send('<svg>A</svg>')
  await settle()
  assert.deepEqual(blobs, ['<svg>A</svg>'], 'the first drawing shows at once')
  assert.equal(box.children.length, 1)
  assert.equal(shown(), 1)
  assert.deepEqual(revoked, ['blob:1'], 'its URL is let go once it is painted')

  await advance(900)
  send('<svg>B</svg>')
  await settle()
  assert.equal(blobs.length, 2, 'past its moment, the next drawing comes at once')
  assert.equal(box.children.length, 2, 'both show while one fades into the next')
  assert.equal(shown(), 1, 'the old one is already fading')
  await advance(200)
  assert.equal(box.children.length, 1, 'the old one leaves when its fade is over')

  await advance(100)
  send('<svg>C</svg>')
  await advance(100)
  send('<svg>D</svg>')
  await settle()
  assert.equal(blobs.length, 2, 'a drawing inside the moment of the last one waits')
  await advance(400)
  assert.deepEqual(blobs.slice(2), ['<svg>D</svg>'], 'only the latest asked for is drawn')

  send('<svg>D</svg>')
  await advance(1000)
  assert.equal(blobs.length, 3, 'the same drawing again changes nothing, so her animation runs on')

  send('<svg>E</svg>')
  await settle()
  assert.equal(blobs.length, 4)
  send('<svg>F</svg>')
  await advance(100)
  send('<svg>E</svg>')
  await advance(1000)
  assert.equal(blobs.length, 4, 'back to the drawing on show before its turn: no redraw')

  send('')
  await settle()
  assert.equal(box.children.length, 0, 'no drawing at all leaves the place empty')

  console.log('overlay drawing: ok')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
