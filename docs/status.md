# Status (9 Oct 2026): second design, playable locally, not live

The current design is in [game-design.md](game-design.md). What changed from the first playable version, after your feedback:
- **Every round is freeze frame.** The other five formats are gone from the game. The scoring code for them stays, unused.
- **Rounds are generated from the date alone**, with no pool and no picking: `round = first passing attempt of seed(date, round, attempt)`.
- **Difficulty comes from how pieces combine:** arena size, piece count, twistiness and what's left after the freeze, scaled by round and weekday.
- **Sandpits and mid-air sand ledges** give continuous finishing spots and short rounds. Rounds ending against a side wall are rejected.
- **The tracked object is sometimes a block.**
- **A skip button.**
- **Gentler scoring:** 0 = the worst spot in the arena.

## Play locally
```
node tools/serve.mjs                       # http://localhost:8090/  (days 2026-10-09 .. 2026-10-18)
cd worker && npm run dev:local             # optional local leaderboard on :8798
```

## Before going live
1. Generate about a year: `node tools/gen/make-days.mjs --from 2026-10-10 --days 450`, roughly 20–30 minutes.
2. Run `npx wrangler d1 create predictle-leaderboard`, put the id in `worker/wrangler.toml`, then `npm run db:init && npm run deploy`.
3. Set `leaderboardUrl` in `public/config.json`.
4. Publish `public/` to GitHub Pages (a gh-pages branch, like Yogle).
5. Link the Predictle card on the jacob.gg hub.

## Open
- Share links that show friends' guesses on your replay (Phase 6).
- Untested on a real phone and on Safari.
- Answers are inside the public day files, so a determined player could peek.
- The sand surface and the new scoring curve are new physics and scoring rules. Flag if you want them changed before they're frozen.
