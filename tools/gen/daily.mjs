// The daily game: three "freeze frame" rounds generated from the date alone.
//
// round = f(date, roundNumber). For attempt = 0, 1, 2, ... a contraption is built
// from the seed "predictle:<date>:<round>:<attempt>"; the first attempt that passes
// every check IS the round. Nobody picks or curates anything, and anyone running
// this for the same date gets byte-identical puzzles.
//
// Difficulty comes from how the pieces are combined, not from choosing among
// finished puzzles: a "level" from 0 (gentlest) to 1 (hardest) sets the arena
// size, how many pieces there are, how twisty they are, and how much still happens
// after the freeze. Level rises with the round (easy -> hard) and the weekday
// (Monday -> Sunday).
import { makeRng } from "./rng.mjs";
import { frame, mainPath, piece, bounds, overlaps, inBounds, MIDDLE } from "./recipe.mjs";
import { simulate } from "../sim/simulate.mjs";
import { scoreDistance } from "../../public/js/shared/scoring.js";
import { weekdayOf } from "../../public/js/shared/daily.js";

export const SLOTS = ["easy", "medium", "hard"];
export const MAX_SECONDS = 12;      // simulate at most this long
export const MAX_SETTLE = 10;       // the tracked object must be at rest by then
export const CHAOS_RUNS = 20;
export const CHAOS_LIMIT = 0.04;    // max spread of the resting spot under nudges, as a share of arena width
export const MAX_ATTEMPTS = 400;
const TWISTY = new Set(["bumper", "seesaw", "spring", "conveyor", "fan", "pendulum"]);
const FLOOR_Y = 0.16;

/** 0 = Monday easy ... 1 = Sunday hard. */
export function levelFor(date, round) {
  return Math.min(1, 0.04 + 0.27 * round + 0.07 * weekdayOf(date));
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Build one candidate scene for a difficulty level. */
async function build(rng, level) {
  // Arena: bigger (relative to the pieces) as the level rises. Always 3:4.
  const W = Math.round(lerp(7, 11.5, level) * 4 + rng.float(-2, 2)) / 4, H = (W * 4) / 3;
  const comps = frame(W, H);

  // Floor: mostly sandpits, broken by strips of hard floor. A body that lands on
  // sand stops there; one that lands on hard floor rolls on until it meets sand.
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

  // Middle pieces, placed on the object's actual path. More, and twistier, at higher levels.
  const nMiddle = Math.round(lerp(2, 5, level)) + rng.int(0, 1);
  const weights = Object.fromEntries(Object.entries(MIDDLE).map(([k, w]) => [k, TWISTY.has(k) ? w * lerp(0.4, 2, level) : w]));
  weights.ledge = 1.2; // a short sand tray in mid-air: somewhere off the floor to come to rest
  let lastY = sy - 0.3;
  for (let k = 0; k < nMiddle; k++) {
    const path = await mainPath(scene, 6);
    const P = path.find((p) => p.f > 3 && p.y < lastY - rng.float(0.5, 1.3) && p.y > 1.7 && p.vy < 0.5 && p.x > 0.5 && p.x < W - 0.5);
    if (!P) break;
    for (let attempt = 0; attempt < 6; attempt++) {
      const type = rng.weighted(weights);
      let c;
      if (type === "ledge") {
        // marked frame: it's a resting place, not a mechanism, so it's never "the tricky moment"
        const w = rng.float(0.8, 1.6), x1 = P.x - w * rng.float(0.2, 0.8);
        c = { type: "sand", x1, x2: x1 + w, y: P.y - r - 0.05, depth: 0.16, frame: true, ledge: true };
      } else c = piece(rng, type, P, r, W, H);
      const b = bounds(c);
      if (c.type === "fan") {
        if (c.x1 < 0.2 || c.x2 > W - 0.2 || c.y1 < 1.2 || c.y2 > H - 0.2 || comps.some((o) => o.type === "fan")) continue;
      } else {
        if (!inBounds(b, W, H) || b[1] < 0.9) continue;
        if (comps.some((o) => (!o.frame || o.ledge) && o !== main && overlaps(b, bounds(o)))) continue;
        if (overlaps(b, bounds(main), 0.3)) continue;
      }
      comps.push(c);
      lastY = Math.min(P.y, b ? b[1] : P.y);
      break;
    }
  }
  return scene;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const mainOf = (scene) => scene.components.find((c) => c.role === "main");

/** Check one candidate. Returns { ok: false, reason } or { ok: true, run, puzzle }. */
async function check(scene, level) {
  const run = await simulate(scene, { maxSeconds: MAX_SECONDS });
  const W = scene.world.width;
  if (run.outOfBounds.length) return { ok: false, reason: "something leaves the screen" };
  if (run.meta.mainSettledSeconds === null || run.meta.mainSettledSeconds > MAX_SETTLE) return { ok: false, reason: "doesn't settle within 10 s" };
  const comps = scene.components, mainComp = comps.indexOf(mainOf(scene));
  const real = (i) => comps[i] && !comps[i].frame && comps[i].type !== "chute";
  const touched = run.touched.filter(real);
  if (touched.length < 2) return { ok: false, reason: "touches fewer than 2 pieces" };

  // Freeze just before the tricky moment (the biggest kick from a real piece).
  const key = run.meta.keyFrame;
  if (key === null || !real(run.meta.keyComp)) return { ok: false, reason: "no tricky moment" };
  const freezeFrame = key - 12; // 0.4 s before
  if (freezeFrame < 24) return { ok: false, reason: "tricky moment too early" };
  if (freezeFrame > 6 * 30) return { ok: false, reason: "too long to watch before the freeze" };

  // What still happens after the freeze decides the difficulty band.
  const after = new Set(run.contacts.filter((c) => c.step > freezeFrame * 2 && (c.a === mainComp || c.b === mainComp))
    .map((c) => (c.a === mainComp ? c.b : c.a)).filter(real));
  const twistyAfter = [...after].some((i) => TWISTY.has(comps[i].type));
  const needed = level < 0.35 ? 1 : level < 0.7 ? 2 : 2;
  if (after.size < needed) return { ok: false, reason: `only ${after.size} piece(s) after the freeze` };
  if (level >= 0.7 && !twistyAfter) return { ok: false, reason: "hard round needs a twist after the freeze" };

  const final = run.outcome.final;
  // Ending pressed against a side wall (in a corner, or wedged higher up) makes a dull guess.
  if (final.x < 0.6 || final.x > W - 0.6) return { ok: false, reason: "ends against a wall" };
  // Fairness: tiny nudges (start +-1 px, speed +-1%) must not move the resting spot much.
  const px = W / 1080;
  let spread = 0;
  for (let k = 0; k < CHAOS_RUNS; k++) {
    const s = clone(scene), m = mainOf(s);
    const sp = 1 + [-0.01, -0.005, 0.005, 0.01, 0][Math.floor(k / 4)];
    m.x += [-1, -0.5, 0.5, 1][k % 4] * px;
    m.vx = (m.vx ?? 0) * sp; m.vy = (m.vy ?? 0) * sp;
    const o = await simulate(s, { maxSeconds: MAX_SECONDS });
    if (o.meta.mainSettledSeconds === null) return { ok: false, reason: "chaos: a nudged run doesn't settle" };
    spread = Math.max(spread, Math.hypot(o.outcome.final.x - final.x, o.outcome.final.y - final.y) / W);
    if (spread > CHAOS_LIMIT) return { ok: false, reason: "chaos: too sensitive to tiny nudges" };
  }

  // Sanity check on difficulty: a "rough physics" bot (wrong-ish materials and launch speed).
  const noises = [
    { friction: 0.5, restitution: 1.3, force: 0.8, launch: 1.15 },
    { friction: 1.8, restitution: 0.7, force: 1.2, launch: 0.85 },
    { friction: 1.3, restitution: 1.15, force: 0.9, launch: 1.08 },
  ];
  let mx = 0, my = 0;
  for (const n of noises) {
    const s = clone(scene), m = mainOf(s);
    m.vx = (m.vx ?? 0) * n.launch; m.vy = (m.vy ?? 0) * n.launch;
    const f = (await simulate(s, { maxSeconds: MAX_SECONDS, noise: n })).outcome.final;
    mx += f.x / noises.length; my += f.y / noises.length;
  }
  const roughBot = scoreDistance({ x: mx, y: my }, final, scene.world);
  if (level < 0.35 && roughBot < 70) return { ok: false, reason: "too unpredictable for an easy round" };
  if (level >= 0.7 && roughBot > 95) return { ok: false, reason: "too predictable for a hard round" };

  const m = mainOf(scene);
  const kind = m.type === "block" ? "block" : "ball";
  return {
    ok: true,
    run,
    puzzle: {
      format: "freeze",
      world: scene.world,
      question: `Where will ${kind} A come to rest? Tap the spot.`,
      answer: { final },
      freezeFrame,
      level,
      roughBot,
      piecesAfterFreeze: after.size,
      chaosSpread: spread,
      pieces: comps.filter((c, i) => real(i)).map((c) => c.type),
      launch: { x: m.x, y: m.y, vx: m.vx ?? 0, vy: m.vy ?? 0 },
    },
  };
}

/** Round `round` (0 easy, 1 medium, 2 hard) of `date`. Deterministic. */
export async function generateRound(date, round, { onReject } = {}) {
  const level = levelFor(date, round);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = `predictle:${date}:${round}:${attempt}`;
    const scene = await build(makeRng(seed), level);
    const r = await check(scene, level);
    if (r.ok) return { seed, attempt, scene, ...r };
    onReject?.(r.reason);
  }
  throw new Error(`no round found for ${date} #${round} in ${MAX_ATTEMPTS} attempts`);
}
