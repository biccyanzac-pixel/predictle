# Status (9 Oct 2026): playable locally, not live yet

## Decisions you made (recorded)
- **Engine:** Box2D v3.1 via box2d3-wasm. The materials table is approved and unchanged.
- **Leaderboard:** Cloudflare Worker + D1, like the other daily games.
- **Difficulty rises through the week:** Monday gentlest (but not trivial), Sunday hardest.
- **Scores are 0–100 for how close you were**, never just right or wrong. Buckets are out.
- **World size can differ every puzzle.** The shape stays 3:4 so it fits phones; the scale varies (see formats.md).

## What's built
1. **Generator** (`tools/gen/`). It builds random contraptions, with each piece placed on the ball's actual path, then applies:
   - the brief's filters
   - the 20-run chaos test
   - the three difficulty bots
   - weekly scheduling

   Run it with `node tools/gen/make-days.mjs --from YYYY-MM-DD --days N`. The same seed gives byte-identical files (verified).
2. **Six question formats** (formats.md): where does it stop, freeze frame, how high, domino count, stopwatch, place the bumper.
3. **The game** (`public/index.html`, `public/js/game.js`):
   - intro, then 3 puzzles, then results
   - predict, then play with automatic slow motion at the key moment, then the score with your guess and the answer drawn
   - replay of the key moment
   - a share line with emoji and a link
   - streak and history saved in your browser (and it still works when storage is blocked)
   - a magnifier while placing a guess with your finger, a Clear button before you lock in, and large tap targets
4. **Leaderboard worker** (`worker/`):
   - The browser sends only your name and guesses. The worker downloads that day's puzzle file and **computes the scores itself**, so scores can't be faked.
   - One entry per player per day. Archive replays go on a separate "late" board.
   - Tested end to end against a local copy (`worker/test/e2e.mjs`, 11 checks).
5. **Tests:** `npm test` runs 20, all passing:
   - codec round trip
   - playback against the simulation
   - simulator determinism
   - scoring maths
   - date and timezone edge cases
   - generator determinism
   - shipped-file checks: size, screen bounds, settle time
   - schedule rules: no repeated layouts, no repeated hard twist on consecutive days, at least 4 formats a week, Monday's hard slot easier than Sunday's

## Play it locally
```
node tools/serve.mjs                       # http://localhost:8090/
cd worker && npm run dev:local             # optional: local leaderboard on :8798
```
- **Puzzles exist for 2026-10-09 to 2026-10-18.** Today's opens by default; pick other days from the links on the intro card, or use `?date=2026-10-12`.
- **Replaying a day:** your answers for a day are saved, so to replay one, clear site data or use a private window.

## Not done yet / open
- **Phase 6 share links** (friends' guesses shown on your replay). The current share line is text only.
- **The year of puzzles.** I've generated 10 days for testing. A full year needs about 8,000 attempts, roughly 20 minutes. I'll run it once you're happy with the formats.
- **The 1,000-puzzle difficulty batch** comes with that run.
- **A contact-sheet review page** (brief Phase 2.6) for rejecting puzzles by ID.
- **Untested on a real phone and on Safari.** Tests so far were desktop Edge plus phone emulation.
- **Answers are inside the public day files.** Anyone determined can read them. That's unavoidable without a server holding them back. The leaderboard is still fair in one sense: scores can't be inflated, only cheated by reading ahead.

## Changes I made that you should know about
- **Seesaw and pendulum pivots now have some friction.** Without it a seesaw rocked forever, so no puzzle could pass the "settles in 15 s" rule. This changes component behaviour, not materials.
- **Floors for "where does it stop" puzzles are gentle hills and valleys** with raised ends. On a flat floor the ball nearly always rolled into a corner, which made the guess left-or-right.
- **New 0–100 scoring curves** (formats.md). Once you're happy with them they'll be frozen like the materials.
