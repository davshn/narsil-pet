// Checks Narsil's ear (overlay/ear.cjs): when hearing "Narsil" starts Claude's
// dictation, when a silence stops and sends it, and when nothing is pressed.
//   node tests/ear.check.cjs
'use strict'

const assert = require('assert')
const path = require('path')
const { createEar } = require(path.join(__dirname, '..', 'overlay', 'ear.cjs'))

// An ear with a clock of its own, ticked every 200 ms like the listener.
function setup(options = {}) {
  let now = 0
  const ear = createEar({ now: () => now, ...options })
  const tick = (sample = {}) => ear.tick({ isVoice: false, isHeard: false, isClaude: true, ...sample })
  const pass = (ms, sample) => {
    const pressed = []
    for (let t = 0; t < ms; t += 200) {
      now += 200
      pressed.push(...tick(sample))
    }
    return pressed
  }
  return { ear, tick, pass, at: () => now }
}

const checks = []
const check = (name, run) => checks.push({ name, run })

check('"Narsil" with Claude in front starts the dictation', () => {
  const { tick, ear } = setup()
  assert.deepEqual(tick({ isHeard: true }), ['ctrl+d'])
  assert.equal(ear.state(), 'dictating')
})

check('"Narsil" with another app in front presses nothing', () => {
  const { tick, ear } = setup()
  assert.deepEqual(tick({ isHeard: true, isClaude: false }), [])
  assert.equal(ear.state(), 'idle')
})

check('after you spoke, about 2 s of silence stops the dictation, and Enter follows once the text lands', () => {
  const { tick, pass, ear } = setup()
  tick({ isHeard: true })
  assert.deepEqual(pass(3000, { isVoice: true }), [], 'nothing while you talk')
  assert.deepEqual(pass(1800), [], 'a short pause is not the end')
  assert.deepEqual(pass(400), ['ctrl+d'], 'the silence stops it')
  assert.equal(ear.state(), 'settling')
  assert.deepEqual(pass(1200), ['enter'], 'then the message is sent')
  assert.equal(ear.state(), 'idle')
})

check('"Narsil" said while dictating is not acted on', () => {
  const { tick, pass } = setup()
  tick({ isHeard: true })
  assert.deepEqual(pass(1000, { isVoice: true, isHeard: true }), [])
})

check('no Enter when the Claude window is no longer in front', () => {
  const { tick, pass, ear } = setup()
  tick({ isHeard: true })
  pass(1000, { isVoice: true })
  pass(2200)
  assert.equal(ear.state(), 'settling')
  assert.deepEqual(pass(1200, { isClaude: false }), [])
  assert.equal(ear.state(), 'idle')
})

check('leaving Claude while dictating presses nothing more', () => {
  const { tick, pass, ear } = setup()
  tick({ isHeard: true })
  pass(1000, { isVoice: true })
  assert.deepEqual(pass(3000, { isClaude: false }), [])
  assert.equal(ear.state(), 'idle')
})

check('when nothing is said, the dictation stops without sending', () => {
  const { tick, pass, ear } = setup()
  tick({ isHeard: true })
  const pressed = pass(8000)
  assert.deepEqual(pressed, ['ctrl+d'])
  assert.equal(ear.state(), 'idle')
})

check('a dictation past the maximum stops without sending', () => {
  const { tick, pass, ear } = setup({ maxMs: 10_000 })
  tick({ isHeard: true })
  assert.deepEqual(pass(12_000, { isVoice: true }), ['ctrl+d'])
  assert.equal(ear.state(), 'idle')
})

check('after a message is sent, "Narsil" starts a new one', () => {
  const { tick, pass } = setup()
  tick({ isHeard: true })
  pass(1000, { isVoice: true })
  pass(2200)
  pass(1200)
  assert.deepEqual(tick({ isHeard: true }), ['ctrl+d'])
})

// A message sent by voice, with Claude in front all along.
function sendByVoice(pass, tick) {
  tick({ isHeard: true })
  pass(1000, { isVoice: true })
  pass(2200)
  pass(1200)
}

check('when Narsil has said the answer to a message sent by voice, the dictation opens again by itself', () => {
  const { tick, pass, ear } = setup()
  sendByVoice(pass, tick)
  pass(30_000)
  assert.equal(ear.follow(), true)
  assert.deepEqual(tick(), ['ctrl+d'], 'the next tick opens it')
  assert.equal(ear.state(), 'dictating')
  // you answer, then a silence sends it, as after "Narsil"
  pass(1000, { isVoice: true })
  assert.deepEqual(pass(3600), ['ctrl+d', 'enter'])
})

check('an answer opened by itself and left unanswered closes without sending', () => {
  const { tick, pass, ear } = setup()
  sendByVoice(pass, tick)
  ear.follow()
  assert.deepEqual(tick(), ['ctrl+d'])
  assert.deepEqual(pass(8000), ['ctrl+d'], 'closed, and no Enter')
  assert.equal(ear.state(), 'idle')
})

check('with no message sent by voice, the answer opens nothing', () => {
  const { tick, ear } = setup()
  assert.equal(ear.follow(), false)
  assert.deepEqual(tick(), [])
  assert.equal(ear.state(), 'idle')
})

check('leaving Claude after the message was sent: the answer opens nothing', () => {
  const { tick, pass, ear } = setup()
  sendByVoice(pass, tick)
  pass(2000, { isClaude: false })
  pass(2000)
  assert.equal(ear.follow(), false)
  assert.deepEqual(tick(), [])
})

check('the dictation opens once per answer, and only with Claude in front', () => {
  const { tick, pass, ear } = setup()
  sendByVoice(pass, tick)
  assert.equal(ear.follow(), true)
  assert.deepEqual(tick({ isClaude: false }), [], 'another app in front at that moment')
  assert.equal(ear.follow(), false, 'and the chance is gone')
  assert.deepEqual(pass(2000), [])
})
check('turning the ear off forgets a dictation under way', () => {
  const { tick, ear } = setup()
  tick({ isHeard: true })
  ear.reset()
  assert.equal(ear.state(), 'idle')
})

let failed = 0
for (const { name, run } of checks) {
  try {
    run()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed++
    console.log(`FAIL ${name}\n     ${error.message}`)
  }
}
console.log(failed ? `${failed} of ${checks.length} failed` : `${checks.length} passed`)
process.exit(failed ? 1 : 0)
