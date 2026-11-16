# Animated poses: Narsil really moves

Objective: every pose Narsil shows becomes a short animated loop (Veo video → keyed animated WebP), in the band and the floating window.
Branch: `feat/animated-poses` · Delivery: ask-on-risk · Tests: `claude plugin test .`, `claude plugin validate .`, `node tests/overlay-drawing.check.cjs`.

## Specs

- **S1 Real motion.** "quiero cambiar las imagenes de narsil, por unas realmente animadas, donde tenga movimiento la serpiente". Videos come from the person's Gemini (Veo) subscription.
- **S2 Silent.** "dile que no necesitas sonido, la oido sonar y chapoteando el agua y no es necesario". Prompts ask for no audio; the encoder drops any audio track.
- **S3 Original color, in the chat band.** "me gustaria que tuviera el color original, y sobretodo que se viera en la banda de chat". The band's `Svg` takes at most 131072 characters (host contract, `SvgProps.source`), both themes included.
- **S4 Pose fidelity.** "la version idle que es la dormida parpadea, lo que es curioso": each loop is generated from its own pose's picture and keeps that pose (the sleeping one keeps her eyes closed).
- **S5 Quality within the limit.** "no podemos directamente generarla con menos tamano para ahorrar limite? se ve algomas delgado y algo pixelado". Veo's output size does not change the cost; subtle motion and the encoder settings do. Assumption: about 38 KB of WebP per loop, so both themes fit the band at once.
- **S6 All of them.** "si me agrada, vamos a cambiar todos": the poses shown (hola, trabajando, necesita, parada, terminado, error; `base` is only a fallback) at every stage 1-5, light and dark: 60 loops.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1 S2 S3 | inline | done | stage 4 trabajando-oscuro loop + sprite support (see L3) |
| T2 | S2 S3 S5 S6 | inline | in progress | tooling: sources, prompts, encoder, split module, two-theme budget |
| T3 | S4 S6 | inline | waiting on videos | stage 4, dark: hola, necesita, parada, terminado, error |
| T4 | S4 S6 | inline | waiting on videos | stage 4, light: all six |
| T5 | S4 S6 | inline | waiting on videos | stages 5, 3, 2, 1, both themes |

## Log

- **L1** (2026-11-15) Original request: "quiero cambiar las imagenes de narsil, por unas realmente animadas, donde tenga movimiento la serpiente, esto es posible? podriamos usar mi suscripcion de gemini plis para generar las animaciones, estoi haria que el mod consumiera demasiados recursos?"
- **L2** Findings: Veo outputs 720x1280 24 fps with an AAC track; a green (#00FF00) padded source image gives a clean key. The module loader refuses files over 1 MiB. `despill` turned her lilac: dropped; a 1 px alpha erosion removes the green fringe. A soft (blurred) alpha costs ~45 KB, too much.
- **L3** Stage 4 `trabajando-oscuro`: 3 s, 6 fps, 128 px, q35, binary alpha → 41.8 KB; the stage 1 loop made from the awake `base` pose was removed (S4). Tests 136/137, the one failure pre-existing.
- **L4** (2026-11-15) "si me agrada, vamos a cambiar todos". Video quota is the bottleneck (it ran out after two videos); the person launches the videos.
