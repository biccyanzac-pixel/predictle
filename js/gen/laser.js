// Bonus round: the laser puzzle. A laser fires into a box of mirrors; where does the
// beam hit the wall? Pure geometry (no physics engine), generated from the date like
// the main rounds: the first seeded attempt that passes every check is the puzzle.
//
// Mirrors (all reflect on both sides):
//   flat   {t:"flat", x1,y1,x2,y2}
//   round  {t:"round", x,y,r}                      a mirrored post
//   arc    {t:"arc", x,y,r, mx,my, cosHalf, pts}  part of a circle: points p with
//                                                  dot((p-c)/r, m) >= cosHalf; pts for drawing
//   tri    {t:"tri", pts:[[x,y]x3]}               a mirrored triangle
//   square {t:"square", pts:[[x,y]x4]}            a mirrored square
//   vee    {t:"vee", pts:[[x,y]x3]}               two mirrors joined in a V (open)
//   block  {t:"block", pts:[[x,y]x4]}             a dark block that ABSORBS the beam (never hit by
//                                                 a generated puzzle's beam: it's there to block and mislead)
// Only deterministic maths (shared/dmath.js), so every browser traces the same beam.
import { makeRng } from "./rng.js";
import { sin, cos, hypot, PI } from "../shared/dmath.js";
import { scoreWall, perimeterPos } from "../shared/scoring.js";
import { weekdayOf } from "../shared/daily.js";

export const MAX_ATTEMPTS = 20000;
const EPS = 1e-9;

/** Bonus difficulty: 0.3 (Mon) .. 0.9 (Sun). */
export const laserLevel = (date) => 0.3 + 0.1 * weekdayOf(date);

function segments(m) {
  if (m.t === "flat") return [[m.x1, m.y1, m.x2, m.y2]];
  if (m.t === "tri" || m.t === "square" || m.t === "block") return m.pts.map((p, i) => [...p, ...m.pts[(i + 1) % m.pts.length]]);
  if (m.t === "vee") return [[...m.pts[0], ...m.pts[1]], [...m.pts[1], ...m.pts[2]]];
  return [];
}

/** Nearest hit of ray o + t d (t > EPS) with one mirror: { t, nx, ny, edge } or null. */
function hitMirror(o, d, m) {
  let best = null;
  const consider = (t, nx, ny, edge) => { if (t > 1e-7 && (!best || t < best.t)) best = { t, nx, ny, edge }; };
  for (const [x1, y1, x2, y2] of segments(m)) {
    const ex = x2 - x1, ey = y2 - y1;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < EPS) continue;
    const t = ((x1 - o.x) * ey - (y1 - o.y) * ex) / den;
    const u = ((x1 - o.x) * d.y - (y1 - o.y) * d.x) / den;
    if (u < 0 || u > 1) continue;
    const L = hypot(ex, ey);
    consider(t, -ey / L, ex / L, Math.min(u, 1 - u) * L); // edge = distance from the segment's ends
  }
  if (m.t === "round" || m.t === "arc") {
    const fx = o.x - m.x, fy = o.y - m.y;
    const b = fx * d.x + fy * d.y, c = fx * fx + fy * fy - m.r * m.r, disc = b * b - c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [-b - sq, -b + sq]) {
        const px = o.x + t * d.x, py = o.y + t * d.y, nx = (px - m.x) / m.r, ny = (py - m.y) / m.r;
        if (m.t === "arc") {
          const along = nx * m.mx + ny * m.my;
          if (along < m.cosHalf) continue;
          consider(t, nx, ny, (along - m.cosHalf) * m.r * 3); // rough distance from the arc's ends
        } else consider(t, nx, ny, Infinity);
      }
    }
  }
  return best;
}

/** Trace the beam. Returns { path, hits: [mirror index...], wall: {x,y}, minCos, minEdge } or { fail }. */
export function trace(world, emitter, mirrors, maxBounces = 24) {
  const W = world.width, H = world.height;
  let o = { x: emitter.x, y: emitter.y }, d = { x: emitter.dx, y: emitter.dy };
  const path = [[o.x, o.y]], hits = [];
  let minCos = 1, minEdge = Infinity;
  for (let bounce = 0; bounce <= maxBounces; bounce++) {
    let best = null, which = -1;
    mirrors.forEach((m, i) => { const h = hitMirror(o, d, m); if (h && (!best || h.t < best.t)) { best = h; which = i; } });
    // distance to the walls along d
    const tw = Math.min(d.x > 0 ? (W - o.x) / d.x : d.x < 0 ? -o.x / d.x : Infinity, d.y > 0 ? (H - o.y) / d.y : d.y < 0 ? -o.y / d.y : Infinity);
    if (!best || best.t >= tw) {
      const wall = { x: o.x + tw * d.x, y: o.y + tw * d.y };
      path.push([wall.x, wall.y]);
      return { path, hits, wall, minCos, minEdge };
    }
    o = { x: o.x + best.t * d.x, y: o.y + best.t * d.y };
    path.push([o.x, o.y]);
    if (mirrors[which].t === "block") return { fail: "hits a blocker", path };
    hits.push(which);
    const dn = d.x * best.nx + d.y * best.ny;
    minCos = Math.min(minCos, Math.abs(dn));
    minEdge = Math.min(minEdge, best.edge);
    d = { x: d.x - 2 * dn * best.nx, y: d.y - 2 * dn * best.ny };
    const L = hypot(d.x, d.y);
    d = { x: d.x / L, y: d.y / L };
  }
  return { fail: "beam trapped" };
}

function boundsOf(m) {
  if (m.t === "flat") return [Math.min(m.x1, m.x2), Math.min(m.y1, m.y2), Math.max(m.x1, m.x2), Math.max(m.y1, m.y2)];
  if (m.pts && m.t !== "arc") { const xs = m.pts.map((p) => p[0]), ys = m.pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  return [m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r];
}
const overlap = (a, b, g) => a[0] < b[2] + g && b[0] < a[2] + g && a[1] < b[3] + g && b[1] < a[3] + g;

function polygon(x, y, a, size, n, jitter, rng) {
  const pts = [];
  for (let j = 0; j < n; j++) { const t = a + (2 * PI * j) / n + (jitter ? rng.float(-jitter, jitter) : 0); pts.push([x + size * cos(t), y + size * sin(t)]); }
  return pts;
}

function makeMirror(rng, x, y, a, decoy = false) {
  const type = rng.weighted({ flat: 3, round: 2.2, arc: 2.6, tri: 1.6, square: 1.4, vee: 1.6, block: decoy ? 2.5 : 0 });
  if (type === "flat") {
    const h = rng.float(0.4, 1.2);
    return { t: "flat", x1: x - h * cos(a), y1: y - h * sin(a), x2: x + h * cos(a), y2: y + h * sin(a) };
  }
  if (type === "round") return { t: "round", x, y, r: rng.float(0.25, 0.6) };
  if (type === "arc") {
    // the arc passes near (x, y): its centre sits r behind it, facing direction a
    const r = rng.float(0.6, 1.4), half = rng.float(0.5, 1.1), cx = x - r * cos(a), cy = y - r * sin(a);
    const pts = [];
    for (let j = 0; j <= 16; j++) { const t = a - half + (2 * half * j) / 16; pts.push([cx + r * cos(t), cy + r * sin(t)]); }
    return { t: "arc", x: cx, y: cy, r, mx: cos(a), my: sin(a), cosHalf: cos(half), pts };
  }
  if (type === "tri") return { t: "tri", pts: polygon(x, y, a, rng.float(0.35, 0.75), 3, 0.25, rng) };
  if (type === "square") return { t: "square", pts: polygon(x, y, a, rng.float(0.3, 0.6), 4, 0, rng) };
  if (type === "block") return { t: "block", pts: polygon(x, y, a, rng.float(0.3, 0.7), 4, 0, rng) };
  // vee: two arms from a corner at (x, y)
  const L1 = rng.float(0.45, 0.9), L2 = rng.float(0.45, 0.9), open = rng.float(0.6, 1.6);
  return { t: "vee", pts: [[x + L1 * cos(a - open / 2), y + L1 * sin(a - open / 2)], [x, y], [x + L2 * cos(a + open / 2), y + L2 * sin(a + open / 2)]] };
}

function build(rng, level) {
  const W = Math.round((7 + 3 * level + rng.float(-0.5, 0.5)) * 4) / 4, H = (W * 4) / 3;
  const world = { width: W, height: H };
  const ea = rng.float(0, 2 * PI);
  const emitter = { x: rng.float(0.8, W - 0.8), y: rng.float(0.8, H - 0.8), dx: cos(ea), dy: sin(ea) };
  const emitterBox = [emitter.x - 0.45, emitter.y - 0.45, emitter.x + 0.45, emitter.y + 0.45];
  const mirrors = [];
  const fits = (m) => {
    const b = boundsOf(m);
    if (b[0] < 0.5 || b[1] < 0.5 || b[2] > W - 0.5 || b[3] > H - 0.5) return false;
    if (overlap(b, emitterBox, 0)) return false;
    return !mirrors.some((o) => overlap(boundsOf(o), b, 0.25));
  };
  // Mirrors on the beam: trace, put a mirror somewhere on the last stretch, trace again.
  const onPath = Math.round(5 + 4 * level) + rng.int(0, 2);
  for (let k = 0; k < onPath; k++) {
    const tr = trace(world, emitter, mirrors);
    if (tr.fail) break;
    const [ax, ay] = tr.path.at(-2), [bx, by] = tr.path.at(-1);
    for (let attempt = 0; attempt < 8; attempt++) {
      const u = rng.float(0.25, 0.8), x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
      const m = makeMirror(rng, x, y, rng.float(0, 2 * PI));
      if (m.t !== "block" && fits(m)) { mirrors.push(m); break; }
    }
  }
  // Decoys anywhere free.
  const decoys = rng.int(4, 6 + Math.round(4 * level));
  for (let k = 0; k < decoys * 6 && decoys > 0; k++) {
    const m = makeMirror(rng, rng.float(0.9, W - 0.9), rng.float(0.9, H - 0.9), rng.float(0, 2 * PI), true);
    if (fits(m)) { mirrors.push(m); if (mirrors.length >= onPath + decoys) break; }
  }
  return { world, emitter, mirrors };
}

function check(p, level) {
  const { world, emitter, mirrors } = p;
  const W = world.width, H = world.height, P = 2 * (W + H);
  const tr = trace(world, emitter, mirrors);
  if (tr.fail) return { ok: false, reason: tr.fail };
  const minBounces = 4 + Math.round(level * 3);
  if (tr.hits.length < minBounces) return { ok: false, reason: "too few reflections" };
  if (tr.hits.length > 16) return { ok: false, reason: "too many reflections" };
  if (new Set(tr.hits).size < Math.min(3, minBounces)) return { ok: false, reason: "too few different mirrors" };
  if (tr.minCos < 0.12) return { ok: false, reason: "a grazing reflection" };
  if (tr.minEdge < 0.08) return { ok: false, reason: "clips a mirror's edge" };
  const { x, y } = tr.wall;
  if ((x < 0.4 || x > W - 0.4) && (y < 0.4 || y > H - 0.4)) return { ok: false, reason: "hits a corner" };

  // Fairness: nudging the aim (+-0.15 deg) or the emitter (+-1 px) mustn't change the answer much.
  const px = W / 1080, da = 0.15 * PI / 180;
  for (const [ddx, dang] of [[px, 0], [-px, 0], [0, da], [0, -da]]) {
    const c = cos(dang), s = sin(dang);
    const e = { x: emitter.x + ddx, y: emitter.y, dx: emitter.dx * c - emitter.dy * s, dy: emitter.dx * s + emitter.dy * c };
    const t2 = trace(world, e, mirrors);
    if (t2.fail || t2.hits.join() !== tr.hits.join()) return { ok: false, reason: "chaos: a nudge changes the path" };
    const a = perimeterPos(t2.wall, world), b = perimeterPos(tr.wall, world);
    if (Math.min(Math.abs(a - b), P - Math.abs(a - b)) > 0.02 * P) return { ok: false, reason: "chaos: too sensitive" };
  }

  // Not obvious: "straight on to the wall" and "one reflection then straight" must miss.
  const straight = trace(world, emitter, []).wall;
  void straight;
  const oneBounce = trace(world, emitter, mirrors, 1);
  const firstOnly = oneBounce.fail ? straight : oneBounce.wall;
  const naive = Math.max(scoreWall(straight, tr.wall, world), scoreWall(firstOnly, tr.wall, world));
  if (naive > 70 - 30 * level) return { ok: false, reason: "too obvious" };

  return {
    ok: true,
    puzzle: {
      format: "laser",
      world,
      question: "Where will the laser hit the wall? Tap the edge.",
      emitter,
      mirrors,
      answer: { hit: tr.wall, path: tr.path, bounces: tr.hits.length },
      level,
      naiveBot: naive,
      recordings: [],
      bodies: [],
    },
  };
}

/** The date's laser puzzle. Deterministic. */
export function generateLaser(date, { onReject } = {}) {
  const level = laserLevel(date);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = `predictle:${date}:laser:${attempt}`;
    const r = check(build(makeRng(seed), level), level);
    if (r.ok) return { seed, attempt, ...r };
    onReject?.(r.reason);
  }
  throw new Error(`no laser puzzle for ${date}`);
}
