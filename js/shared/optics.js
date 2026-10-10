// Optics for the "aim the laser" bonus round. Shared by the generator, the game and the
// leaderboard worker, so all three trace exactly the same beam (deterministic maths only).
//
// Pieces (world metres, y up):
//   mirror  {t:"mirror", segs:[[x1,y1,x2,y2],...]}  reflective segments (flat, V, polygon outlines)
//   ball    {t:"ball", x,y,r}                       mirrored post (reflects)
//   arc     {t:"arc", x,y,r, mx,my, cosHalf, pts}   curved mirror: points p on the circle with
//                                                   dot((p-c)/r, m) >= cosHalf; pts only for drawing
//   block   {t:"block", pts:[[x,y]...]}             opaque: ABSORBS the beam
//   glass   {t:"glass", pts:[[x,y]...], n}          transparent polygon that bends light (index n)
//   lens    {t:"lens", x,y,r, n}                    transparent disc that bends light (index n)
//   wallMirror {t:"wallMirror", segs:[[x1,y1,x2,y2]]} mirrored parts of the arena walls
// The arena walls absorb everywhere else, so a beam always ends.
import { hypot, cos, sin } from "./dmath.js";

export const TARGET_R = 0.28;      // hitting within this of the target's centre is a hit
export const MAX_EVENTS = 40;      // reflections + refractions before we give up
export const SWEEP_N = 2880;       // aim samples (every 0.125 degrees) stored for scoring
const EPS = 1e-7;

function polySegs(pts) { return pts.map((p, i) => [...p, ...pts[(i + 1) % pts.length]]); }
function signedArea(pts) { let a = 0; pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }); return a / 2; }

/** Nearest surface hit of ray (o, d) with piece m: { t, nx, ny, kind, edge } with n the OUTWARD normal. */
function hitPiece(o, d, m) {
  let best = null;
  const consider = (t, nx, ny, edge) => { if (t > EPS && (!best || t < best.t)) best = { t, nx, ny, edge }; };
  const segs = m.t === "mirror" || m.t === "wallMirror" ? m.segs : m.t === "block" || m.t === "glass" ? polySegs(m.pts) : null;
  if (segs) {
    const ccw = m.pts ? signedArea(m.pts) > 0 : true;
    for (const [x1, y1, x2, y2] of segs) {
      const ex = x2 - x1, ey = y2 - y1, den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((x1 - o.x) * ey - (y1 - o.y) * ex) / den, u = ((x1 - o.x) * d.y - (y1 - o.y) * d.x) / den;
      if (u < 0 || u > 1) continue;
      const L = hypot(ex, ey);
      // outward normal for polygons; for open mirrors either side works (we flip below)
      const nx = ccw ? ey / L : -ey / L, ny = ccw ? -ex / L : ex / L;
      consider(t, nx, ny, Math.min(u, 1 - u) * L);
    }
  }
  if (m.t === "ball" || m.t === "arc" || m.t === "lens") {
    const fx = o.x - m.x, fy = o.y - m.y, b = fx * d.x + fy * d.y, c = fx * fx + fy * fy - m.r * m.r, disc = b * b - c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [-b - sq, -b + sq]) {
        const px = o.x + t * d.x, py = o.y + t * d.y, nx = (px - m.x) / m.r, ny = (py - m.y) / m.r;
        if (m.t === "arc") {
          const along = nx * m.mx + ny * m.my;
          if (along < m.cosHalf) continue;
          consider(t, nx, ny, (along - m.cosHalf) * m.r * 3);
        } else consider(t, nx, ny, Infinity);
      }
    }
  }
  if (best) best.kind = m.t === "block" ? "absorb" : m.t === "glass" || m.t === "lens" ? "refract" : "reflect";
  return best;
}

function wallHit(o, d, W, H) {
  return Math.min(d.x > 0 ? (W - o.x) / d.x : d.x < 0 ? -o.x / d.x : Infinity, d.y > 0 ? (H - o.y) / d.y : d.y < 0 ? -o.y / d.y : Infinity);
}

/** Distance from point p to segment ab. */
export function segDist(p, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
  const u = L2 ? Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.y - ay) * ey) / L2)) : 0;
  return hypot(p.x - (ax + u * ex), p.y - (ay + u * ey));
}

/**
 * Trace a beam from `from` at angle `a` (radians).
 * Returns { path: [[x,y]...], events, minCos, minEdge, closest, closestAt:{x,y}, hitAfterEvents }.
 * closest = nearest the beam ever gets to `target` (if given).
 */
export function traceBeam(scene, from, a, target = null) {
  const { width: W, height: H } = scene.world;
  let o = { x: from.x, y: from.y }, d = { x: cos(a), y: sin(a) };
  const path = [[o.x, o.y]];
  let events = 0, minCos = 1, minEdge = Infinity, closest = Infinity, closestAt = null, hitAfterEvents = null;
  const note = (ax, ay, bx, by) => {
    if (!target) return;
    const dist = segDist(target, ax, ay, bx, by);
    if (dist < closest) {
      closest = dist;
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
      const u = L2 ? Math.max(0, Math.min(1, ((target.x - ax) * ex + (target.y - ay) * ey) / L2)) : 0;
      closestAt = { x: ax + u * ex, y: ay + u * ey };
    }
    if (dist <= TARGET_R && hitAfterEvents === null) hitAfterEvents = events;
  };
  for (; events <= MAX_EVENTS; ) {
    let best = null, piece = null;
    for (const m of scene.pieces) { const h = hitPiece(o, d, m); if (h && (!best || h.t < best.t)) { best = h; piece = m; } }
    const tw = wallHit(o, d, W, H);
    if (!best || best.t >= tw) {
      const end = { x: o.x + tw * d.x, y: o.y + tw * d.y };
      note(o.x, o.y, end.x, end.y);
      path.push([end.x, end.y]);
      break; // plain wall: absorbed
    }
    const p = { x: o.x + best.t * d.x, y: o.y + best.t * d.y };
    note(o.x, o.y, p.x, p.y);
    path.push([p.x, p.y]);
    if (best.kind === "absorb") break;
    events++;
    minEdge = Math.min(minEdge, best.edge);
    let nx = best.nx, ny = best.ny, dn = d.x * nx + d.y * ny;
    minCos = Math.min(minCos, Math.abs(dn));
    if (best.kind === "reflect") {
      d = { x: d.x - 2 * dn * nx, y: d.y - 2 * dn * ny };
    } else {
      // Snell's law. Entering if moving against the outward normal.
      const entering = dn < 0, eta = entering ? 1 / piece.n : piece.n;
      if (!entering) { nx = -nx; ny = -ny; dn = -dn; }      // make n face the incoming beam
      const ci = -dn, k = 1 - eta * eta * (1 - ci * ci);
      if (k < 0) d = { x: d.x + 2 * ci * nx, y: d.y + 2 * ci * ny }; // total internal reflection
      else { const s = eta * ci - Math.sqrt(k); d = { x: eta * d.x + s * nx, y: eta * d.y + s * ny }; }
    }
    const L = hypot(d.x, d.y);
    d = { x: d.x / L, y: d.y / L };
    o = { x: p.x + d.x * 1e-6, y: p.y + d.y * 1e-6 };
  }
  return { path, events, minCos, minEdge, closest, closestAt, hitAfterEvents };
}

/** Distance along the beam, for drawing it up to a length. */
export function pathLength(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return L;
}

export const sweepAngle = (k) => (2 * Math.PI * k) / SWEEP_N;

/**
 * Bonus score for an aim. A hit is 100. Otherwise it's how many of all possible aims
 * (the stored sweep, every 0.125 deg) get the beam less close to the target than yours:
 * score = 100 * share^2. So 0 is the worst possible aim, and a near miss that beats
 * 95% of aims scores 90.
 */
export function scoreAim(puzzle, a) {
  const tr = traceBeam(puzzle, puzzle.emitter, a, puzzle.target);
  if (tr.closest <= TARGET_R) return 100;
  const mine = Math.round(tr.closest * 100); // sweep is stored in centimetres
  // only aims that are strictly worse count, so the worst possible aim (often a large tie:
  // every beam that never gets closer than its starting point) scores 0
  let worse = 0;
  for (const v of puzzle.sweep) if (v > mine) worse++;
  const share = worse / puzzle.sweep.length;
  return Math.min(99.9, 100 * share * share);
}
