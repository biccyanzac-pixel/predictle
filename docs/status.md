# Status (9 Oct 2026): third version, playable locally, NOT pushed

Design: [game-design.md](game-design.md).

## Play locally
```
node tools/serve.mjs                 # http://localhost:8090/
cd worker && npm run dev:local       # local leaderboards on :8798 (main + bonus)
```
- **Ready-made days:** 2 Oct to 18 Oct 2026. The local test "launch day" is 2 Oct, so the archive has a week of past days.
- **Any other date** (e.g. `?date=2026-10-25`) is built in your browser from the date. That takes about half a minute.

## Before going live
1. Set `LAUNCH_DAY` in `public/js/shared/daily.js` to the real launch date.
2. Pre-generate ahead: `node tools/gen/make-days.mjs --from <launch> --days 730`. That's about 25 s per day of CPU on 7 threads, roughly 45 minutes for 2 years and 6.7 MB.
3. Create the D1 database: `npx wrangler d1 create predictle-leaderboard`. Put the id in `worker/wrangler.toml`, then `npm run db:init && npm run deploy`.
4. Set `leaderboardUrl` in `public/config.json`.
5. Publish `public/` to GitHub Pages, and link the card on the jacob.gg hub.

## Open
- **Leaderboard on days without a file.** The worker can't run the physics (Cloudflare's free tier allows 10 ms of CPU per request), so it can only score days that have a file. Pre-generating 2+ years covers that. Topping up later is one command, or a scheduled GitHub Action (adding that needs your browser login, because the saved token can't edit workflow files).
- **Share links showing friends' guesses** are not built yet.
- **Not tried on a real iPhone.** WebKit (Safari's engine) passes the full playthrough here.
- **Answers are inside the public day files.**
