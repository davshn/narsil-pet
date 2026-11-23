# Equipped stages: Narsil stays a baby and gains gadgets

Objective: stages 2-5 stop showing a grown Narsil; each keeps the hatchling's body and adds the tech gadgets of the concept sheets (`docs/concepts/`).
Branch: `feat/equipped-stages` · Delivery: ask-on-risk · Tests: `claude plugin test .`, `claude plugin validate .`.

## Specs

- **S1 Baby with gadgets.** "en lugar de que narsil cresca que se vaya viendo mas equipada ... siempre siendo bebe pero cada vez con mas gatgets". Gadgets per stage, as in `docs/concepts/narsil-equipada-etapas*.png`: 2 goggles + headset; 3 + backpack with screen and tool belt; 4 + jetpack, holographic visor, fin armor; 5 + mech armor, cape, two drones, holographic keyboard.
- **S2 Both themes.** "me gusta, pero falta el modo oscuro".
- **S3 Every pose of every stage.** "tienes razon, genera todas las poses de todas las etapas": base, hola, trabajando, necesita, terminado, error, parada at stages 2-5, light and dark (56 pictures) in `assets/raw/etapa<N>/`, built with `tools/build-art.ps1`. Stage 1 stays as it is (no gadgets).

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1-S3 | inline | done | stage 2 (0daf159) |
| T2 | S1-S3 | inline | done | stage 3 (10827d1, edge trim f705b2e) |
| T3 | S1-S3 | inline | done | stage 4 (34d6b82) |
| T4 | S1-S3 | inline | done | stage 5 light (c1b38b0), dark (see L7) |
| T5 | S3 | inline | done | build-art no longer deletes hooks/art/animated.ts; tests 137/138 |
| T6 | S1-S3 | inline | partial | loops: stages 3-5 done, stage 2 only dark hola (Flow credits) |

## Log

- **L1** (2026-11-22) Original request: "estoy pensando en cambiar todas las imagenes de narsil para los niveles mas grandes, en lugar de que narsil cresca que se vaya viendo mas equipada, usa gemini en mi navegador para las imagenes de concepto de esto de como se veria narsil en los diferentes niveles, siempre siendo bebe pero cada vez con mas gatgets"
- **L2** Method: each picture is made in Gemini from the stage 1 picture of that pose and theme (keeps pose and expression) plus that stage's crop of the concept sheet (gadgets); captured from Gemini's full-size view. The animated loops (`assets/anim`, `assets/anim-hq`) still show the grown stages: they are made from these pictures, so they come after (Flow credits).
- **L3** Each stage is drawn from the previous stage's picture of that pose (keeps the gadgets consistent) plus that stage's concept crop. Gemini's output keeps the input's size (353x814 after stage 2); the picture is captured from Gemini's full-size view. Stage 3 captures carried 2 dark pixels of the viewer's edge, which stopped the cutout (pictures 65 px wide): trimmed 4 px (f705b2e) and the capture region narrowed after.
- **L4** Gemini refused the dark `error` pose twice ("interests of third-party content providers"); stage 3 passed when the prompt called her "my own original mascot"; stage 4 dark `error` is the stage 4 light `error` recolored to the dark palette, so its pose follows the light one.
- **L5** `tools/build-art.ps1` deleted every `hooks/art/*.ts`, `animated.ts` (from `build-animated.ps1`) too, so the test file did not load: it now deletes only `etapa*-*.ts`; `animated.ts` restored. Tests 137/138, the failure the pre-existing "bypass permissions" one.
- **L6** (2026-11-22 11:01) Gemini's image limit reached; resets 13:54. Pending: stage 5 dark (7 pictures). The animated loops of stages 2-5 still show the grown Narsil until they are made again from these pictures.
- **L7** (2026-11-22 20:10) Stage 5 dark made after the limit reset: all 7 poses from stage 4 dark plus `concepto-etapa5-oscuro`. `terminado` was refused once ("third-party content providers") and passed on Try again; `error` passed first time. `parada` asked for the suit lights and keyboard off. Built widths 96-105 px; tests 137/138 (same pre-existing failure). All 56 pictures done; the animated loops of stages 2-5 remain.
- **L8** (2026-11-22 23:20) User: "hazlo hasta que agotes los tokens que me quedan en flow (se renuevan pronto) arranca con la etapa en la que estoy y la siguiente a la que llegare". Their XP is 37049 (level 27, stage 4; stage 5 at level 35). Flow project "Nov 22 - 22:54" (Frames, 9:16, Omni 1.2 Flash, 360p, 3 s, 3 credits each): stages 4 and 5 both themes (24) and stage 3 (12) generated, plus stage 2 dark trabajando; 5 credits left. Only the first download landed: Chrome blocks the site's further automatic downloads until the user allows them. 
- **L9** (2026-11-23) After the user allowed the site's automatic downloads, the 37 videos were downloaded and matched to their sources by first frame (one each, no gaps) and encoded with `tools/encode-anim.ps1 -Seconds 3 -Fade 0`: stages 3, 4 and 5 all poses both themes, stage 2 dark `hola` (32-38 KB each). Stage 2's other 11 loops still show the grown Narsil (Flow credits ran out; 5 left). Tests 137/138 (same pre-existing failure), validate passes.
