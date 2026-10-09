# Difficulty

## How a puzzle is rated

Every accepted puzzle is played by three naive "bots". Each bot copies a common human rule of thumb. Its guess is scored with **exactly the same 0–100 scoring as a player's** (`public/js/shared/scoring.js`).

| Bot | Rule of thumb | How it's computed (`tools/gen/evaluate.mjs`) |
| --- | --- | --- |
| drop | "It falls straight down." | Where does it stop: directly below the start (or below the freeze-frame position). How high: no bounce. Stopwatch: free-fall time from the start height. Dominoes: all of them fall. Place: the bumper spot nearest above the star. |
| ramp | "It follows the surfaces." | Re-simulates with only the ramps, curves and walls: bumpers, seesaws, springs, fans and pendulums are removed, conveyors become plain ramps, and nothing bounces (restitution 0). |
| rough-physics | "I roughly know how things behave." | The real simulation, three times, with deliberately wrong values: friction ×0.4 / ×2.0 / ×1.4, bounciness ×1.4 / ×0.6 / ×1.2, forces ±25%, launch speed ±20%. The guess is the average outcome. |

**difficulty = 100 − (0.15 × drop + 0.35 × ramp + 0.50 × rough)**

So the scale runs from 0 (all three bots nail it) to 100 (all three miss badly).

This follows the brief's definitions:
- **Easy:** the ramp bot gets close.
- **Medium:** only the rough-physics bot gets close.
- **Hard:** every bot misses, yet the chaos test still passes, so the outcome is predictable in principle.

## Weekly schedule (Monday easiest, Sunday hardest)

Difficulty means different things for different formats; "how high" and "how many dominoes" aren't on the same scale. So each puzzle is ranked by its **percentile within its own format's pool**, and each day's three slots target these percentiles (`tools/gen/make-days.mjs`, `targets()`):

| | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
| --- | --- | --- | --- | --- | --- | --- | --- |
| easy | 8th | 14th | 20th | 26th | 32nd | 38th | 44th |
| medium | 24th | 32nd | 40th | 48th | 56th | 64th | 72nd |
| hard | 40th | 50th | 60th | 70th | 80th | 90th | 100th |

The bottom 5% of each pool is never used. That keeps Monday gentle but not trivial.

Other rules:
- The same twist type is never the hard slot two days running.
- Formats rotate on a 7-day cycle, so every week has all six formats (the test requires at least 4).

## The chaos test (fairness)

Each candidate is re-run 20 times with:
- the start position nudged by ±0.5 or ±1 pixel (1 px = 1/1080 of the world width)
- the launch speed nudged by ±0.5% or ±1%

It's rejected if the outcome spreads by more than:

| Format | Max spread |
| --- | --- |
| where does it stop, freeze frame, place | 5% of the world width |
| how high | 3% of the world height |
| stopwatch | 5% of the time |
| dominoes | any different count |

For "place", only the correct bumper spot must reliably hit the star, and every other spot must reliably miss it (by more than 8% of the width).

## Distribution of the current pool (seed `predictle-v1`, 1,020 attempts → 135 accepted)

Difficulty histogram per format, with mean bot scores:

| Format | Accepted | D 0–20 | 20–40 | 40–60 | 60–80 | 80–100 | Mean bot score (drop / ramp / rough) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| where does it stop | 29 | 7 | 4 | 6 | 4 | 8 | 15 / 44 / 59 |
| freeze frame | 20 | 2 | 3 | 6 | 3 | 6 | 15 / 27 / 57 |
| how high | 17 | 5 | 6 | 1 | 2 | 3 | 61 / 33 / 76 |
| dominoes | 33 | 0 | 4 | 13 | 11 | 5 | 7 / 7 / 70 |
| stopwatch | 23 | 5 | 5 | 11 | 2 | 0 | 1 / 41 / 93 |
| place the bumper | 13 | 8 | 1 | 4 | 0 | 0 | 12 / 65 / 100 |

The most common rejection reasons were:
- the ball doesn't settle within 15 s
- the chaos test fails
- no proper launch for a height question

The raw data is in `tools/gen/pool-stats.json`.

**Not done yet:** the brief asks for the distribution of a 1,000-puzzle batch. This pool is 135 puzzles, enough for the 10 test days. A year needs about 1,100 puzzles (365 days × 3), so the full batch will come with the year run. It needs roughly 8,000 attempts, about 20 minutes on this laptop.

## Known weak spots
- **"Place the bumper" rates too easy.** The rough-physics bot almost always picks the right spot (mean 100), because each wrong spot sends the ball somewhere very different. Better bots for this format might simulate one candidate at a time with noise and choose by distance.
- **Stopwatch has no hard puzzles yet** (nothing above 80). The rough bot is good at timing.
- These thresholds and weights are first guesses. Tell me if they're off once you've played a week.
