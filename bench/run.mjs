// Phase 1 engine benchmark: the same scenes on every candidate engine.
// Usage: node bench/run.mjs [engine ...]   (default: all) -> prints a table, writes bench/results.json
import { ENGINES } from "./engines.mjs";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const DT = 1 / 60;
const G = -10;

const ground = (w, o = {}) => w.box({ x: 0, y: -0.5, hw: 20, hh: 0.5, ...o });
const run = (w, seconds, each) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { w.step(DT); each?.(i + 1); }
};

const SCENES = {
  // 10 boxes stacked exactly. Should stand still. Metric: sideways drift and sag of the top box.
  async stack(E) {
    const w = await E.create({ gravity: G });
    ground(w);
    const boxes = [];
    for (let i = 0; i < 10; i++) boxes.push(w.box({ x: 0, y: 0.2 + 0.4 * i, hw: 0.2, hh: 0.2, dynamic: true }));
    const top = boxes.at(-1);
    let drift = 0;
    run(w, 10, () => { drift = Math.max(drift, Math.abs(w.read(top).x)); });
    const sag = 0.2 + 0.4 * 9 - w.read(top).y;
    w.free();
    return { topDriftMm: drift * 1000, topSagMm: sag * 1000, stands: sag < 0.05 && drift < 0.05 };
  },

  // 20-row pyramid (210 boxes): the classic stacking stress test, and the speed test.
  async pyramid(E) {
    const w = await E.create({ gravity: G });
    ground(w);
    const rows = 20, h = 0.25;
    let top;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < rows - r; i++) {
        top = w.box({ x: (i - (rows - r - 1) / 2) * 2 * h * 1.02, y: h + r * 2 * h, hw: h, hh: h, dynamic: true });
      }
    }
    const y0 = w.read(top).y;
    const t0 = performance.now();
    run(w, 10, null);
    const ms = performance.now() - t0;
    const p = w.read(top);
    w.free();
    return { msPerSimSecond: ms / 10, topSagMm: (y0 - p.y) * 1000, topDriftMm: Math.abs(p.x) * 1000, stands: y0 - p.y < 0.1 };
  },

  // 30 dominoes, the first one tipped over. All 30 should fall, in order, at a steady speed.
  async dominoes(E, jitter = 0) {
    const w = await E.create({ gravity: G });
    ground(w, { friction: 0.6 });
    const ds = [];
    for (let i = 0; i < 30; i++) ds.push(w.box({ x: i * 0.5 + (i === 0 ? jitter : 0), y: 0.4, hw: 0.05, hh: 0.4, dynamic: true, friction: 0.5 }));
    w.setVelocity(ds[0], 0, 0, -2.5);
    let lastFall = null;
    const fallen = new Set();
    run(w, 12, (step) => {
      ds.forEach((d, i) => {
        if (!fallen.has(i) && Math.abs(w.read(d).a) > 0.6) { fallen.add(i); if (i === 29) lastFall = step * DT; }
      });
    });
    const order = [...fallen];
    const inOrder = order.every((v, i) => i === 0 || v > order[i - 1]);
    w.free();
    return { fallen: fallen.size, inOrder, chainSeconds: lastFall };
  },

  // Seesaw: a 2 m-long plank pivoted at its centre, a light ball on the left end,
  // a heavy block dropped on the right end. Metric: how high the ball is launched.
  async seesaw(E, jitter = 0) {
    const w = await E.create({ gravity: G });
    ground(w);
    const plank = w.box({ x: 0, y: 1, hw: 2, hh: 0.08, dynamic: true, density: 2 });
    w.pin(plank, 0, 1);
    const ball = w.circle({ x: -1.8, y: 1.08 + 0.2 + 0.001, r: 0.2, dynamic: true, density: 1 });
    const block = w.box({ x: 1.7 + jitter, y: 5, hw: 0.3, hh: 0.3, dynamic: true, density: 10 });
    let peak = -Infinity, peakX = 0;
    run(w, 4, () => { const p = w.read(ball); if (p.y > peak) { peak = p.y; peakX = p.x; } });
    const end = w.read(ball);
    w.free();
    return { ballPeakM: peak, ballPeakX: peakX, ballEndX: end.x };
  },

  // Rubber ball dropped from 3 m with restitution 0.9 on a restitution-0.9 floor.
  // Theory: first rebound peak = e^2 * 3 = 2.43 m (Box2D mixes restitution with max).
  async bounce(E) {
    const w = await E.create({ gravity: G });
    ground(w, { restitution: 0.9 });
    const ball = w.circle({ x: 0, y: 3, r: 0.2, dynamic: true, restitution: 0.9 });
    let peak = 0, falling = true, prev = 3, bounced = false;
    run(w, 3, () => {
      const y = w.read(ball).y;
      if (falling && y > prev) { falling = false; bounced = true; }
      if (bounced && !falling && y > peak) peak = y;
      if (bounced && !falling && y < prev && peak > 0) falling = null; // stop after first peak
      prev = y;
    });
    w.free();
    const theory = 0.2 + 0.81 * (3 - 0.2);
    return { reboundM: peak, theoryM: theory, errorPct: ((peak - theory) / theory) * 100 };
  },

  // Ice block on a 20 degree ramp, friction 0.05 (both surfaces). Theory: a = g (sin - mu cos).
  async ice(E) {
    const th = (20 * Math.PI) / 180;
    const w = await E.create({ gravity: G });
    w.box({ x: 0, y: 0, hw: 12, hh: 0.1, angle: -th, friction: 0.05 });
    const n = { x: Math.sin(th), y: Math.cos(th) };
    const s = { x: Math.cos(th), y: -Math.sin(th) };
    const start = { x: -8 * s.x + 0.31 * n.x, y: -8 * s.y + 0.31 * n.y };
    const blk = w.box({ x: start.x, y: start.y, hw: 0.2, hh: 0.2, angle: -th, dynamic: true, friction: 0.05 });
    run(w, 2, null);
    const p = w.read(blk);
    const dist = (p.x - start.x) * s.x + (p.y - start.y) * s.y;
    // effective mu with sqrt mixing = 0.05; with average = 0.05 too
    const a = -G * (Math.sin(th) - 0.05 * Math.cos(th));
    const theory = 0.5 * a * 4;
    w.free();
    return { slidM: dist, theoryM: theory, errorPct: ((dist - theory) / theory) * 100 };
  },
};

// Same scene twice in one process: identical bits? (Cross-machine is argued in the report.)
async function determinism(E) {
  const hashOnce = async () => {
    const w = await E.create({ gravity: G });
    ground(w);
    const plank = w.box({ x: 0, y: 1, hw: 2, hh: 0.08, dynamic: true, density: 2 });
    w.pin(plank, 0, 1);
    const bodies = [plank];
    for (let i = 0; i < 40; i++) bodies.push(w.circle({ x: -1.5 + (i % 8) * 0.4, y: 3 + Math.floor(i / 8) * 0.45, r: 0.18, dynamic: true, restitution: 0.4 }));
    for (let i = 0; i < 10; i++) bodies.push(w.box({ x: 3 + i * 0.5, y: 0.4, hw: 0.05, hh: 0.4, dynamic: true }));
    const h = createHash("sha256");
    run(w, 8, () => { for (const b of bodies) { const p = w.read(b); h.update(new Float64Array([p.x, p.y, p.a])); } });
    w.free();
    return h.digest("hex").slice(0, 16);
  };
  const a = await hashOnce(), b = await hashOnce();
  return { hash: a, repeatable: a === b };
}

// How much a 1 mm nudge changes the outcome. Physics is chaotic, but an engine that
// amplifies tiny changes a lot makes it harder for the generator to find fair puzzles.
async function sensitivity(E) {
  const base = await SCENES.seesaw(E, 0);
  const nudged = await SCENES.seesaw(E, 0.001);
  const d0 = await SCENES.dominoes(E, 0), d1 = await SCENES.dominoes(E, 0.001);
  return {
    seesawPeakShiftMm: Math.abs(base.ballPeakM - nudged.ballPeakM) * 1000,
    seesawLandingShiftMm: Math.abs(base.ballEndX - nudged.ballEndX) * 1000,
    dominoChainShiftMs: d0.chainSeconds && d1.chainSeconds ? Math.abs(d0.chainSeconds - d1.chainSeconds) * 1000 : null,
  };
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ENGINES);
const results = {};
for (const name of names) {
  const E = ENGINES[name];
  const r = { label: E.label };
  for (const [scene, fn] of Object.entries(SCENES)) {
    try { r[scene] = await fn(E); } catch (e) { r[scene] = { error: e.message.slice(0, 160) }; }
  }
  try { r.determinism = await determinism(E); } catch (e) { r.determinism = { error: e.message.slice(0, 160) }; }
  try { r.sensitivity = await sensitivity(E); } catch (e) { r.sensitivity = { error: e.message.slice(0, 160) }; }
  results[name] = r;
  console.log(`\n== ${E.label}`);
  for (const [k, v] of Object.entries(r)) if (k !== "label") console.log(`  ${k.padEnd(12)} ${JSON.stringify(v, (_, x) => (typeof x === "number" ? +x.toFixed(3) : x))}`);
}
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(results, null, 2));
