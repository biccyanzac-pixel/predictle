# Phase 1 summary (9 Oct 2026)

## Done
- Engine evaluation and recommendation: [engine-decision.md](engine-decision.md). Box2D v3.1 via box2d3-wasm, running in Node only.
- A prototype contraption using all 12 component types. It is simulated offline, recorded, compressed to 3.3 KB and played back in the browser at 60 fps, with a slow-motion replay of the key moment.
- 8 unit tests: the codec, playback against the simulation, and determinism. Run them with `npm test`.

## Also done this session (outside Predictle)
- **jacob.gg → ridd-le.** The GitHub repo was renamed to `biccyanzac-pixel/ridd-le`, and the game now lives at https://biccyanzac-pixel.github.io/ridd-le/. The local folder is now `Desktop/ridd-le`.
  - The leaderboards were not affected: they live in Cloudflare D1, the worker and its CORS origin are unchanged, and the answer-hash string was deliberately left alone. Yesterday's board was checked live afterwards.
  - Only the rename edits were committed. Your uncommitted work-in-progress files there were left untouched.
- **New hub at https://biccyanzac-pixel.github.io/jacob.gg/** (repo `biccyanzac-pixel/jacob.gg`, folder `Desktop/jacob.gg`). It shows a card for each game, with Predictle marked "coming soon", plus a countdown to the next UTC day. Old `/jacob.gg/` links now land on the hub, one click from the riddle.

## Decisions needed from you
1. **Approve the engine** (Box2D v3.1 / box2d3-wasm, with Rapier as fallback).
2. **Approve the materials table**, including the min/max rules for combining two surfaces and the rolling resistance I added (see engine-decision.md). Once agreed, these will only change with a flagged proposal.
3. **Leaderboard.** You asked for one like ridd-le's and Yogle's. That conflicts with the brief's "no backend" rule. My proposal follows the same pattern as the other two:
   - a Cloudflare Worker + D1 database (free tier), named `predictle-leaderboard`, on the same Cloudflare account
   - a static site on GitHub Pages
   - the share links stay as specified

   Predictle has an advantage over ridd-le here: the true outcome is in the static puzzle file. The worker can therefore **recompute every score from the submitted guess**, so a player can't inflate their score.

   I'd build this in Phase 5/6. OK to relax the "no backend" rule for this?
4. **World size: 9 m × 12 m.** Is that fine? It fixes the 3:4 aspect ratio, and sizes and speeds are tuned to it.

## Not verified yet
- Determinism on a second operating system (Linux CI). I'll add this as a Phase 2 check.
- Real mid-range phone performance. So far it's only been tested in desktop Edge and a 390 px mobile emulation. The page draws about 15 shapes per frame, so I don't expect problems.
- Safari. `DecompressionStream`, `OffscreenCanvas` patterns and `CanvasPattern.setTransform` need Safari 16.4+. I haven't tested it on a real iPhone.
- Memory use of box2d3-wasm over a 1,000-puzzle batch.

## Housekeeping notes
- ridd-le's `.github/workflows/deploy-pages.yml` still says `BASE_PATH: /jacob.gg/`. The stored git token can't edit workflow files (it lacks the `workflow` scope), so instead `web/vite.config.js` now takes the base path from the repo name in CI and ignores that line. It's harmless, but you may want to tidy it next time you push from a session that has the `workflow` scope.
- Predictle has no git repo or GitHub remote yet. Say the word and I'll create `biccyanzac-pixel/predictle`.
