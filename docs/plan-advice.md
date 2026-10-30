# Plan: Narsil gives advice on what you are working on

Status: planned, not implemented. Implement in a new session.

## Goal

Narsil, the mod's sea-serpent mascot, occasionally offers a short, wise, concrete tip about the work
in progress: what Claude just did, the error it hit, the change it made. She sounds like an old sea
serpent with an ocean metaphor now and then, but every tip must be actionable and grounded in what
actually happened. No generic motivational fluff, no invented facts.

Example tips (Spanish, as shown to the person):

- "Has tocado `register.tsx` tres veces: una prueba que fije su comportamiento te ahorrará mareas."
- "El mismo error de `npm test` dos veces. Lee la primera línea roja; ahí suele estar la corriente."
- "Turno largo. Divide la tarea: las olas pequeñas se surfean mejor."

## How tips are generated

Two API paths exist (see `$.model` in the types):

| Path | Context | Cost / latency | Use |
| --- | --- | --- | --- |
| `$.model.complete({ model: 'haiku', ... })` | only what the mod sends | cheap, ~1 s | automatic tips (default) |
| `$.model.fork({ prompt })` | the session's real transcript, cached prefix | main model, pricier | on demand: `/narsil consejo profundo` |

Recommendation: automatic tips through `complete` with `haiku`; the transcript-aware `fork` only
when the person asks for it.

### Context the mod collects (for `complete`)

A small ring buffer in the hooks module (module variables are fine: losing it on reload is harmless):

- the person's last prompt (`prompt.submit`, `e.text`), first 400 characters;
- the last ~15 tool calls: tool name and `describeCall` detail (file basename, command first line);
- failed tool calls: tool and the first 200 characters of the error text (`result.text`);
- files touched this turn (Edit/Write), with counts;
- the turn's duration and final answer, first 400 characters (`turn.complete`, `e.answer`).

Sanitize before sending: drop anything that looks like a secret (`/(key|token|secret|password)\s*[:=]/i`,
long base64 or hex runs), cap the whole context at ~2,000 characters.

### Prompt

A fixed system prompt for Narsil's voice, Spanish output, one or two sentences, at most 160
characters, must reference something concrete from the context, may use one sea metaphor, must not
repeat the last 5 tips (pass them in), answers `SKIP` when there is nothing useful to say (then show
nothing). Use `effort: 'low'`, `maxTokens` ~120, `timeoutMs` ~8000.

## When tips appear (triggers)

| Trigger | Hook | Kind |
| --- | --- | --- |
| A turn finished | `turn.complete`, `reason === 'answer'` | review: what to check or do next |
| The same tool failed twice in a turn, or 3 failures | `tool.call` result `isError` | debugging wisdom |
| A turn has run for more than 3 minutes | `turn.step` or a check in `tool.call` | pacing / split the task |
| The person asks | `/narsil consejo` (complete) and `/narsil consejo profundo` (fork) | on demand |

Throttle: at most one automatic tip every 10 minutes (configurable) and 20 per day; never two in a
row for the same trigger kind; on-demand tips are not throttled. Tips never block or slow a turn:
run the model call with its timeout and show the tip when it arrives. Do not use `$.clock` timers for
it (a reload of the mod cancels them; see the voice fix in `turn.complete`).

## Where tips show

- **Band** (`ui.render` AbovePrompt): an extra line `💡 <tip>` under the headline, for 3 minutes or
  until the next tip; a small "×" Button dismisses it.
- **Floating window** (`overlay/server.cjs`, `overlay.html`): the tip travels in the session's
  `/state` payload (`tip` field); the page shows it as a speech bubble from Narsil. A tip alone does
  not pop the window up (only events do).
- **Voice**: off by default (`/narsil consejos voz` turns it on); when on, speak only tips from the
  "turn finished" trigger.
- **Terminal**: one dim line `💡 <tip>`.

## State and settings

- New atom `tip` in the `narsil-pet` contract (`types/index.d.ts`): `{ text: string; kind: string; at: number } | null`.
- Prefs (stored with the others under `prefs`): `isAdviceOn` (default true), `adviceEveryMinutes`
  (default 10), `isAdviceSpoken` (default false). Old stored prefs lack them: merge with defaults.
- Commands: `/narsil consejo`, `/narsil consejo profundo`, `/narsil consejos on|off`,
  `/narsil consejos cada <min>`, `/narsil consejos voz`. Update the command description and the
  usage text of `/narsil`.

## Files to touch

- `hooks/register.tsx`: context buffer, triggers, throttle, model calls, commands, band line.
- `hooks/advice.ts` (new): context building, sanitizing, prompt, parsing the reply (`SKIP`, length).
- `types/index.d.ts`: `tip` atom and new prefs fields.
- `overlay/server.cjs`, `overlay/overlay.html`: carry and draw the tip.
- `tests/narsil.test.tsx`: new tests (below).

## Tests (claude plugin test)

Mock `model.complete` / `model.fork` with `on('model.complete', ...)`.

1. A finished turn produces a tip that shows in the band, built from the turn's context (assert the
   prompt sent to the model contains the edited file's name).
2. `SKIP` or an empty reply shows nothing.
3. Throttle: a second finished turn within 10 minutes makes no model call (mock `clock.now`).
4. Two failures of the same tool trigger a debugging tip once.
5. `/narsil consejos off` stops automatic tips; `/narsil consejo` still answers.
6. `/narsil consejo profundo` uses `model.fork`.
7. Sanitizing: a context with `API_KEY=abc123` never reaches the model prompt.
8. A failed or timed-out model call shows nothing and does not throw.
9. Existing behavior unchanged: the current 11 tests keep passing.

## Risks and open points

- Cost: every automatic tip is a Haiku call; the throttle and daily cap bound it. `fork` uses the
  main model: on demand only.
- Privacy: the context goes to the same provider the session already uses; sanitize anyway.
- Tone: tune the prompt with real sessions; keep `SKIP` so silence beats a useless tip.
- The band grows by one line while a tip shows; keep it to one line (`wrap="truncate-end"`).
