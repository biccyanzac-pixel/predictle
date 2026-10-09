# Predictle

A daily physics-prediction game. Every day: two contraptions (easy, hard) and a laser bonus, all generated from the date. Watch the start, it freezes just before the tricky moment, tap where it will come to rest, then watch. Score 0–100 for how close you were. Days get harder through the week (Monday gentlest, Sunday hardest). Puzzles are byte-identical in every browser, so any day can be built on the spot.

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
node tools/gen/hash-day.mjs 2026-10-12                     # compare with /dev/determinism.html in any browser
```

## Test
```
npm test                                # unit + generator + shipped-file checks
cd worker && npm test                   # end-to-end against a running local worker
```

## Layout
- `public/` the static site. `js/shared/` (codec, scoring, materials, dates) is also used by the Node tools and the worker.
- `public/js/sim/` simulator and `public/js/gen/` generator (run in Node and in browsers), `public/vendor/box2d3/` Box2D (MIT).
- `tools/` command-line tools (day files, hashes, dev server), `bench/` the engine comparison.
- `worker/` leaderboard: Cloudflare Worker + D1, scores guesses itself from the published day files.
- `docs/` decisions and status.
