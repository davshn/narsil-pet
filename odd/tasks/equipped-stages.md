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
| T1 | S1-S3 | inline | in progress | stage 2, light and dark |
| T2 | S1-S3 | inline | pending | stage 3, light and dark |
| T3 | S1-S3 | inline | pending | stage 4, light and dark |
| T4 | S1-S3 | inline | pending | stage 5, light and dark |
| T5 | S3 | inline | pending | build-art, tests |

## Log

- **L1** (2026-11-22) Original request: "estoy pensando en cambiar todas las imagenes de narsil para los niveles mas grandes, en lugar de que narsil cresca que se vaya viendo mas equipada, usa gemini en mi navegador para las imagenes de concepto de esto de como se veria narsil en los diferentes niveles, siempre siendo bebe pero cada vez con mas gatgets"
- **L2** Method: each picture is made in Gemini from the stage 1 picture of that pose and theme (keeps pose and expression) plus that stage's crop of the concept sheet (gadgets); captured from Gemini's full-size view. The animated loops (`assets/anim`, `assets/anim-hq`) still show the grown stages: they are made from these pictures, so they come after (Flow credits).
