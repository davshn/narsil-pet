# Voice wake on macOS: say "Narsil" to dictate, and the spoken answer

Objective: bring saying "Narsil" (dictate, send after a silence, spoken summary, dictation reopened) to macOS, reusing the hub, ear.cjs and the summary; only the listener and the speech script are new.
Branch: `feat/voice-mac` · Delivery: ask-on-risk · Tests: `claude plugin test .`, `node tests/overlay-server.check.cjs`, `node tests/ear.check.cjs`, `node tests/listener.check.cjs`. The Swift listener cannot be built or run here (Windows): it stays untested until the user runs it on a Mac.

## Specs

- **S1 Mac listener.** "Sí, prepáralo para Mac." / "implementalo como consideres y lo pruebo yo luego": on macOS the hub starts a listener that does what listen.ps1 does on Windows: it hears "Narsil", tells talking from silence, knows whether Claude is in front, and presses the keys the hub answers. It speaks the same tick protocol (`voice`, `heard`, `claude`).
- **S2 The dictation shortcut.** Which keys open Claude's dictation on macOS is not known (Ctrl+D on Windows, per the user; Anthropic's help names Caps Lock for the desktop app's voice shortcut). The key the hub sends as `ctrl+d` is pressed as `NARSIL_DICTATE_KEY` (default `ctrl+d`), for example `cmd+d`. Caps Lock cannot be pressed this way (a modifier needs a flagsChanged event). Assumption: Ctrl+D until tested.
- **S3 The command.** `/narsil escucha on|off` works on macOS too, and says which permissions macOS will ask for. Elsewhere it says it works on Windows and macOS only.
- **S4 Spoken answer.** speak.sh, given `NARSIL_FOLLOW`, `NARSIL_PORT` and `NARSIL_TOKEN`, tells the hub (`POST /ear/follow`) once `say` has finished, as speak.ps1 does.
- **S5 Marked experimental.** The README says the Mac ear is untested until someone runs it.

## Tasks

- [x] T1 S1: the hub picks the listener for the system (`overlay/listener.cjs`), with checks. Route: inline.
- [x] T2 S3: `/narsil escucha` on macOS, with tests. Route: inline.
- [x] T3 S4: speak.sh tells the hub, with a smoke run in Git Bash. Route: inline.
- [x] T4 S1 S2: `overlay/listen-mac.swift` and `overlay/listen-mac.sh` (build once, then run). Route: inline; not runnable here.
- [x] T5 S5: README and release. Route: inline.

## Log

- **L1 (2026-11-26, user):** "¿Todo lo que hicimos funcionará en Mac?" → "Sí, prepáralo para Mac." → (asked whether a Mac is at hand) "No lo tengo aquí, pero podría conseguirlo. O sea, si quieres, por ahora implementalo como consideres y lo pruebo yo luego."
- **L2:** the Mac shortcut is uncertain. Anthropic's help says the desktop app's voice shortcut is Caps Lock or off. An open issue says the main chat window's microphone has no shortcut. Hence S2's setting.
- **L3 (T1–T5):**
  - **T1:** `overlay/listener.cjs` picks the listener. RED: the new `tests/listener.check.cjs` could not load it. GREEN: 4 passed. The hub uses it, and overlay-server.check still passes 9.
  - **T2:** `/narsil escucha` on macOS turns the ear on and names Micrófono, Reconocimiento de voz and Accesibilidad. Linux says "solo funciona en Windows y macOS". RED: 2 mod tests failed. GREEN: `claude plugin test .` 152 pass, 1 pre-existing fail. That includes a macOS spoken-answer test, which passed at once because the path already existed; it stays as a pin.
  - **T3:** speak.sh runs `say` and then posts `/ear/follow`. Smoke in Git Bash with a fake `say`: one POST with the token when following, none without.
  - **T4:** listen-mac.swift, listen-mac.sh and listen-mac.plist. `sh -n` passes. Without a compiler the launcher exits 3 and traces "no Swift compiler". The Swift itself was not compiled or run (no toolchain here); an independent read-only review was asked for.
  - **T5:** README marks macOS experimental. Release 4.5.0.
- **L4:** the independent review of listen-mac.swift found no certain compile error. Applied:
  - `kAXTrustedCheckOptionPrompt` is spelled out as "AXTrustedCheckOptionPrompt", because SDKs may import it differently.
  - Benign or slow recognizer errors (203, 216, 301, 1110, or a phrase past 5 s) no longer count toward the 11 that exit.
  - Only a 200 counts as a tick, so a 403 or 404 is a miss.
  - The permission waits time out after 60 s.
  - One pending restart per phrase.
  - "capslock" is dropped.
  - Open risks for the Mac test: whose permissions TCC asks for (likely Claude.app); a stale frontmost app in a CLI; server-side recognition limits when the language has no on-device model.
