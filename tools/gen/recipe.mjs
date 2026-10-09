// Random contraption recipe: frame + start piece + 2-6 middle pieces + an end piece.
//
// Pieces are placed *on the ball's path*: after each piece is added, the scene is
// simulated briefly and the next piece goes where the ball is actually heading.
// That makes most candidates interesting (the ball meets most pieces) instead of
// the ball falling straight past randomly scattered parts.
import { simulate, dominoX } from "../sim/simulate.mjs";

export const WORLD_WIDTHS = [7.5, 9, 10.5]; // aspect is always 3:4; scale varies per puzzle
const FLOOR_Y = 0.16; // top of the floor bar

// Axis-aligned bounds of a component, for the "no overlapping pieces" rule.
export function bounds(c) {
  const pad = (x1, y1, x2, y2, p = 0) => [Math.min(x1, x2) - p, Math.min(y1, y2) - p, Math.max(x1, x2) + p, Math.max(y1, y2) + p];
  switch (c.type) {
    case "ramp": case "wall": return pad(c.x1, c.y1, c.x2, c.y2, (c.t ?? 0.12) / 2);
    case "curve": {
      const xs = [], ys = [];
      for (let k = 0; k <= 12; k++) { const a = c.a0 + ((c.a1 - c.a0) * k) / 12; xs.push(c.cx + c.r * Math.cos(a)); ys.push(c.cy + c.r * Math.sin(a)); }
      return pad(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 0.08);
    }
    case "bumper": return pad(c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r);
    case "chute": return c.dir === "down" || !c.dir
      ? pad(c.x - c.w / 2 - 0.1, c.y, c.x + c.w / 2 + 0.1, c.y + c.h)
      : pad(c.x, c.y - c.w / 2 - 0.1, c.x - (c.dir === "right" ? 1 : -1) * c.h, c.y + c.w / 2 + 0.1);
    case "seesaw": return pad(c.x - c.half, c.y - 0.45, c.x + c.half, c.y + 0.5);
    case "spring": return pad(c.x - c.w / 2, c.y - c.stroke - 0.2, c.x + c.w / 2, c.y + 0.1);
    case "conveyor": return pad(c.x1, c.y - 0.1, c.x2, c.y + 0.1);
    case "pendulum": return pad(c.px - c.r - 0.1, c.py - c.len - c.r, c.px + c.r + 0.1, c.py + 0.1);
    case "dominoes": return pad(c.x0 - c.w, c.y, dominoX(c, c.n - 1) + c.w, c.y + c.h);
    case "fan": return null; // a zone, may overlap things
    case "ball": return pad(c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r);
    default: return null;
  }
}

export let lastFailure = null;
const fail = (why) => { lastFailure = why; return null; };
const overlaps = (a, b, m = 0.18) => a && b && a[0] < b[2] + m && b[0] < a[2] + m && a[1] < b[3] + m && b[1] < a[3] + m;

export function frame(W, H) {
  return [
    { type: "wall", x1: 0.08, y1: 0, x2: 0.08, y2: H, frame: true },
    { type: "wall", x1: W - 0.08, y1: 0, x2: W - 0.08, y2: H, frame: true },
    { type: "wall", x1: 0, y1: 0.08, x2: W, y2: 0.08, frame: true, floor: true },
  ];
}

/** Main-ball path of a (partial) scene: positions at 30 fps for up to `seconds`. */
export async function mainPath(scene, seconds = 7) {
  const out = await simulate(scene, { maxSeconds: seconds, settleTail: 0 });
  const t = out.recording.bodies[out.mainIndex];
  return t.x.map((x, f) => ({ x, y: t.y[f], f, vx: f ? (x - t.x[f - 1]) * 30 : 0, vy: f ? (t.y[f] - t.y[f - 1]) * 30 : 0 }));
}

const MIDDLE = {
  ramp: 6, curve: 2, bumper: 3, seesaw: 2, spring: 2, conveyor: 2, fan: 1.5, pendulum: 1.5,
};

/** One middle piece of `type` placed so the ball at path point P is likely to hit it. */
function piece(rng, type, P, r, W, H) {
  const towardCentre = P.x < W / 2 ? 1 : -1;
  const below = P.y - r;
  switch (type) {
    case "ramp": {
      const L = rng.float(1.4, 3.2), th = rng.float(0.15, 0.55);
      const d = rng.chance(0.65) ? towardCentre : rng.sign(); // descends towards +d
      const f = rng.float(0.15, 0.5);
      const qx = P.x, qy = below - 0.08;
      const x1 = qx - d * f * L * Math.cos(th), y1 = qy + f * L * Math.sin(th);
      return { type, x1, y1, x2: x1 + d * L * Math.cos(th), y2: y1 - L * Math.sin(th), material: rng.weighted({ wood: 5, ice: 2, rubber: 1, steel: 1 }) };
    }
    case "curve": {
      const R = rng.float(0.8, 1.5), span = rng.float(1.2, 2.2), lean = rng.float(0.15, 0.4) * rng.sign();
      const mid = -Math.PI / 2 + lean;
      return { type, cx: P.x + rng.float(-0.3, 0.3) * R, cy: below - 0.08 + R, r: R, a0: mid - span / 2, a1: mid + span / 2, material: rng.weighted({ wood: 4, ice: 2, steel: 1 }) };
    }
    case "bumper":
      return { type, x: P.x + rng.sign() * rng.float(0.05, 0.35), y: P.y - rng.float(0.35, 0.7), r: rng.float(0.2, 0.38) };
    case "seesaw": {
      const half = rng.float(0.9, 1.6), off = rng.float(0.45, half * 0.85), s = rng.sign();
      return { type, x: P.x + s * off, y: below - 0.5, half, material: rng.weighted({ wood: 4, steel: 1 }) };
    }
    case "spring":
      return { type, x: P.x + rng.float(-0.25, 0.25), y: below - rng.float(0.25, 0.5), w: rng.float(0.8, 1.3), stroke: rng.float(0.3, 0.5), hertz: rng.float(3.5, 7) };
    case "conveyor": {
      const L = rng.float(1.6, 3), dir = rng.sign(), f = rng.float(0.2, 0.5);
      const start = P.x - dir * f * L; // upstream end
      return { type, x1: Math.min(start, start + dir * L), x2: Math.max(start, start + dir * L), y: below - 0.12, speed: dir * rng.float(1, 3) };
    }
    case "fan": {
      const w = rng.float(1.4, 2.4), h = rng.float(2, 3.4);
      const x1 = P.x - w * rng.float(0.2, 0.8), y2 = P.y + 0.3;
      return { type, x1, y1: y2 - h, x2: x1 + w, y2, ax: rng.sign() * rng.float(4, 9), ay: rng.float(-1, 3) };
    }
    case "pendulum": {
      const len = rng.float(0.9, 1.6), rb = rng.float(0.2, 0.3);
      const bx = P.x + rng.sign() * rng.float(0.1, 0.3), by = P.y - rng.float(0.1, 0.5);
      return { type, px: bx, py: by + len, len, r: rb, angle: 0, material: rng.weighted({ steel: 3, wood: 2, rubber: 1 }) };
    }
  }
  return null;
}

function inBounds(b, W, H) {
  return b && b[0] > 0.2 && b[2] < W - 0.2 && b[1] > FLOOR_Y + 0.25 && b[3] < H - 0.15;
}

/**
 * Build a candidate scene for a question format. Returns { scene, extra } or null.
 * extra carries format-specific pieces (e.g. the bumper candidates for "place").
 */
export async function buildScene(rng, format) {
  const W = rng.pick(WORLD_WIDTHS), H = (W * 4) / 3;
  const comps = frame(W, H);
  const r = rng.float(0.17, 0.24);
  const ballMaterial = rng.weighted({ wood: 4, steel: 3, rubber: 2, ice: 1 });

  // Start piece: a downward chute or a sideways launcher, near the top.
  const sx = rng.float(0.18 * W, 0.82 * W), sy = H - rng.float(0.6, 1.1);
  let ball;
  if (rng.chance(0.4)) {
    comps.push({ type: "chute", dir: "down", x: sx, y: sy - 0.5, w: 2 * r + 0.08, h: 0.9 });
    ball = { type: "ball", x: sx, y: sy, r, material: ballMaterial, vx: 0, vy: -rng.float(0.5, 2), role: "main", label: "A" };
  } else {
    const dir = sx < W / 2 ? "right" : "left", s = dir === "right" ? 1 : -1;
    comps.push({ type: "chute", dir, x: sx, y: sy, w: 2 * r + 0.08, h: 0.8 });
    ball = { type: "ball", x: sx - s * 0.35, y: sy, r, material: ballMaterial, vx: s * rng.float(0.8, 3.2), vy: 0, role: "main", label: "A" };
  }
  comps.push(ball);
  const scene = { world: { width: W, height: H }, components: comps };

  const nMiddle = rng.int(2, format === "dominoes" ? 4 : 6);
  let lastY = sy - 0.3;
  for (let k = 0; k < nMiddle; k++) {
    const path = await mainPath(scene, 6);
    const gap = rng.float(0.5, 1.4);
    const lowest = format === "height" ? 2.6 : format === "dominoes" ? 2.4 : 2.1; // leave room below for a launch / the end piece
    const P = path.find((p) => p.f > 3 && p.y < lastY - gap && p.y > lowest && p.vy < 0.5 && p.x > 0.5 && p.x < W - 0.5);
    if (!P) break;
    let placed = false;
    for (let attempt = 0; attempt < 6 && !placed; attempt++) {
      const weights = { ...MIDDLE };
      if (format === "height" && k === nMiddle - 1) Object.assign(weights, { spring: 8, seesaw: 3, bumper: 3 });
      const c = piece(rng, rng.weighted(weights), P, r, W, H);
      const b = bounds(c);
      if (c.type !== "fan" && !inBounds(b, W, H)) continue;
      if (c.type === "fan" && (c.x1 < 0.2 || c.x2 > W - 0.2 || c.y1 < FLOOR_Y + 0.4 || c.y2 > H - 0.2)) continue;
      if (c.type !== "fan" && comps.some((o) => !o.frame && o !== ball && overlaps(b, bounds(o)))) continue;
      if (c.type === "fan" && comps.some((o) => o.type === "fan")) continue;
      // the ball's starting spot must stay clear
      if (c.type !== "fan" && overlaps(b, bounds(ball), 0.3)) continue;
      comps.push(c);
      lastY = Math.min(P.y, b ? b[1] : P.y);
      placed = true;
    }
  }

  // End piece.
  if (format === "dominoes") {
    // Half the floor tilts down towards a row of dominoes on the other half, on
    // whichever side the ball lands, so the ball arrives rolling.
    const path = await mainPath(scene, 8);
    const land = path.find((p) => p.f > 3 && p.y < 1.6) ?? path.at(-1);
    const dir = land.x < W / 2 ? 1 : -1; // slope descends towards +dir
    const hi = rng.float(0.9, 1.4), mid = W * rng.float(0.45, 0.55);
    const slope = dir > 0
      ? { type: "ramp", x1: 0.16, y1: hi, x2: mid, y2: 0.3, material: rng.weighted({ wood: 3, ice: 1 }) }
      : { type: "ramp", x1: W - 0.16, y1: hi, x2: W - mid, y2: 0.3, material: rng.weighted({ wood: 3, ice: 1 }) };
    if (comps.some((o) => !o.frame && o !== ball && overlaps(bounds(slope), bounds(o), 0.15))) return fail("dominoes: slope overlaps");
    comps.push(slope);
    const n = rng.int(5, 9), h = rng.float(0.55, 0.8), gap = h * rng.float(0.45, 0.6);
    let breakAt = null, breakGap = null;
    if (rng.chance(0.6)) breakAt = rng.int(2, n - 2), breakGap = h * rng.float(1.3, 1.7); // one clearly wide gap: not everything falls
    const span = (n - 1) * gap + (breakAt === null ? 0 : breakGap - gap);
    const first = slope.x2 + dir * rng.float(0.5, 0.9);
    const x0 = dir > 0 ? first : first - span;
    const row = { type: "dominoes", x0, y: FLOOR_Y, n, gap, w: 0.1, h, material: rng.weighted({ wood: 3, steel: 1 }), breakAt, breakGap };
    if (dir < 0 && breakAt !== null) row.breakAt = n - breakAt; // same distance from the ball's end
    if (x0 < 0.4 || x0 + span > W - 0.4) return fail("dominoes: row doesn't fit");
    if (comps.some((o) => !o.frame && o !== ball && o !== slope && overlaps(bounds(row), bounds(o), 0.1))) return fail("dominoes overlap");
    comps.push(row);
  }

  // Terrain floor for "where does it stop" formats: low hills and valleys, raised at
  // the ends, so the ball settles somewhere you can reason about instead of a corner.
  if (["stop", "freeze", "place"].includes(format) && rng.chance(0.85)) {
    // alternating valleys and low peaks, steep enough (~15-25 deg) that a ball settles quickly
    const k = 2 * rng.int(2, 4), xs = [0.16], ys = [rng.float(0.85, 1.1)];
    for (let j = 1; j < k; j++) { xs.push(0.16 + ((W - 0.32) * j) / k + rng.float(-0.15, 0.15)); ys.push(j % 2 ? rng.float(0.18, 0.3) : rng.float(0.5, 0.8)); }
    xs.push(W - 0.16); ys.push(rng.float(0.85, 1.1));
    const material = rng.weighted({ wood: 5, ice: 1 });
    for (let j = 0; j < xs.length - 1; j++) {
      const seg = { type: "ramp", x1: xs[j], y1: ys[j], x2: xs[j + 1], y2: ys[j + 1], t: 0.14, material, frame: true, terrain: true };
      if (comps.some((o) => !o.frame && o !== ball && overlaps(bounds(seg), bounds(o), 0.15))) return fail("terrain overlaps a piece");
      comps.push(seg);
    }
  }

  let extra = null;
  if (format === "place") {
    // Six places the player can put one bumper, across the ball's path at one height.
    const path = await mainPath(scene, 8);
    const ys = path.filter((p) => p.y > 2.7 && p.y < H - 2 && p.vy < 0); // spots stay well above the floor
    if (ys.length < 4) return fail("place: path too short");
    const br = rng.float(0.25, 0.35), spreadX = W * 0.17;
    const tryAt = (P) => {
      const y = P.y - 0.45, out = [];
      for (const o of [-1.6, -0.8, -0.25, 0.25, 0.8, 1.6]) {
        let c = null;
        for (let t = 0; t < 8 && !c; t++) {
          const x = Math.max(0.3 + br, Math.min(W - 0.3 - br, P.x + o * spreadX * 0.6 + rng.float(-0.12, 0.12)));
          const cand = { type: "bumper", x, y: y + rng.float(-0.2, 0.2) + (t % 2 ? 1 : -1) * 0.25 * Math.floor(t / 2), r: br };
          const b = bounds(cand);
          if (!inBounds(b, W, H)) continue;
          if (comps.some((o2) => !o2.frame && overlaps(b, bounds(o2), 0.1))) continue;
          if (out.some((o2) => Math.hypot(o2.x - cand.x, o2.y - cand.y) < 2 * br + 0.15)) continue;
          c = cand;
        }
        if (!c) return null;
        out.push(c);
      }
      return out;
    };
    // try heights along the path (in a seeded random order) until six spots fit
    const order = ys.map((p, i) => [rng.next(), i]).sort((a, b) => a[0] - b[0]).slice(0, 25);
    let candidates = null;
    for (const [, i] of order) if ((candidates = tryAt(ys[i]))) break;
    if (!candidates) return fail("place: no height with room for six bumper spots");
    extra = { candidates };
  }

  return { scene, extra };
}
