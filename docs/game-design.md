# Game design (live; generator v2 from 11 Oct 2026)

## A day
1. **Round 1 (easy)** and **Round 2 (hard)**, both freeze frame, pachinko-style.
   - **How it plays:** you watch the start, and it freezes just before the tricky moment. You tap where **A** will come to rest, then watch the rest, with slow motion at the tricky moment. **Skip ⏭** works at any point.
   - **The board:** peg fields, switchback ramps, springs, spinners, low-gravity zones and so on, plus decoys.
   - **Run length:** A must make it most of the way down (finish in the bottom 30%) and take its time: at least 6 s on easy rounds and about 7.5 s on hard ones. Rounds can run up to 40 s.
2. **Bonus: aim the laser** (from 11 Oct; 9–10 Oct keep the original "where does it hit the wall" laser).
   - **The goal:** a target sits far from the emitter, usually behind dark blocks. You drag to aim (with 0.1° nudges) and can only see the first half of the beam: half the straight-line distance to the target. Then you fire.
   - **The pieces:**
     - mirrors: flat, V-shaped, triangle, square, round posts and curved arcs
     - mirrored stretches of wall
     - glass and lenses that bend light (index 1.33, 1.5 or 1.8, using Snell's law with total internal reflection)
     - dark blocks and plain walls, which absorb the beam, so it always ends
   - **Every puzzle passes these checks:**
     - only 0.3–3% of all directions hit
     - every hit needs at least 2 reflections or refractions
     - there's at least one aimable window at least 0.5° wide
     - aiming straight at the target scores 70 or less
   - **After firing,** you can explore: a ring around the emitter shows green for directions that hit and red for ones that don't, and dragging traces the full beam.
   - **Bonus score:** a hit (the beam passes within 0.28 m of the target's centre) is 100. Otherwise, take the share of all 2,880 possible aims (every 0.125°) that get *less* close to the target than yours. The score is 100 × share². So 0 is the worst possible aim, and beating 95% of aims scores 90. The leaderboard worker recomputes it from your aim angle.

## Generated from the date, identical everywhere
Every puzzle is a function of the date: `round = f(date, round)` and `laser = f(date)`. For attempt 0, 1, 2, …, a design is built from the seed `predictle:<date>:<round>:<attempt>`, and **the first one that passes every check is the puzzle**. Nothing is curated.

**The same in every browser.** Box2D runs in WebAssembly, whose floating-point maths is deterministic by specification and doesn't call JavaScript's Math. The JavaScript around it (generator, simulator glue, scoring) avoids `Math.sin`, `cos`, `atan2`, `hypot` and `**`, whose last bit can differ between Chrome, Safari and Firefox. It uses `shared/dmath.js` instead, built from + − × ÷ and √ only.

Verified by generating the same days in Node, Edge (Chromium), Firefox and WebKit (Safari's engine). All four produce byte-identical results (same SHA-256). To re-check:
- `node tools/gen/hash-day.mjs DATE` for Node
- `/dev/determinism.html?date=DATE` in any browser

**Nightly job (`tools/github/nightly.yml`):** at 00:10 UTC every night, GitHub Actions makes any missing day up to a year ahead and republishes the site, so the files never run out. It's switched on by copying that file to `.github/workflows/`.

**How the two paths fit together:**
- **Normal path:** pre-generated day files (`public/puzzles/DATE.prd`), which load instantly.
- **Fallback:** when a day has no file, the browser builds it itself in a background worker ("Building the contraptions…"). That takes about 20–30 s on a laptop and longer on a phone, and gives exactly the bytes the file would have held.

So the game never runs out of puzzles. Pre-generating years ahead keeps it fast. The leaderboard can only check scores for days that have a file; see status.md.

## Pieces
- **Moving and twisty:** bumpers, seesaws, springs, conveyors, fans, pendulums, **spinners** (paddles turning at a constant speed), and **loose balls and blocks** sitting on **shelves** waiting to be knocked.
- **Surfaces:** ramps and curved ramps, **funnels**, **shelves**, and **sand** (floor pits and mid-air ledges), plus strips of wood or ice where things keep sliding.

Each piece has a random size, angle and material. Pieces are placed **on A's actual path** (the generator simulates as it goes). **Decoy** pieces are scattered elsewhere, so the picture doesn't give away which pieces matter.

## Difficulty
| | Monday | … | Sunday |
| --- | --- | --- | --- |
| Easy level | 0.05 | +0.06 a day | 0.41 |
| Hard level | 0.60 | +0.067 a day | 1.00 |
| Laser level | 0.30 | +0.10 a day | 0.90 |

The level sets:
- the arena size: about 7 m wide at level 0, 11.5 m at level 1
- the number of pieces: 3–6 on the path, plus 0–3 decoys
- how twisty the pieces are

It also sets what the checks demand:

| Check | Easy (level < 0.5) | Hard |
| --- | --- | --- |
| Pieces A still meets after the freeze | 1+ | 2+, including a twisty one |
| Best naive guess ("straight down" or "carry on in a parabola" from the freeze) | 85 or less | 60 or less |
| "Rough physics" guesser (deliberately wrong materials and launch speed) | 55 or more | 15–92 |

**Laser:**
- needs 3–6+ reflections, depending on level
- "straight on to the wall" and "first reflection, then straight" must score at most 70 − 30 × level

## Fairness checks
**Physics rounds:**
- A touches at least 2 real pieces.
- A comes to rest within 10 s, and nothing leaves the screen.
- A doesn't end against a side wall.
- **Chaos test:** 20 re-runs with the start nudged ±1 px and the speed ±1%. The resting spot may move at most 4% of the arena width.

**Laser:**
- no grazing reflections and no clipping a mirror's end
- the beam doesn't end in a corner
- nudging the aim by ±0.15° or the emitter by ±1 px must keep the same mirror sequence and move the hit by less than 2% of the perimeter

## Scoring
**score = 100 × (1 − miss / worst possible miss)⁴**

- **Physics rounds:** the miss is the straight-line distance. The worst possible miss is the distance to the farthest corner of the arena.
- **Laser:** the miss is measured along the wall, the short way round. The worst possible miss is half the perimeter.

| Miss, as a share of the worst | Score |
| --- | --- |
| 5% | 81 |
| 10% | 66 |
| 20% | 41 |
| 30% | 24 |
| 50% | 6 |

0 only for the worst possible guess. A score that rounds to 100 needs a near-exact tap.

The main score is out of 200; the bonus is out of 100, on its own board. Emoji: 🟢 90+, 🟡 60+, 🟠 30+, 🔴 below 30.
