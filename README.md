# Predictle

A daily physics-prediction game. Every day, three frozen contraptions: predict the outcome, watch it play out, score 0–100 for how close you were. Puzzles get harder through the week (Monday gentlest, Sunday hardest).

Puzzles are simulated offline in Node (Box2D v3.1 via box2d3-wasm) and shipped as compressed recordings, so every player sees exactly the same outcome; the browser only plays them back. Part of the [jacob.gg](https://biccyanzac-pixel.github.io/jacob.gg/) daily games.

**Status: [docs/status.md](docs/status.md).** Decisions: [engine](docs/engine-decision.md), [formats and scoring](docs/formats.md), [difficulty](docs/difficulty.md).

## Run locally
```
npm install
node tools/serve.mjs                    # http://localhost:8090/   (?date=YYYY-MM-DD for other days)
cd worker && npm install && npm run db:init:local && npm run dev:local   # optional local leaderboard
```

## Generate puzzles
```
node tools/gen/make-days.mjs --from 2026-10-09 --days 10   # -> public/puzzles/YYYY-MM-DD.prd
node tools/gen/trial.mjs 20 stop                           # acceptance rates for a format
```

## Test
```
npm test                                # unit + generator + shipped-file checks
cd worker && npm test                   # end-to-end against a running local worker
```

## Layout
- `public/` the static site. `js/shared/` (codec, scoring, materials, dates) is also used by the Node tools and the worker.
- `tools/sim/` simulator, `tools/gen/` puzzle generator, `tools/scenes/` hand-made scenes, `bench/` the engine comparison.
- `worker/` leaderboard: Cloudflare Worker + D1, scores guesses itself from the published day files.
- `docs/` decisions and status.
