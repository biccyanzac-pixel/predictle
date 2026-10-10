// Building blocks for random contraptions (used by daily.mjs).
//
// Pieces are placed *on the ball's path*: after each piece is added, the scene is
// simulated briefly and the next piece goes where the ball is actually heading.
// That makes most candidates interesting (the ball meets most pieces) instead of
// the ball falling straight past randomly scattered parts.
import { simulate, dominoX } from "../sim/simulate.js";
import { sin, cos } from "../shared/dmath.js";

export const WORLD_WIDTHS = [7.5, 9, 10.5]; // aspect is always 3:4; scale varies per puzzle
const FLOOR_Y = 0.16; // top of the floor bar

// Axis-aligned bounds of a component, for the "no overlapping pieces" rule.
export function bounds(c) {
  const pad = (x1, y1, x2, y2, p = 0) => [Math.min(x1, x2) - p, Math.min(y1, y2) - p, Math.max(x1, x2) + p, Math.max(y1, y2) + p];
  switch (c.type) {
    case "ramp": case "wall": return pad(c.x1, c.y1, c.x2, c.y2, (c.t ?? 0.12) / 2);
    case "curve": {
      const xs = [], ys = [];
      for (let k = 0; k <= 12; k++) { const a = c.a0 + ((c.a1 - c.a0) * k) / 12; xs.push(c.cx + c.r * cos(a)); ys.push(c.cy + c.r * sin(a)); }
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
    case "fan": case "lowgrav": return null; // zones may overlap things
    case "pegs": return pad(c.x1 - c.r, c.y2 - (c.rows - 1) * c.sy - c.r, c.x2 + c.sx / 2 + c.r, c.y2 + c.r);
    case "spinner": return pad(c.x - c.arm, c.y - c.arm, c.x + c.arm, c.y + c.arm, 0.05);
    case "funnel": return pad(c.x - c.gap / 2 - c.w, c.y - 0.06, c.x + c.gap / 2 + c.w, c.y + c.h + 0.06);
    case "ball": return pad(c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r);
    case "block": return pad(c.x - c.hw, c.y - c.hh, c.x + c.hw, c.y + c.hh);
    case "sand": return pad(c.x1, c.y - (c.depth ?? 0.14), c.x2, c.y);
    default: return null;
  }
}

export const overlaps = (a, b, m = 0.18) => a && b && a[0] < b[2] + m && b[0] < a[2] + m && a[1] < b[3] + m && b[1] < a[3] + m;

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

export const MIDDLE = {
  ramp: 5, curve: 2, bumper: 3, seesaw: 2, spring: 2, conveyor: 2, fan: 1.5, pendulum: 1.5,
  shelf: 2, spinner: 1.5, funnel: 1.2, lowgrav: 1.5, pegs: 5,
};

/** One middle piece of `type` placed so the ball at path point P is likely to hit it. */
export function piece(rng, type, P, r, W, H) {
  const towardCentre = P.x < W / 2 ? 1 : -1;
  const below = P.y - r;
  switch (type) {
    case "ramp": {
      // switchbacks: usually slope back against the ball's motion, so it zig-zags down slowly
      const L = rng.float(1.6, 3.4), th = rng.float(0.12, 0.42);
      const back = P.vx > 0.2 ? -1 : P.vx < -0.2 ? 1 : towardCentre;
      const d = rng.chance(0.6) ? back : rng.chance(0.65) ? towardCentre : rng.sign(); // descends towards +d
      const f = rng.float(0.15, 0.5);
      const qx = P.x, qy = below - 0.08;
      const x1 = qx - d * f * L * cos(th), y1 = qy + f * L * sin(th);
      return { type, x1, y1, x2: x1 + d * L * cos(th), y2: y1 - L * sin(th), material: rng.weighted({ wood: 5, ice: 2, rubber: 1, steel: 1 }) };
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
    case "shelf": {
      // A short ledge under the path, sometimes with a loose ball or block sitting on it
      // where the object will arrive: returns [shelf] or [shelf, loose object].
      const w = rng.float(0.9, 1.8), tilt = rng.float(-0.12, 0.12), x1 = P.x - w * rng.float(0.25, 0.75);
      const y = below - 0.1, shelf = { type: "ramp", x1, y1: y - tilt * w / 2, x2: x1 + w, y2: y + tilt * w / 2, t: 0.12, material: rng.weighted({ wood: 4, ice: 2, steel: 1, rubber: 1 }) };
      if (!rng.chance(0.55)) return shelf;
      const dir = P.vx >= 0 ? 1 : -1, ox = P.x + dir * rng.float(0.35, 0.7);
      if (ox < x1 + 0.2 || ox > x1 + w - 0.2) return shelf;
      const sy = y + tilt * ((ox - x1) / w - 0.5) * w + 0.06;
      const loose = rng.chance(0.6)
        ? { type: "ball", x: ox, y: sy + 0.18, r: rng.float(0.14, 0.24), material: rng.weighted({ wood: 3, steel: 2, rubber: 2, ice: 1 }) }
        : { type: "block", x: ox, y: sy + 0.2, hw: rng.float(0.12, 0.22), hh: rng.float(0.12, 0.2), material: rng.weighted({ wood: 3, steel: 2, ice: 1 }) };
      if (loose.type === "block") loose.y = sy + loose.hh + 0.01;
      else loose.y = sy + loose.r + 0.01;
      return [shelf, loose];
    }
    case "spinner": {
      const arm = rng.float(0.45, 0.9), off = rng.float(0.2, 0.7) * arm * rng.sign();
      return { type, x: P.x + off, y: P.y - r - arm * rng.float(0.3, 0.8), arm, arms: rng.int(2, 4), speed: rng.sign() * rng.float(1, 3), material: rng.weighted({ wood: 3, rubber: 1, steel: 1 }) };
    }
    case "funnel": {
      const gap = 2 * r + rng.float(0.15, 0.45), w = rng.float(0.7, 1.4), h = rng.float(0.4, 0.9);
      return { type, x: P.x + rng.float(-0.5, 0.5), y: below - h - 0.15, gap, w, h, material: rng.weighted({ wood: 3, ice: 1, steel: 1 }) };
    }
    case "pegs": {
      // spacing always leaves the ball room to pass between pegs
      const pr = rng.float(0.05, 0.09), sx = Math.max(2 * r + 2 * pr + 0.16, rng.float(0.5, 0.8));
      const cols = rng.int(4, 7), rows = rng.int(3, 6), w = (cols - 1) * sx;
      const x1 = P.x - w * rng.float(0.3, 0.7);
      return { type, x1, x2: x1 + w, y2: P.y - r - pr - 0.25, rows, sx, sy: sx * 0.87, r: pr, material: rng.weighted({ wood: 3, rubber: 2, steel: 2 }) };
    }
    case "lowgrav": {
      const w = rng.float(1.6, 3.2), h = rng.float(2, 4);
      const x1 = P.x - w * rng.float(0.25, 0.75), y2 = P.y + rng.float(0, 0.6);
      return { type, x1, y1: y2 - h, x2: x1 + w, y2, g: rng.pick([0.2, 0.3, 0.4, 0.5]) };
    }
    case "pendulum": {
      const len = rng.float(0.9, 1.6), rb = rng.float(0.2, 0.3);
      const bx = P.x + rng.sign() * rng.float(0.1, 0.3), by = P.y - rng.float(0.1, 0.5);
      return { type, px: bx, py: by + len, len, r: rb, angle: 0, material: rng.weighted({ steel: 3, wood: 2, rubber: 1 }) };
    }
  }
  return null;
}

export function inBounds(b, W, H) {
  return b && b[0] > 0.2 && b[2] < W - 0.2 && b[1] > FLOOR_Y + 0.25 && b[3] < H - 0.15;
}
