// The daily game: two "freeze frame" rounds (easy, hard) generated from the date alone.
// (The third, bonus, round is the laser puzzle: laser.js.)
//
// round = f(date, roundNumber). For attempt = 0, 1, 2, ... a contraption is built
// from the seed "predictle:<date>:<round>:<attempt>"; the first attempt that passes
// every check IS the round. Nobody picks or curates anything, and anyone running
// this for the same date, in Node or in any browser, gets byte-identical puzzles
// (all maths is deterministic: see shared/dmath.js).
//
// Difficulty comes from how the pieces are combined: a "level" from 0 (gentlest) to
// 1 (hardest) sets the arena size, how many pieces there are and how twisty they are,
// how many decoys there are, and how much must still happen after the freeze. Two
// "naive" guessers (straight down; carry on in a parabola) must be fooled, more so
// on hard rounds, so the answer is never obvious from the freeze frame.
import { makeRng } from "./rng.js";
import { hypot } from "../shared/dmath.js";
import { frame, mainPath, piece, bounds, overlaps, inBounds, MIDDLE } from "./recipe.js";
import { simulate } from "../sim/simulate.js";
import { scoreDistance } from "../shared/scoring.js";
import { weekdayOf } from "../shared/daily.js";

export const SLOTS = ["easy", "hard"];
export const MAX_SECONDS = 44;      // simulate at most this long
export const MAX_SETTLE = 40;       // the tracked object must be at rest by then (skip exists)
export const CHAOS_RUNS = 20;
export const CHAOS_LIMIT = 0.04;    // max spread of the resting spot under nudges, as a share of arena width
export const MAX_ATTEMPTS = 6000;
const TWISTY = new Set(["bumper", "seesaw", "spring", "conveyor", "fan", "pendulum", "spinner", "ball", "block", "lowgrav"]);
const ZONES = new Set(["fan", "lowgrav"]);
const FLOOR_Y = 0.16;

/** Easy: 0.05 (Mon) .. 0.41 (Sun). Hard: 0.6 (Mon) .. 1.0 (Sun). */
export function levelFor(date, round) {
  const w = weekdayOf(date);
  return round === 0 ? 0.05 + 0.06 * w : Math.min(1, 0.6 + 0.0667 * w);
}

/** What the checks demand at a level (see docs/game-design.md). */
export function rulesFor(level) {
  return {
    afterFreeze: level < 0.5 ? 1 : 2,           // pieces A still meets after the freeze
    needTwistAfter: level >= 0.5,               // ...including a twisty one
    naiveMax: level < 0.5 ? 85 : 60,            // best naive guess must score at most this
    roughMin: level < 0.5 ? 55 : 15,            // easy: a decent physical guess must work; hard: not hopeless
    roughMax: level < 0.5 ? 100 : 92,           // hard: and even that should miss a bit
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Build one candidate scene for a difficulty level. */
async function build(rng, level) {
  // Arena: bigger (relative to the pieces) as the level rises. Always 3:4.
  const W = Math.round(lerp(7, 11.5, level) * 4 + rng.float(-2, 2)) / 4, H = (W * 4) / 3;
  const comps = frame(W, H);

  // Floor: mostly sandpits, broken by strips of hard floor. A body that lands on
  // sand stops there; one that lands on hard floor slides on until it meets sand.
  const cuts = [0.16];
  const nStrips = rng.int(1, 3);
  for (let k = 0; k < nStrips; k++) {
    const w = rng.float(0.5, 1.4), x = rng.float(0.5, W - 0.5 - w);
    cuts.push(x, x + w);
  }
  cuts.push(W - 0.16);
  cuts.sort((a, b) => a - b);
  for (let k = 0; k + 1 < cuts.length; k += 2) {
    if (cuts[k + 1] - cuts[k] > 0.3) comps.push({ type: "sand", x1: cuts[k], x2: cuts[k + 1], y: FLOOR_Y + 0.08, depth: 0.3, frame: true });
  }
  for (let k = 1; k + 1 < cuts.length; k += 2) {
    comps.push({ type: "ramp", x1: cuts[k], y1: FLOOR_Y + 0.03, x2: cuts[k + 1], y2: FLOOR_Y + 0.03, t: 0.06, material: rng.weighted({ wood: 3, ice: 2 }), frame: true });
  }

  // Corner kick-outs (like the edges of a pachinko board): a ball reaching a side
  // wall low down rolls back towards the middle instead of resting in the corner.
  const kick = rng.float(0.9, 1.4);
  comps.push({ type: "ramp", x1: 0.16, y1: kick + 0.3, x2: kick, y2: FLOOR_Y + 0.12, t: 0.12, material: "wood", frame: true });
  comps.push({ type: "ramp", x1: W - 0.16, y1: kick + 0.3, x2: W - kick, y2: FLOOR_Y + 0.12, t: 0.12, material: "wood", frame: true });

  // The tracked object: usually a ball, sometimes a block.
  const material = rng.weighted({ wood: 4, steel: 3, rubber: 2, ice: 1 });
  const isBlock = rng.chance(0.22);
  const r = isBlock ? 0.22 : rng.float(0.17, 0.24); // size used for placement clearance
  const sx = rng.float(0.2 * W, 0.8 * W), sy = H - rng.float(0.6, 1.0);
  let main;
  if (rng.chance(0.4)) {
    comps.push({ type: "chute", dir: "down", x: sx, y: sy - 0.5, w: 2 * r + 0.08, h: 0.9 });
    main = { x: sx, y: sy, vx: 0, vy: -rng.float(0.5, 2) };
  } else {
    const dir = sx < W / 2 ? "right" : "left", s = dir === "right" ? 1 : -1;
    comps.push({ type: "chute", dir, x: sx, y: sy, w: 2 * r + 0.08, h: 0.8 });
    main = { x: sx - s * 0.35, y: sy, vx: s * rng.float(0.8, 3.2), vy: 0 };
  }
  main = isBlock
    ? { type: "block", ...main, hw: rng.float(0.17, 0.22), hh: rng.float(0.13, 0.19), material: rng.weighted({ wood: 3, ice: 2, steel: 2, rubber: 1 }), role: "main", label: "A" }
    : { type: "ball", ...main, r, material, role: "main", label: "A" };
  comps.push(main);
  const scene = { world: { width: W, height: H }, components: comps };

  const fits = (c) => {
    const b = bounds(c);
    if (ZONES.has(c.type)) return c.x1 >= 0.2 && c.x2 <= W - 0.2 && c.y1 >= 1.2 && c.y2 <= H - 0.2 && comps.filter((o) => ZONES.has(o.type)).length < 2;
    if (!inBounds(b, W, H) || b[1] < 0.9) return false;
    if (comps.some((o) => (!o.frame || o.ledge) && o !== main && overlaps(b, bounds(o)))) return false;
    return !overlaps(b, bounds(main), 0.3);
  };
  const weights = Object.fromEntries(Object.entries(MIDDLE).map(([k, w]) => [k, TWISTY.has(k) || k === "shelf" ? w * lerp(0.5, 2, level) : w]));
  // (no mid-air sand ledges any more: a ball stopping on one after 3 s made for dull rounds)

  // Middle pieces, placed on the object's actual path.
  const nMiddle = Math.round(lerp(6, 10, level)) + rng.int(0, 2);
  let lastY = sy - 0.3;
  for (let k = 0; k < nMiddle; k++) {
    const path = await mainPath(scene, 6);
    const P = path.find((p) => p.f > 3 && p.y < lastY - rng.float(0.3, 0.9) && p.y > 1.5 && p.vy < 0.5 && p.x > 0.5 && p.x < W - 0.5);
    if (!P) break;
    for (let attempt = 0; attempt < 6; attempt++) {
      // pachinko: one of the first pieces is usually a peg field
      const type = k === 1 && attempt === 0 && rng.chance(0.75) ? "pegs" : rng.weighted(weights);
      let made;
      if (type === "ledge") {
        // marked frame: it's a resting place, not a mechanism, so it's never "the tricky moment"
        const w = rng.float(0.8, 1.6), x1 = P.x - w * rng.float(0.2, 0.8);
        made = [{ type: "sand", x1, x2: x1 + w, y: P.y - r - 0.05, depth: 0.16, frame: true, ledge: true }];
      } else made = [].concat(piece(rng, type, P, r, W, H));
      if (!made.every(fits)) continue;
      comps.push(...made);
      const b = bounds(made[0]);
      lastY = Math.min(P.y, b ? b[1] : P.y);
      break;
    }
  }

  // Decoys: pieces placed anywhere free, not aimed at the path. Some get involved,
  // some don't; either way the picture doesn't give away which pieces matter.
  // They stay clear of the path A actually takes, so they never catch it early.
  const finalPath = await mainPath(scene, 12);
  const clearOfPath = (c) => {
    const b = bounds(c);
    if (!b) return true;
    return !finalPath.some((q) => q.x > b[0] - 0.6 && q.x < b[2] + 0.6 && q.y > b[1] - 0.6 && q.y < b[3] + 0.6);
  };
  const nDecoys = rng.int(4, Math.round(lerp(6, 10, level)));
  const decoyWeights = { ...MIDDLE, pegs: 9, lowgrav: 0.5, fan: 0.5 };
  for (let k = 0; k < nDecoys; k++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const P = { x: rng.float(0.8, W - 0.8), y: rng.float(2, H - 1.5), vx: rng.float(-1, 1), vy: -1 };
      const made = [].concat(piece(rng, rng.weighted(decoyWeights), P, r, W, H));
      if (!made.every(fits) || !made.every(clearOfPath)) continue;
      comps.push(...made);
      break;
    }
  }
  return scene;
}

export { build as _build, check as _check };
const clone = (o) => JSON.parse(JSON.stringify(o));
const mainOf = (scene) => scene.components.find((c) => c.role === "main");

/** Check one candidate. Returns { ok: false, reason } or { ok: true, run, puzzle }. Cheap checks first. */
async function check(scene, level) {
  const rules = rulesFor(level);
  const run = await simulate(scene, { maxSeconds: MAX_SECONDS });
  const W = scene.world.width, world = scene.world;
  if (run.outOfBounds.length) return { ok: false, reason: "something leaves the screen" };
  if (run.meta.mainSettledSeconds === null || run.meta.mainSettledSeconds > MAX_SETTLE) return { ok: false, reason: "doesn't settle in time" };
  const comps = scene.components, mainComp = comps.indexOf(mainOf(scene));
  const real = (i) => comps[i] && !comps[i].frame && comps[i].type !== "chute";
  const minTouched = 3 + Math.round(level);
  const touchedCount = run.touched.filter(real).reduce((n, i) => n + (comps[i].type === "pegs" ? 2 : 1), 0); // a peg field is many hits
  if (touchedCount < minTouched) return { ok: false, reason: `touches fewer than ${minTouched} pieces` };

  // Freeze just before the tricky moment (the biggest kick from a real piece).
  const key = run.meta.keyFrame;
  if (key === null || !real(run.meta.keyComp)) return { ok: false, reason: "no tricky moment" };
  const freezeFrame = key - 12; // 0.4 s before
  if (freezeFrame < 24) return { ok: false, reason: "tricky moment too early" };
  if (freezeFrame > 15 * 30) return { ok: false, reason: "too long to watch before the freeze" };

  const final = run.outcome.final;
  if (final.x < 0.6 || final.x > W - 0.6) return { ok: false, reason: "ends against a wall" };
  // Pachinko, not a shelf: A must make it most of the way down, and take its time doing it.
  if (final.y > 0.3 * scene.world.height) return { ok: false, reason: "stops too high up" };
  const minSeconds = lerp(6, 7.5, level);
  if (run.meta.mainSettledSeconds < minSeconds) return { ok: false, reason: "over too quickly" };

  // What still happens after the freeze.
  const after = new Set(run.contacts.filter((c) => c.step > freezeFrame * 2 && (c.a === mainComp || c.b === mainComp))
    .map((c) => (c.a === mainComp ? c.b : c.a)).filter(real));
  if (after.size < rules.afterFreeze) return { ok: false, reason: `only ${after.size} piece(s) after the freeze` };
  if (rules.needTwistAfter && ![...after].some((i) => TWISTY.has(comps[i].type))) return { ok: false, reason: "hard round needs a twist after the freeze" };

  // Not obvious: naive guesses from the freeze frame must miss.
  const t = run.recording.bodies[run.mainIndex], f = freezeFrame;
  const p = { x: t.x[f], y: t.y[f] }, v = { x: (t.x[f] - t.x[f - 1]) * 30, y: (t.y[f] - t.y[f - 1]) * 30 };
  const m = mainOf(scene), rr = m.r ?? m.hh, floorY = FLOOR_Y + 0.08 + rr;
  const drop = { x: p.x, y: floorY };
  const tFall = (v.y + Math.sqrt(v.y * v.y + 20 * Math.max(0, p.y - floorY))) / 10;
  const ballistic = { x: Math.min(W - rr, Math.max(rr, p.x + v.x * tFall)), y: floorY };
  const naive = Math.max(scoreDistance(drop, final, world), scoreDistance(ballistic, final, world));
  if (naive > rules.naiveMax) return { ok: false, reason: "too obvious from the freeze frame" };

  // A "rough physics" guesser (wrong-ish materials and launch speed): easy rounds must be
  // reasonably guessable with good intuition; hard ones should fool even that a little.
  const noises = [
    { friction: 0.5, restitution: 1.3, force: 0.8, launch: 1.15 },
    { friction: 1.8, restitution: 0.7, force: 1.2, launch: 0.85 },
    { friction: 1.3, restitution: 1.15, force: 0.9, launch: 1.08 },
  ];
  let mx = 0, my = 0;
  for (const n of noises) {
    const s = clone(scene), mm = mainOf(s);
    mm.vx = (mm.vx ?? 0) * n.launch; mm.vy = (mm.vy ?? 0) * n.launch;
    const fin = (await simulate(s, { maxSeconds: MAX_SECONDS, noise: n })).outcome.final;
    mx += fin.x / noises.length; my += fin.y / noises.length;
  }
  const roughBot = scoreDistance({ x: mx, y: my }, final, world);
  if (roughBot < rules.roughMin) return { ok: false, reason: "too unpredictable for an easy round" };
  if (roughBot > rules.roughMax) return { ok: false, reason: "too predictable for a hard round" };

  // Fairness: tiny nudges (start +-1 px, speed +-1%) must not move the resting spot much.
  const px = W / 1080;
  let spread = 0;
  for (let k = 0; k < CHAOS_RUNS; k++) {
    const s = clone(scene), mm = mainOf(s);
    const sp = 1 + [-0.01, -0.005, 0.005, 0.01, 0][Math.floor(k / 4)];
    mm.x += [-1, -0.5, 0.5, 1][k % 4] * px;
    mm.vx = (mm.vx ?? 0) * sp; mm.vy = (mm.vy ?? 0) * sp;
    const o = await simulate(s, { maxSeconds: MAX_SECONDS });
    if (o.meta.mainSettledSeconds === null) return { ok: false, reason: "chaos: a nudged run doesn't settle" };
    spread = Math.max(spread, hypot(o.outcome.final.x - final.x, o.outcome.final.y - final.y) / W);
    if (spread > CHAOS_LIMIT) return { ok: false, reason: "chaos: too sensitive to tiny nudges" };
  }

  const kind = m.type === "block" ? "block" : "ball";
  return {
    ok: true,
    run,
    puzzle: {
      format: "freeze",
      world,
      question: `Where will ${kind} A come to rest? Tap the spot.`,
      answer: { final },
      freezeFrame,
      level,
      naiveBot: naive,
      roughBot,
      piecesAfterFreeze: after.size,
      chaosSpread: spread,
      pieces: comps.filter((c, i) => real(i)).map((c) => c.type),
      launch: { x: m.x, y: m.y, vx: m.vx ?? 0, vy: m.vy ?? 0 },
    },
  };
}

/** Round `round` (0 easy, 1 hard) of `date`. Deterministic. */
export async function generateRound(date, round, { onReject, onAttempt } = {}) {
  const base = levelFor(date, round);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt);
    // If nothing passes after 2000 tries, ease off a little (still deterministic).
    const level = attempt < 2000 ? base : Math.max(round ? 0.5 : 0, base - 0.1 * (1 + Math.floor((attempt - 2000) / 500)));
    const seed = `predictle:${date}:${round}:${attempt}`;
    const scene = await build(makeRng(seed), level);
    const r = await check(scene, level);
    if (r.ok) return { seed, attempt, scene, ...r };
    onReject?.(r.reason);
  }
  throw new Error(`no round found for ${date} #${round} in ${MAX_ATTEMPTS} attempts`);
}
