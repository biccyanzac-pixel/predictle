# Engine decision (Phase 1)

**Recommendation: Box2D v3.1 through `box2d3-wasm` 5.2.0, using its `compat` build, in Node only.**
The fallback is Rapier 2D 0.21 (deterministic build). The Box2D calls are kept inside one file, `tools/sim/simulate.mjs`, so switching engines later stays cheap.

Status: **waiting for your approval.** Nothing in Phase 2 has started.

## Where the engine runs

The browser only plays recordings back, so the engine only needs to run in Node. That means:

- Its size and loading speed in the browser don't matter.
- The player page ships no physics code at all: `public/js/render.js` plus `public/js/shared/codec.js` come to about 12 KB unminified.

## Candidates (versions checked on npm, 9 Oct 2026)

| Engine | Version | Licence | Last release | Kind |
| --- | --- | --- | --- | --- |
| Planck.js | 1.5.0 | MIT | Apr 2026 | Box2D v2.4, ported to JS |
| Rapier 2D (`@dimforge/rapier2d-deterministic-compat`) | 0.21.0 | Apache-2.0 | Sep 2026 | Rust compiled to WASM, built to be bit-identical across platforms |
| Matter.js | 0.20.0 | MIT | Jun 2024 | Own JS engine |
| **box2d3-wasm** | **5.2.0** | **MIT** (Box2D itself is MIT) | Feb 2026 | **Box2D v3.1 compiled to WASM** (newer than the original shortlist) |
| phaser-box2d | 1.1.0 | MIT | Jan 2025 | Box2D v3.0, ported to JS (newer than the original shortlist) |

All of these licences are permissive, so none of them needs your approval under the licence rule.

## Measurements

Code: `bench/run.mjs` and `bench/chaos.mjs`. Raw numbers: `bench/results.json`. Measured on this laptop with Node 24, at 60 Hz. Box2D v3 used 4 sub-steps and Box2D v2 used 8/3 iterations (each engine's recommended defaults).

| | Planck | Rapier | Matter | **Box2D v3.1 (wasm)** | phaser-box2d |
| --- | --- | --- | --- | --- | --- |
| 10-box stack stands for 10 s | yes (1 cm "skin" gap per contact) | yes | **no, sinks 9 cm** | yes | yes |
| 210-box pyramid stands | yes | yes | **no** | yes | yes |
| **Speed: ms per simulated second (pyramid)** | 200 | 18–31 | 133–140 | **4–6** (deluxe), **5–8** (compat) | 23–37 |
| 30 dominoes all fall, in order | 30/30 | 30/30 | **9/30** | 30/30 | 30/30 |
| Rubber bounce vs theory (2.47 m) | +0.9% | −0.3% | −6.6% | −0.3% | **no bounce at all (bug)** |
| Ice slide vs theory (5.90 m) | +0.8% | +0.3% | **−96%** | +0.6% | +0.2% |
| Same scene twice gives identical bits | yes | yes | yes | yes, and deluxe = compat bit-for-bit | yes |
| Chaos-test spread of the ball's landing spot (20 perturbed runs) | 6.4% of width | 2.3% | n/a | 2.9% | n/a |
| Conveyor belts | via pre-solve tangent speed | **no native support** in the JS build | hack | **native** (`tangentSpeed`) | n/a |
| Contact events with impact speed (for twist tags and the key moment) | callbacks | event queue | events | **begin + hit events with approach speed** | yes |
| Rolling resistance (balls actually stop) | no | no | no | **yes** | no |

What the table means:

- **Matter.js is out.** It fails stacking, dominoes and friction. Its last release was 2024.
- **phaser-box2d is out.** It ignores restitution, so rubber can't bounce, and it hasn't had a release since January 2025.
- **Planck is accurate but 25–40× slower than Box2D v3.** It also has the widest chaos spread. Generating 1,000+ puzzles means roughly 31 simulations per candidate (1 real run, 20 chaos runs and about 10 bot runs), so speed matters.
- **Rapier and Box2D v3 are both good.** Box2D v3 wins on:
  - **speed:** 3–5× faster
  - **native conveyors:** Rapier's JS build has no surface velocity, so belts would have to be faked
  - **rolling resistance:** without it a rolling ball never stops, which breaks the "settles within 15 s" filter
  - **hit events with impact speed:** these come built in, which twist tagging and the key moment need

  Rapier wins on:
  - **its official cross-platform determinism guarantee**
  - **maintenance:** it has a larger maintainer team

## Determinism

The generator has to give the same output from the same seed, on any machine. Two things support this for Box2D v3:

- Box2D v3 is designed to be deterministic across platforms. That's a stated goal of v3.1, with tests behind it.
- WebAssembly floating-point maths is IEEE-754 on every host.

What I verified here:

- The same scene run twice gives identical bits.
- The SIMD/threaded ("deluxe") build and the plain ("compat") build give bit-identical results.
- `tools/prototype.mjs` run in two separate processes gives a byte-identical output file.

The generator will pin the `compat` build so the code path doesn't depend on the CPU. **Not yet verified:** a run on a second machine or operating system, such as Linux in GitHub Actions. I'll add that as a CI check in Phase 2.

Players' devices never simulate anything, so device differences can't change what they see. That holds regardless of the engine.

## Risks and how they're handled

- **box2d3-wasm is a community wrapper** (two maintainers). Box2D itself is very active.
  - The version is pinned exactly.
  - All engine calls are in one file.
  - Rapier is a measured, working fallback: it's in `bench/engines.mjs`.
- **The wrapper uses embind handles, which must be freed with `.delete()`.** Otherwise memory leaks over a 1,000-puzzle batch. `simulate.mjs` frees every temporary. A long-batch memory check belongs in the Phase 2 tests.
- **Box2D's ideal object sizes are 0.1–10 m.** The world is 9 × 12 m and balls have a radius of about 0.2 m, which is comfortably inside that range.

## The prototype (step 3)

- **Scene:** `tools/scenes/prototype.mjs`. It uses all 12 component types:
  - chute, straight ramps (wood and ice), curved ramp, bumper and conveyor
  - fan zone, spring/trampoline, buckets and walls
  - seesaw, pendulum and dominoes
  - It has two chains. In one, steel ball A runs chute → ramp → bumper → conveyor → fan → ice ramp → curve → spring and lands on the seesaw. In the other, the pendulum knocks the steel dominoes, the last one tips the seesaw, and the seesaw launches rubber ball B.
- **Simulator and recorder:** `node tools/prototype.mjs [--trace]`.
  - It simulates 11 s in about 0.25 s.
  - It writes `public/puzzles/prototype.prd` at **3.3 KB gzipped** (11 moving bodies, 330 frames at 30 fps).
  - Three puzzles a day should come to about 10–30 KB, against the 200 KB budget.
- **File format** (`public/js/shared/codec.js`):
  - The file holds a header (scene + metadata) followed by the motion data.
  - Motion is quantised to 1 mm and 1 mrad, then second-order delta-encoded, zigzag-encoded and stored as varints.
  - The whole file is gzipped. The browser unzips it with the built-in `DecompressionStream`, so no library is needed (Chrome 80+, Safari 16.4+).
- **Player:** `node tools/serve.mjs`, then open http://localhost:8090/prototype.html.
  - It interpolates the 30 fps recording up to the display's refresh rate.
  - It has a slow-motion replay of the key moment, which is computed offline as the largest non-gravity change in the main ball's velocity.
  - A permanent legend shows each material with its colour and pattern.
  - It ran at 60 fps in Edge on this laptop, and the layout was checked at phone width (390 px).
- **Tests:** `npm test` runs 8 tests, all passing:
  - the codec round trip
  - playback against the raw simulation at sampled frames (within 0.5 mm)
  - same scene giving the same recording
  - the prototype staying on screen and settling in under 15 s

## Proposed materials (need sign-off before they're frozen)

These live in `public/js/shared/materials.js`.

| | density | friction | restitution | rolling resistance | look |
| --- | --- | --- | --- | --- | --- |
| wood (default) | 1.0 | 0.5 | 0.15 | 0.04 | tan, wavy grain |
| rubber | 1.2 | 0.9 | 0.85 | 0.06 | pink-red, dots |
| ice | 0.9 | 0.02 | 0.05 | 0.01 | light blue, diagonal hatch |
| steel | 6.0 | 0.4 | 0.05 | 0.02 | grey, rivets |

When two surfaces touch:
- **friction takes the lower value**, so ice is slippery whatever touches it
- **bounciness takes the higher value**, so rubber is bouncy whatever touches it

This lets a player reason about one surface at a time. Box2D's default would combine friction differently, so a wood ball on ice would get a friction of 0.1 instead of 0.02.

**I added rolling resistance**, which wasn't in the brief. Without it, a ball on a flat floor rolls forever, and no puzzle would pass the "settles within 15 s" filter.
