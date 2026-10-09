# Predictle

A daily physics-prediction game. Every day, three contraptions generated from the date: watch the start, it freezes just before the tricky moment, tap where it will come to rest, then watch. Score 0–100 for how close you were. Rounds get harder through the day and through the week (Monday gentlest, Sunday hardest).

Puzzles are simulated offline in Node (Box2D v3.1 via box2d3-wasm) and shipped as compressed recordings, so every player sees exactly the same outcome; the browser only plays them back. Part of the [jacob.gg](https://biccyanzac-pixel.github.io/jacob.gg/) daily games.

**Status: [docs/status.md](docs/status.md).** Design: [game design, generation, difficulty, scoring](docs/game-design.md); [engine](docs/engine-decision.md).

## Run locally
```
npm install
node tools/serve.mjs                    # http://localhost:8090/   (?date=YYYY-MM-DD for other days)
cd worker && npm install && npm run db:init:local && npm run dev:local   # optional local leaderboard
```

## Generate puzzles
```
node tools/gen/make-days.mjs --from 2026-10-09 --days 10   # -> public/puzzles/YYYY-MM-DD.prd (each day = f(date))
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
