// Bonus round v2: aim the laser. You choose the beam's direction; the goal is to get the
// beam to pass through a target that is far away and hidden behind blocks, so it has to
// go via mirrors and glass. Generated from the date like everything else: the first
// seeded attempt that passes every check is the puzzle.
import { makeRng } from "./rng.js";
import { sin, cos, hypot, atan2, PI } from "../shared/dmath.js";
import { traceBeam, TARGET_R, SWEEP_N, sweepAngle, scoreAim } from "../shared/optics.js";
import { weekdayOf } from "../shared/daily.js";

export const MAX_ATTEMPTS = 4000;
export const aimLevel = (date) => 0.3 + 0.1 * weekdayOf(date);

const poly = (x, y, a, size, n, rng, jitter = 0) => {
  const pts = [];
  for (let j = 0; j < n; j++) { const t = a + (2 * PI * j) / n + (jitter ? rng.float(-jitter, jitter) : 0); pts.push([x + size * cos(t), y + size * sin(t)]); }
  return pts;
};
const ccw = (pts) => { let s = 0; pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; }); return s > 0 ? pts : [...pts].reverse(); };

function makePiece(rng, x, y, level) {
  const a = rng.float(0, 2 * PI);
  const type = rng.weighted({ flat: 4, vee: 1.5, ball: 1.8, arc: 2, prism: 1.2, square: 1, block: 2.2, glass: 1.2 + level, lens: 1 + level });
  if (type === "flat") { const h = rng.float(0.45, 1.2); return { t: "mirror", shape: "flat", segs: [[x - h * cos(a), y - h * sin(a), x + h * cos(a), y + h * sin(a)]] }; }
  if (type === "vee") {
    const L1 = rng.float(0.45, 0.9), L2 = rng.float(0.45, 0.9), op = rng.float(0.7, 1.6);
    const p1 = [x + L1 * cos(a - op / 2), y + L1 * sin(a - op / 2)], p2 = [x + L2 * cos(a + op / 2), y + L2 * sin(a + op / 2)];
    return { t: "mirror", shape: "vee", segs: [[...p1, x, y], [x, y, ...p2]] };
  }
  if (type === "prism" || type === "square") {
    const pts = ccw(poly(x, y, a, rng.float(0.3, 0.65), type === "prism" ? 3 : 4, rng, type === "prism" ? 0.25 : 0));
    return { t: "mirror", shape: type, pts, segs: pts.map((p, i) => [...p, ...pts[(i + 1) % pts.length]]) };
  }
  if (type === "ball") return { t: "ball", x, y, r: rng.float(0.25, 0.55) };
  if (type === "arc") {
    const r = rng.float(0.6, 1.3), half = rng.float(0.5, 1.1), cx = x - r * cos(a), cy = y - r * sin(a), pts = [];
    for (let j = 0; j <= 16; j++) { const t = a - half + (2 * half * j) / 16; pts.push([cx + r * cos(t), cy + r * sin(t)]); }
    return { t: "arc", x: cx, y: cy, r, mx: cos(a), my: sin(a), cosHalf: cos(half), pts };
  }
  if (type === "block") {
    const w = rng.float(0.25, 0.8), h = rng.float(0.25, 1.4);
    const c = cos(a), s = sin(a), corner = (u, v) => [x + u * c - v * s, y + u * s + v * c];
    return { t: "block", pts: ccw([corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h)]) };
  }
  if (type === "glass") return { t: "glass", pts: ccw(poly(x, y, a, rng.float(0.45, 0.85), rng.pick([3, 3, 4, 5]), rng, 0.2)), n: rng.pick([1.33, 1.5, 1.8]) };
  return { t: "lens", x, y, r: rng.float(0.35, 0.7), n: rng.pick([1.33, 1.5, 1.8]) };
}

function boundsOf(m) {
  if (m.pts && m.t !== "arc") { const xs = m.pts.map((p) => p[0]), ys = m.pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  if (m.segs) { const xs = m.segs.flatMap((s) => [s[0], s[2]]), ys = m.segs.flatMap((s) => [s[1], s[3]]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  return [m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r];
}
const overlap = (a, b, g) => a[0] < b[2] + g && b[0] < a[2] + g && a[1] < b[3] + g && b[1] < a[3] + g;

function build(rng, level) {
  const W = Math.round((8 + 2 * level + rng.float(-0.5, 0.5)) * 4) / 4, H = (W * 4) / 3;
  const world = { width: W, height: H };
  // emitter and target far apart
  const emitter = { x: rng.float(0.8, W - 0.8), y: rng.float(0.8, H - 0.8) };
  let target = null;
  for (let k = 0; k < 40 && !target; k++) {
    const t = { x: rng.float(0.9, W - 0.9), y: rng.float(0.9, H - 0.9) };
    if (hypot(t.x - emitter.x, t.y - emitter.y) > 0.55 * hypot(W, H)) target = t;
  }
  if (!target) return null;
  const pieces = [];
  const keepClear = [[emitter.x - 0.5, emitter.y - 0.5, emitter.x + 0.5, emitter.y + 0.5], [target.x - 0.55, target.y - 0.55, target.x + 0.55, target.y + 0.55]];
  const fits = (m) => {
    const b = boundsOf(m);
    if (b[0] < 0.35 || b[1] < 0.35 || b[2] > W - 0.35 || b[3] > H - 0.35) return false;
    if (keepClear.some((k) => overlap(b, k, 0))) return false;
    return !pieces.some((o) => overlap(boundsOf(o), b, 0.2));
  };
  // a block or two between the emitter and the target, so there's no straight shot
  for (let k = 0; k < 2; k++) {
    const u = rng.float(0.35, 0.65), x = emitter.x + (target.x - emitter.x) * u, y = emitter.y + (target.y - emitter.y) * u;
    const ang = atan2(target.y - emitter.y, target.x - emitter.x) + PI / 2, w = rng.float(0.15, 0.3), h = rng.float(0.5, 1.1);
    const c = cos(ang), s = sin(ang), corner = (p, q) => [x + q * c - p * s, y + q * s + p * c];
    const blk = { t: "block", pts: ccw([corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h)]) };
    if (fits(blk)) { pieces.push(blk); break; }
  }
  // lots of pieces everywhere
  const n = Math.round(14 + 8 * level) + rng.int(0, 4);
  for (let k = 0; k < n * 6 && pieces.length < n; k++) {
    const m = makePiece(rng, rng.float(0.8, W - 0.8), rng.float(0.8, H - 0.8), level);
    if (fits(m)) pieces.push(m);
  }
  // mirrored stretches of wall
  const nWall = rng.int(1, 3), segs = [];
  for (let k = 0; k < nWall; k++) {
    const side = rng.int(0, 3), len = rng.float(1.2, 3.5);
    if (side === 0 || side === 2) { const x = rng.float(0.2, W - 0.2 - len), y = side === 0 ? 0 : H; segs.push([x, y, x + len, y]); }
    else { const y = rng.float(0.2, H - 0.2 - len), x = side === 1 ? W : 0; segs.push([x, y, x, y + len]); }
  }
  pieces.push({ t: "wallMirror", segs });
  // Round to the millimetre NOW, exactly as the day file stores it, so the sweep (and every
  // later score) is computed on the very same geometry the players and the worker use.
  const r3 = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v)));
  return r3({ world, emitter, target, pieces });
}

function check(p, level) {
  const { world, emitter, target } = p;
  const d0 = hypot(target.x - emitter.x, target.y - emitter.y);
  // sweep every aim
  const sweep = new Array(SWEEP_N), hit = new Array(SWEEP_N);
  let hits = 0;
  for (let k = 0; k < SWEEP_N; k++) {
    const tr = traceBeam(p, emitter, sweepAngle(k), target);
    sweep[k] = Math.round(tr.closest * 100);
    hit[k] = tr.closest <= TARGET_R;
    if (hit[k]) {
      hits++;
      if (tr.hitAfterEvents < 2) return { ok: false, reason: "reachable with fewer than 2 bounces" };
    }
  }
  const share = hits / SWEEP_N;
  if (share === 0) return { ok: false, reason: "unreachable" };
  if (share > 0.03 - 0.015 * level) return { ok: false, reason: "too easy to hit" };
  // at least one aimable window (>= 0.5 degrees wide)
  let run = 0, best = 0;
  for (let k = 0; k < SWEEP_N * 2; k++) { run = hit[k % SWEEP_N] ? run + 1 : 0; best = Math.max(best, Math.min(run, SWEEP_N)); }
  if (best < 4) return { ok: false, reason: "hit window too narrow to aim at" };
  // aiming straight at the target must not be a good idea
  const straight = atan2(target.y - emitter.y, target.x - emitter.x);
  const puzzle = {
    format: "aim",
    world,
    question: "Aim the laser so the beam passes through the target.",
    emitter, target, pieces: p.pieces,
    previewLength: d0 / 2,
    sweep,
    answer: { hitShare: share, bestWindowDeg: (best * 360) / SWEEP_N },
    level,
    recordings: [], bodies: [],
  };
  const naive = scoreAim(puzzle, straight);
  if (naive > 70) return { ok: false, reason: "aiming straight at it is too good" };
  puzzle.naiveBot = naive;
  return { ok: true, puzzle };
}

/** The date's aim-the-laser puzzle. Deterministic. */
export function generateAim(date, { onReject } = {}) {
  const level = aimLevel(date);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = `predictle:${date}:aim:${attempt}`;
    const built = build(makeRng(seed), level);
    if (!built) { onReject?.("no room for a far target"); continue; }
    const r = check(built, level);
    if (r.ok) return { seed, attempt, ...r };
    onReject?.(r.reason);
  }
  throw new Error(`no aim puzzle for ${date}`);
}
