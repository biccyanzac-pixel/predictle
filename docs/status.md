# Status: LIVE since 9 Oct 2026 (day #1)

- **Game:** https://biccyanzac-pixel.github.io/predictle/, served from the `gh-pages` branch (a copy of `public/`).
- **Hub:** https://biccyanzac-pixel.github.io/jacob.gg/ links to it.
- **Leaderboard:** https://predictle-leaderboard.jacob-gg-leaderboard-worker.workers.dev (Cloudflare Worker + D1 `predictle-leaderboard`).

Design: [game-design.md](game-design.md).

## Day files
Days are pre-generated through 8 Oct 2027. Any later day is built in the player's browser, identical to what a file would hold. The leaderboard can only check scores on days that have a file, so top up before then:
```
node tools/gen/make-days.mjs --from 2027-10-09 --days 365     # ~2-3 h on this laptop
git add public/puzzles && git commit -m "More days" && git push
git subtree split --prefix public -b gh-pages && git push -f origin gh-pages
```
**Never regenerate or edit a published day.** The leaderboard caches each day's answers. Generation is deterministic, so regenerating gives identical bytes unless the generator code has changed.

## Deploy
- **Site:** `git subtree split --prefix public -b gh-pages && git push -f origin gh-pages`
- **Worker:** `cd worker && npx wrangler deploy` (schema: `npm run db:init`)

## Changing the generator, scoring or materials
Any change to `public/js/gen/`, `public/js/sim/`, `shared/scoring.js`, `shared/materials.js` or `shared/dmath.js` changes FUTURE puzzles. Only regenerate days that haven't happened yet; past days must stay byte-identical.

## Open
- Share links that show friends' guesses on your replay.
- Not tried on a real iPhone. WebKit passes the full playthrough.
- Answers are readable in the public day files.
