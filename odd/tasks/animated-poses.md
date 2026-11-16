# Animated poses: Narsil really moves

Objective: every pose Narsil shows becomes a short animated loop (Veo video → keyed animated WebP), in the band and the floating window.
Branch: `feat/animated-poses` · Delivery: ask-on-risk · Tests: `claude plugin test .`, `claude plugin validate .`, `node tests/overlay-drawing.check.cjs`.

## Specs

- **S1 Real motion.** "quiero cambiar las imagenes de narsil, por unas realmente animadas, donde tenga movimiento la serpiente". Videos come from the person's Gemini (Veo) subscription.
- **S2 Silent.** "dile que no necesitas sonido, la oido sonar y chapoteando el agua y no es necesario". Prompts ask for no audio; the encoder drops any audio track.
- **S3 Original color, in the chat band.** "me gustaria que tuviera el color original, y sobretodo que se viera en la banda de chat". The band's `Svg` takes at most 131072 characters (host contract, `SvgProps.source`), both themes included.
- **S4 Pose fidelity.** "la version idle que es la dormida parpadea, lo que es curioso": each loop is generated from its own pose's picture and keeps that pose (the sleeping one keeps her eyes closed).
- **S5 Quality within the limit.** "no podemos directamente generarla con menos tamano para ahorrar limite? se ve algomas delgado y algo pixelado". Veo's output size does not change the cost; subtle motion and the encoder settings do. Assumption: about 38 KB of WebP per loop, so both themes fit the band at once.
- **S7 Sharper in the floating window.** "en ventana externa podemos poner el video sin recortar? para que se vea mas nitido?" The window has no 131072 limit: it swaps each loop for a sharp copy (200 px, 12 fps, q75, soft edge) the local server serves; the mod's own modules carry only the small loops.
- **S6 All of them.** "si me agrada, vamos a cambiar todos": the poses shown (hola, trabajando, necesita, parada, terminado, error; `base` is only a fallback) at every stage 1-5, light and dark: 60 loops.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1 S2 S3 | inline | done | stage 4 trabajando-oscuro loop + sprite support (see L3) |
| T2 | S2 S3 S5 S6 | inline | done | tooling: sources, prompts, encoder, split module, two-theme budget (see L5) |
| T3 | S4 S6 | inline | in progress: hola done (8f0bfc7); necesita, parada, terminado, error waiting on quota | stage 4, dark |
| T4 | S4 S6 | inline | waiting on videos | stage 4, light: all six |
| T5 | S4 S6 | inline | waiting on videos | stages 5, 3, 2, 1, both themes |
| T6 | S7 | inline | done | sharper loops in the floating window (see L7) |

## Log

- **L1** (2026-11-15) Original request: "quiero cambiar las imagenes de narsil, por unas realmente animadas, donde tenga movimiento la serpiente, esto es posible? podriamos usar mi suscripcion de gemini plis para generar las animaciones, estoi haria que el mod consumiera demasiados recursos?"
- **L2** Findings: Veo outputs 720x1280 24 fps with an AAC track; a green (#00FF00) padded source image gives a clean key. The module loader refuses files over 1 MiB. `despill` turned her lilac: dropped; a 1 px alpha erosion removes the green fringe. A soft (blurred) alpha costs ~45 KB, too much.
- **L3** Stage 4 `trabajando-oscuro`: 3 s, 6 fps, 128 px, q35, binary alpha → 41.8 KB; the stage 1 loop made from the awake `base` pose was removed (S4). Tests 136/137, the one failure pre-existing.
- **L4** (2026-11-15) "si me agrada, vamos a cambiar todos". Video quota is the bottleneck (it ran out after two videos); the person launches the videos.
- **L5** T2: `tools/anim-sources.ps1` writes the green source and its prompt for each missing loop to `~/Downloads/narsil-anim/etapa<N>/<pose>-<theme>.png|.txt` (59 made); holes are filled only when pure white, since the light theme's face is near-white with a tint. `tools/encode-anim.ps1 -Video -Stage -Pose -Theme` crops to her, keys, and searches the best quality within 38 KB (stage 4 trabajando: q30, 37.8 KB, 21 s); `tools/build-animated.ps1` writes one module per stage and theme and refuses a loop over 40 KB; a test proves two 40 KB loops fit the band at every stage and celebration. Tests 137/138, the failure pre-existing.
- **L6** (2026-11-15) "en ventana externa podemos poner el video sin recortar? para que se vea mas nitido?" Approved: "Sí, hazla".
- **L7** T6: the window draws her at 120x107 CSS px (some 93 px tall), smaller than the band, so the sharp copy is 200 px (stage 4 trabajando: 405 KB; 60 loops ≈ 24 MB in the repo). `encode-anim.ps1` writes both from one crop; `sprite.ts` names each loop (`data-loop`); `overlay/server.cjs` serves `GET /anim/[etapa<N>/]<pose>-<theme>.webp` from `assets/anim-hq` (regex-bound, behind the Host check); `overlay.html` fetches it once as a data URL (a drawing shown as an image loads nothing from outside) and keeps the small loop when there is none. Protocol `narsil 3` → `narsil 4`, so a running older server is replaced. Checks: server 9/9 (new route check), drawing ok (new case fails on the previous page), mod 137/138 (pre-existing failure). Risk: item 2 (new unauthenticated local route): the independent verifier found it SAFE (no read outside assets/anim-hq: anchored regex, WHATWG URL drops dot segments first; the Host check runs before it). It also found a pre-existing crash: `new URL(req.url)` throws outside any try on a request line like `GET //`, before the Host check (follow-up).
- **L8** (2026-11-16) "encargate tu de hacer los videos en mi navegador, cada vez que tengas que parar por limite de veo paras y yo te aviso cuando ya puedas seguir". Videos are kept at `~/Downloads/narsil-anim/videos/etapa<N>/<pose>-<theme>.mp4`. Stage 4 `hola-oscuro`: q40, 37.8 KB (window copy 388 KB), committed 8f0bfc7. Veo's limit came again on the next one (`necesita-oscuro`): stopped, waiting on the person.
