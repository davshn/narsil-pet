# Voice wake: say "Narsil" to dictate and send

Objective: saying "Narsil" starts Claude's dictation (Ctrl+D) in the conversation in front; after a silence it stops dictation and sends the message.
Branch: `feat/voice-wake` · Delivery: ask-on-risk · Tests: `claude plugin test .` and `node tests/overlay-server.check.cjs`.

## Specs

- **S1 Wake word.** "quiero decir narsil y que se active": hearing "Narsil" while the Claude window is in front presses Ctrl+D ("el atajo en claude para activar la voz es control+D y de nuevo para detenerlo"). With another app in front, nothing is pressed.
- **S2 Silence sends.** "tras unos momentos de silencio se envie el mensaje": after about 2 s of silence once you spoke, Ctrl+D again, a short wait for the text to land, then Enter.
- **S3 Guards.** While dictating, "Narsil" is not acted on; no Enter if the Claude window is no longer in front; a dictation that runs past a maximum, or where nothing is said, is stopped without sending.
- **S4 One listener per computer.** The hub (overlay/server.cjs) starts the single listener (overlay/listen.ps1) and decides the keys; PowerShell only reports what it hears, the mic level and whether Claude is in front, and presses what the hub answers. Windows only.
- **S5 Opt-in.** Off by default; `/narsil escucha on|off` turns it on or off, kept in prefs (`isListening`). Elsewhere than Windows the command says it only works on Windows.
- **S6 Local.** Recognition is Windows' own (System.Speech), on this computer; no audio leaves it.

## Tasks

- [x] T1 S2 S3 S4: ear state machine (overlay/ear.cjs) and the hub's `/ear` routes, with checks. Route: inline (one understood change, no writer reason).
- [x] T2 S1 S4 S6: listener script overlay/listen.ps1. Route: inline.
- [x] T3 S5: `/narsil escucha`, prefs, hub start env, README. Route: inline.

## Log

- **L1 (2026-11-26, user):** "en narsil como lo harias? ya vi que el atajo en claude para activar la voz es control+D y de nuevo para denerlo, quiero decir narsil y que se active y que tras unos momentos de silencio se envie el mensaje" — then "Sí, impleméntalo" for the design proposed (hub-owned listener, silence detection, guards, opt-in command).
- **L2:** Only the en-US System.Speech recognizer is installed here; a one-word grammar "Narsil" should do. Unknowns for the live check: Ctrl+D sent by SendKeys, how long the text takes to land after stopping, sharing the mic with Claude's dictation, the silence level threshold.
- **L3 (T1-T3 done):** RED first: tests/ear.check.cjs could not load ear.cjs, 4 of 8 hub checks failed, 6 new mod tests failed. GREEN: `node tests/ear.check.cjs` 10 passed; `node tests/overlay-server.check.cjs` 8 passed; `claude plugin test .` 142 pass, 1 fail (the bypass-permissions test, failing before this work); `claude plugin validate .` passed. Smoke run: the hub with NARSIL_EAR=1 started listen.ps1, which logged "listening (en-US)", and quitting the hub left no listener running. Protocol `narsil 6`. Not verified: a real "Narsil" spoken, Ctrl+D and Enter landing in Claude, the voice level threshold (12) and the 1 s settle wait. Next: live check by the user, then tune.
- **L4 (2026-11-26, user):** "no reacciona cuando digo narsil". Cause: the mod still expected hub protocol `narsil 5` while the new hub answers `narsil 6`, so 4.1.0 took the old 4.0.0 hub (no `/ear`, no listener) for its own and never replaced it. Fix: `OVERLAY_PROTOCOL = 'narsil 6'`; the heartbeat now checks the hub's version every 30 s and replaces an older one that still takes the beats; only one hub start runs at a time. New guards: a mod test for the heartbeat replacement (RED before the fix) and a hub check that the mod's protocol equals `/ping` (fails with the old value). Evidence: `claude plugin test .` 143 pass, 1 pre-existing fail; ear.check 10 passed; overlay-server.check 9 passed. After quitting the old hub by hand, the 4.1.0 hub started with listen.ps1. Still not verified: a spoken "Narsil" landing in Claude.
