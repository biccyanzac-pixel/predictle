# Game design (9 Oct 2026, second version)

## One format: freeze frame
Every round works the same way:
1. Watch the start. It freezes just before the tricky moment: 0.4 s before the tracked object gets its biggest kick from a real piece.
2. Tap where **A** will come to rest. A is usually a ball, sometimes a block.
3. Watch what really happens, with slow motion at the tricky moment.

**Skip ⏭** works both while watching the start and while watching the outcome.

## Generated from the date, not chosen
`round = f(date, roundNumber)`, in `tools/gen/daily.mjs`.

For attempt = 0, 1, 2, …, a contraption is built from the seed `predictle:<date>:<round>:<attempt>`. **The first attempt that passes every check is the round.** Nothing is picked, ranked or curated, and regenerating any date gives byte-identical files. The pieces combine in effectively unlimited ways:
- 8 kinds of moving parts and surfaces, in 4 materials
- random sizes, angles, positions and arena sizes
- each piece placed on the object's actual path

The day files are still generated ahead of time in Node (about 4 s per day), not in the browser. Running the physics in each player's browser could give slightly different results in Safari and Chrome, because their maths functions differ. Then friends would see different puzzles. Pre-generating with the same date rule gives everyone the same thing.

## Difficulty: from how things combine
The level runs from 0 (gentlest) to 1 (hardest):

**level = 0.04 + 0.27 × round + 0.07 × weekday** (round 0–2; weekday 0 = Monday … 6 = Sunday)

So Monday easy is 0.04 and Sunday hard is 0.96. The level sets:
- **arena size:** about 7 m wide at level 0, 11.5 m at level 1. It's always 3:4.
- **piece count:** 2 to 5, plus 0 or 1 at random.
- **twisty pieces:** how often bumpers, seesaws, springs, conveyors, fans and pendulums appear rather than plain ramps (×0.4 at level 0, ×2 at level 1).
- **what still happens after the freeze:** easy needs at least 1 piece, medium at least 2, hard at least 2 including a twisty one.
- **a sanity check with a "rough physics" bot**, which uses deliberately wrong materials and launch speed:
  - easy rounds must be guessable by it (it scores 70+)
  - hard rounds must fool it a bit (it scores 95 or less)

Across the first 10 days, the bot averaged 88 on easy rounds, 82 on medium and 74 on hard.

## Fairness and pacing checks (every round)
- Nothing leaves the screen, and A comes to rest within 10 s. The recording ends 1 s after that.
- A touches at least 2 real pieces.
- **Chaos test:** 20 re-runs with the start nudged ±1 px and the speed ±1%. The resting spot may move at most 4% of the arena width.
- A doesn't end pressed against a side wall.
- The freeze comes after at least 0.8 s and at most 6 s of watching.

## Sand
A new surface (not a material for moving pieces). Anything that lands in sand stops: no bounce, full grip, heavy drag. It's used in two places:
- **Floor sandpits.** Most of the floor, broken by short strips of wood or ice where things keep sliding.
- **Mid-air sand ledges.** Short trays on the object's path, so some rounds end off the floor.

This replaces the hills and valleys, which only gave 2–3 possible spots. It also keeps every round short.

## Scoring
**score = 100 × (1 − d / dMax)²**

- **d** is the distance from your tap to where A stopped.
- **dMax** is the distance from where A stopped to the farthest corner of the arena, the worst possible guess.

So 0 means you picked the worst spot in the whole arena, not just "far off".

| Miss, as a share of dMax | Score |
| --- | --- |
| 5% | 90 |
| 10% | 81 |
| 25% | 56 |
| 50% | 25 |

A score that rounds to 100 needs a tap within about 0.3% of dMax, roughly 4 cm in a 9 m arena.

The day's total is out of 300. Emoji per round: 🟢 90+, 🟡 60+, 🟠 30+, 🔴 below 30.
