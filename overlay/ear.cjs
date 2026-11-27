// Narsil's ear: what to press when the listener (listen.ps1) hears "Narsil",
// and when a silence ends what you dictated. Pure: the hub feeds it one sample
// a tick, and presses nothing itself.
//   idle       waits for "Narsil" with Claude in front: Ctrl+D starts dictation
//   dictating  you talk; a silence after you spoke, nothing said, or the
//              maximum reached: Ctrl+D stops it (only the silence sends)
//   settling   waits for the text to land, then Enter, if Claude is in front
// Once a message is sent by voice, and while you stay in Claude, follow()
// (Narsil has said the answer aloud) opens the dictation again by itself on
// the next tick, so you can answer without saying "Narsil".
'use strict'

const DEFAULTS = {
  // the silence after you spoke that ends the message
  silenceMs: 2000,
  // how long to wait for you to start before giving up
  startMs: 5000,
  // the longest dictation; past it, stopped without sending
  maxMs: 120_000,
  // the wait between stopping the dictation and Enter, for the text to land
  settleMs: 1000,
}

function createEar(options = {}) {
  const { now, ...rest } = options
  const o = { ...DEFAULTS, ...rest }
  const clock = now || Date.now
  let state = 'idle'
  let startedAt = 0
  let lastVoiceAt = 0
  let hasSpoken = false
  let stoppedAt = 0
  let shouldSend = false
  // A message went by voice and you have not left Claude since.
  let canFollow = false
  // The answer was said: the next tick with Claude in front opens dictation.
  let isFollowPending = false

  function start(at) {
    state = 'dictating'
    startedAt = at
    lastVoiceAt = at
    hasSpoken = false
    return ['ctrl+d']
  }

  function stop(isSent) {
    state = 'settling'
    stoppedAt = clock()
    shouldSend = isSent
    return ['ctrl+d']
  }

  // One sample: whether you talked since the last (the listener judges it
  // against its mic's own noise), whether "Narsil" was heard, whether a Claude
  // window is in front. Returns the keys to press, in order.
  function tick({ isVoice = false, isHeard = false, isClaude = false } = {}) {
    const at = clock()
    if (state === 'idle') {
      if (!isClaude) {
        canFollow = false
        isFollowPending = false
        return []
      }
      if (isFollowPending) {
        isFollowPending = false
        canFollow = false
        return start(at)
      }
      if (!isHeard) return []
      canFollow = false
      return start(at)
    }
    if (state === 'dictating') {
      // Gone from Claude: a key now would land in another app.
      if (!isClaude) {
        state = 'idle'
        return []
      }
      if (isVoice) {
        hasSpoken = true
        lastVoiceAt = at
      }
      if (at - startedAt >= o.maxMs) return stop(false)
      if (hasSpoken && at - lastVoiceAt >= o.silenceMs) return stop(true)
      if (!hasSpoken && at - startedAt >= o.startMs) return stop(false)
      return []
    }
    // settling
    if (at - stoppedAt < o.settleMs) return []
    state = 'idle'
    const isSent = shouldSend && isClaude
    canFollow = isSent
    return isSent ? ['enter'] : []
  }

  // Narsil has said the answer to a message sent by voice: whether the
  // dictation will open again by itself.
  function follow() {
    if (!canFollow || state !== 'idle') return false
    isFollowPending = true
    return true
  }

  function reset() {
    state = 'idle'
    canFollow = false
    isFollowPending = false
  }

  return { tick, follow, reset, state: () => state }
}

module.exports = { createEar, DEFAULTS }
