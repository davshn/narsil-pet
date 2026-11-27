// Narsil's listener (macOS), built and started by listen-mac.sh while the ear
// is on. The macOS counterpart of listen.ps1: it listens to the default
// microphone with macOS's own speech recognizer (on the device when the
// language allows it) for the one word "Narsil", in Spanish when macOS has it.
// Every 200 ms it tells the hub whether you were talking since the last tick,
// whether it heard "Narsil" and whether Claude is in front, and presses the
// keys the hub answers, only while Claude is in front. It exits when the hub
// answers "quit" or stops answering.
//   NARSIL_PORT, NARSIL_TOKEN  the hub's port and token (set by the hub)
//   NARSIL_LOG                 optional: a file to trace what it hears and presses
//   NARSIL_LANG                optional: the recognition language (es-MX, es-ES...)
//   NARSIL_DICTATE_KEY         optional: the keys that start and stop Claude's
//                              dictation, pressed for the hub's "ctrl+d"
//                              (ctrl+d by default; cmd+d, ctrl+shift+d...;
//                              not Caps Lock, which macOS does not take as a
//                              pressed key)
// Exits 3 without a recognizer or without permission to use it, 4 when the
// microphone cannot be read.
// Permissions: macOS asks for the microphone and speech recognition; pressing
// keys needs Accessibility (System Settings → Privacy & Security).

import AVFoundation
import AppKit
import ApplicationServices
import Foundation
import Speech

let env = ProcessInfo.processInfo.environment
let port = env["NARSIL_PORT"] ?? "47190"
let token = env["NARSIL_TOKEN"] ?? ""
let dictateKey = env["NARSIL_DICTATE_KEY"] ?? "ctrl+d"

let clockFormat: DateFormatter = {
  let format = DateFormatter()
  format.dateFormat = "HH:mm:ss.SSS"
  return format
}()

func trace(_ text: String) {
  guard let path = env["NARSIL_LOG"], let line = "\(clockFormat.string(from: Date())) \(text)\n".data(using: .utf8) else { return }
  if let file = FileHandle(forWritingAtPath: path) {
    file.seekToEndOfFile()
    file.write(line)
    file.closeFile()
  } else {
    FileManager.default.createFile(atPath: path, contents: line)
  }
}

// MARK: - What the tick reports, shared with the audio thread

let lock = NSLock()
var voice = false
var heard = false
// The mic's own noise, in full-scale units: talking is a peak well above it, so
// quiet mics count as talking too (as in listen.ps1).
var noiseFloor: Float = 300.0 / 32768.0
let minVoicePeak: Float = 250.0 / 32768.0
let floorTimes: Float = 3.0

func hear(_ buffer: AVAudioPCMBuffer) {
  guard let channel = buffer.floatChannelData?[0] else { return }
  var peak: Float = 0
  for i in 0..<Int(buffer.frameLength) {
    let sample = abs(channel[i])
    if sample > peak { peak = sample }
  }
  lock.lock()
  if peak >= max(minVoicePeak, noiseFloor * floorTimes) { voice = true }
  // Falls fast to quieter blocks, rises slowly with louder ones.
  noiseFloor = peak < noiseFloor ? noiseFloor * 0.9 + peak * 0.1 : noiseFloor + (peak - noiseFloor) * 0.001
  lock.unlock()
}

func takeVoice() -> Bool {
  lock.lock()
  defer { lock.unlock() }
  let was = voice
  voice = false
  return was
}

func takeHeard() -> Bool {
  lock.lock()
  defer { lock.unlock() }
  let was = heard
  heard = false
  return was
}

// MARK: - Permissions

// A permission's answer, waited for at most a minute (a prompt that cannot be
// shown never answers): false without one.
func waitFor(_ ask: (@escaping (Bool) -> Void) -> Void) -> Bool {
  let done = DispatchSemaphore(value: 0)
  var isGranted = false
  ask { granted in
    isGranted = granted
    done.signal()
  }
  return done.wait(timeout: .now() + 60) == .success && isGranted
}

let isSpeechAllowed = waitFor { reply in SFSpeechRecognizer.requestAuthorization { reply($0 == .authorized) } }
if !isSpeechAllowed {
  trace("speech recognition not allowed (System Settings → Privacy & Security → Speech Recognition)")
  exit(3)
}
let isMicAllowed = waitFor { reply in AVCaptureDevice.requestAccess(for: .audio) { reply($0) } }
if !isMicAllowed {
  trace("microphone not allowed (System Settings → Privacy & Security → Microphone)")
  exit(4)
}
// Asks for Accessibility at each start until it is granted; without it the
// keys do not land, but it still listens, so turning it on later works
// without a restart of the ear. The option's name spelled out, as SDKs import
// kAXTrustedCheckOptionPrompt differently.
if !AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary) {
  trace("no Accessibility permission yet: keys will not be pressed")
}

// MARK: - The recognizer

// The language asked for, else Spanish (Latin American first), else macOS's own.
func pickLocale() -> Locale? {
  let supported = SFSpeechRecognizer.supportedLocales().map { $0.identifier.replacingOccurrences(of: "_", with: "-") }
  if let wanted = env["NARSIL_LANG"]?.replacingOccurrences(of: "_", with: "-"), supported.contains(wanted) {
    return Locale(identifier: wanted)
  }
  for id in ["es-MX", "es-US", "es-CO", "es-CL", "es-419", "es-ES"] where supported.contains(id) {
    return Locale(identifier: id)
  }
  if let spanish = supported.first(where: { $0.hasPrefix("es") }) { return Locale(identifier: spanish) }
  return SFSpeechRecognizer()?.locale
}

guard let locale = pickLocale(), let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
  trace("no speech recognizer available")
  exit(3)
}

// How a recognizer may write "Narsil" back, with accents and case folded.
let wake = try! NSRegularExpression(pattern: "\\b(nar ?sil|nar ?cil|nar ?seal|marsil|narsi)\\b")

func isWake(_ text: String) -> Bool {
  let plain = text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: locale)
  return wake.firstMatch(in: plain, range: NSRange(plain.startIndex..., in: plain)) != nil
}

var request: SFSpeechAudioBufferRecognitionRequest?
var task: SFSpeechRecognitionTask?
var phraseStartedAt = Date()
var failures = 0
var isRestartPending = false
// Errors that only say the phrase ended: no speech in it, or it was cancelled.
let benignErrors: Set<Int> = [203, 216, 301, 1110]

// One phrase at a time: a match, an end, an error or a long phrase starts the
// next one, so a "Narsil" already acted on is not heard twice.
func startPhrase() {
  let next = SFSpeechAudioBufferRecognitionRequest()
  next.shouldReportPartialResults = true
  next.contextualStrings = ["Narsil"]
  if recognizer.supportsOnDeviceRecognition { next.requiresOnDeviceRecognition = true }
  lock.lock()
  request = next
  lock.unlock()
  phraseStartedAt = Date()
  task = recognizer.recognitionTask(with: next) { result, error in
    DispatchQueue.main.async { handle(result, error, next) }
  }
}

func restartPhrase() {
  isRestartPending = false
  task?.cancel()
  lock.lock()
  let current = request
  request = nil
  lock.unlock()
  current?.endAudio()
  startPhrase()
}

func handle(_ result: SFSpeechRecognitionResult?, _ error: Error?, _ from: SFSpeechAudioBufferRecognitionRequest) {
  lock.lock()
  let isCurrent = from === request
  lock.unlock()
  guard isCurrent else { return }
  if let result = result {
    failures = 0
    let text = result.bestTranscription.formattedString
    if isWake(text) {
      lock.lock()
      heard = true
      lock.unlock()
      trace("heard '\(text)'")
      restartPhrase()
      return
    }
    if result.isFinal { restartPhrase() }
    return
  }
  if let error = error {
    let code = (error as NSError).code
    // Only failures in quick succession count: a long quiet phrase that ends
    // in an error is the recognizer's own limit, not a broken one.
    if benignErrors.contains(code) || Date().timeIntervalSince(phraseStartedAt) > 5 {
      failures = 0
    } else {
      failures += 1
      trace("recognizer: \(error.localizedDescription) (\(code))")
      if failures > 10 { exit(3) }
    }
    // A short wait, so an error that repeats does not spin; once per phrase.
    if isRestartPending { return }
    isRestartPending = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { restartPhrase() }
  }
}

// MARK: - The microphone

let engine = AVAudioEngine()

func startAudio() -> Bool {
  let input = engine.inputNode
  input.removeTap(onBus: 0)
  let format = input.outputFormat(forBus: 0)
  guard format.sampleRate > 0, format.channelCount > 0 else { return false }
  input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
    lock.lock()
    let current = request
    lock.unlock()
    current?.append(buffer)
    hear(buffer)
  }
  engine.prepare()
  do {
    try engine.start()
    return true
  } catch {
    trace("microphone: \(error.localizedDescription)")
    return false
  }
}

if !startAudio() {
  trace("no microphone to read")
  exit(4)
}
// Another default mic (a headset plugged in or taken off): read the new one.
NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { _ in
  trace("microphone changed")
  engine.stop()
  if !startAudio() { exit(4) }
  restartPhrase()
}
startPhrase()
trace("listening (\(locale.identifier))")

// MARK: - Claude in front, and the keys

func isClaudeInFront() -> Bool {
  guard let app = NSWorkspace.shared.frontmostApplication else { return false }
  if let id = app.bundleIdentifier?.lowercased(), id.contains("claude") { return true }
  return app.localizedName == "Claude"
}

// macOS's virtual key codes, by name.
let keyCodes: [String: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
  "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26,
  "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
  "return": 36, "enter": 36, "tab": 48, "space": 49, "escape": 53, "f5": 96,
]

// Presses a combination such as "ctrl+d" or "cmd+shift+d".
func press(_ combo: String) {
  var flags: CGEventFlags = []
  var key: CGKeyCode?
  for part in combo.lowercased().split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces) }) {
    switch part {
    case "ctrl", "control": flags.insert(.maskControl)
    case "cmd", "command": flags.insert(.maskCommand)
    case "alt", "option", "opt": flags.insert(.maskAlternate)
    case "shift": flags.insert(.maskShift)
    default: key = keyCodes[part]
    }
  }
  guard let code = key else {
    trace("unknown key: \(combo)")
    return
  }
  let source = CGEventSource(stateID: .hidSystemState)
  for isDown in [true, false] {
    let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: isDown)
    event?.flags = flags
    event?.post(tap: .cghidEventTap)
  }
}

// MARK: - The tick

var misses = 0
var isTicking = false

func tick() {
  if isTicking { return }
  // A phrase lasts seconds: one running past 50 s has hung, or grown long.
  if Date().timeIntervalSince(phraseStartedAt) > 50 { restartPhrase() }
  isTicking = true
  let isVoice = takeVoice()
  let isHeard = takeHeard()
  let isClaude = isClaudeInFront()
  guard let url = URL(string: "http://127.0.0.1:\(port)/ear/tick?voice=\(isVoice ? 1 : 0)&heard=\(isHeard ? 1 : 0)&claude=\(isClaude ? 1 : 0)") else { exit(0) }
  var ask = URLRequest(url: url)
  ask.setValue(token, forHTTPHeaderField: "x-narsil-token")
  ask.timeoutInterval = 2
  URLSession.shared.dataTask(with: ask) { data, response, error in
    DispatchQueue.main.async {
      isTicking = false
      // Only the hub's 200 is an answer: a 403 (another token) or a 404 is a miss.
      let status = (response as? HTTPURLResponse)?.statusCode
      guard error == nil, status == 200, let data = data, let answer = String(data: data, encoding: .utf8) else {
        misses += 1
        if misses >= 5 { exit(0) }
        // Not lost: the next tick tells it.
        if isHeard {
          lock.lock()
          heard = true
          lock.unlock()
        }
        return
      }
      misses = 0
      let keys = answer.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
      if isHeard && keys.isEmpty { trace("heard, nothing to press (claude=\(isClaude ? 1 : 0))") }
      for key in keys {
        trace("voice=\(isVoice ? 1 : 0) claude=\(isClaude ? 1 : 0) -> \(key)")
        if key == "quit" { exit(0) }
        // Only into Claude: the app in front may have changed since the tick.
        guard isClaudeInFront() else { continue }
        if key == "ctrl+d" { press(dictateKey) } else if key == "enter" { press("return") }
      }
    }
  }.resume()
}

Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in tick() }
RunLoop.main.run()
