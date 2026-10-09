// Evaluate a candidate puzzle: simulate, filter, chaos-test, rate difficulty with bots.
// Returns { ok: false, reason } or { ok: true, puzzle, runs } where runs are the
// simulations to record (1, or 6 for "place").
import { simulate } from "../sim/simulate.mjs";
import { scorePuzzle } from "../../public/js/shared/scoring.js";

export const FORMATS = ["stop", "freeze", "height", "dominoes", "time", "place"];
export const MAX_SETTLE = 15;      // seconds: the main ball must come to rest by then
export const CHAOS_RUNS = 20;
export const CHAOS = {             // max allowed spread across the 20 perturbed runs
  distance: 0.05,                  // of world width (stop, freeze, place)
  height: 0.03,                    // of world height
  time: 0.05,                      // of the true time (at least 0.15 s)
};
// difficulty = 100 - weighted bot scores (see docs/difficulty.md)
export const BOT_WEIGHTS = { drop: 0.15, ramp: 0.35, rough: 0.5 };

const COMPONENT_NAMES = {
  ramp: "ramp", curve: "curved ramp", bumper: "bumper", seesaw: "seesaw", spring: "spring",
  conveyor: "conveyor belt", pendulum: "pendulum", dominoes: "dominoes", wall: "wall", chute: "chute",
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const mainBall = (scene) => scene.components.find((c) => c.role === "main");
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Simulate a scene; for "place" also every variant (scene + one candidate bumper). */
async function runAll(scene, format, extra, opts = {}) {
  if (format !== "place") return [await simulate(scene, { maxSeconds: MAX_SETTLE + 1, ...opts })];
  const runs = [];
  for (const c of extra.candidates) {
    const s = clone(scene);
    s.components.push({ ...c, candidate: true });
    runs.push(await simulate(s, { maxSeconds: MAX_SETTLE + 1, ...opts }));
  }
  return runs;
}

/** The answer a run gives for the format (target for "place" is chosen separately). */
function outcomeOf(format, runs) {
  const o = runs[0].outcome;
  switch (format) {
    case "stop": case "freeze": return { final: o.final };
    case "height": return { peak: o.peak, keyY: o.keyY };
    case "dominoes": return { fallen: o.fallen, total: o.dominoTotal };
    case "time": return { seconds: o.floorSeconds };
    case "place": return { finals: runs.map((r) => r.outcome.final) };
  }
}

function basicFilters(scene, format, runs) {
  for (const run of runs) {
    if (run.outOfBounds.length) return "an object leaves the screen";
    if (run.meta.mainSettledSeconds === null || run.meta.mainSettledSeconds > MAX_SETTLE) return "ball doesn't settle within 15 s";
  }
  const base = runs[0];
  if (format !== "place" && base.touched.length < 2) return "ball touches fewer than 2 components";
  if (format === "place" && Math.max(...runs.map((r) => r.touched.length)) < 2) return "ball touches fewer than 2 components";
  const o = base.outcome;
  if (format === "height") {
    const kc = scene.components[base.meta.keyComp]?.type;
    if (!["spring", "seesaw", "bumper"].includes(kc)) return "no launch for a height question";
    if (o.peak === null || o.peak - o.keyY < 0.6) return "launch too small for a height question";
  }
  if (format === "time" && (o.floorSeconds === null || o.floorSeconds < 2 || o.floorSeconds > 12)) return "floor time out of range";
  if (format === "dominoes") {
    const row = scene.components.findIndex((c) => c.type === "dominoes");
    if (!base.touched.includes(row) && o.fallen === 0) return "ball misses the dominoes";
    if (o.fallen === 0) return "no domino falls";
    if (o.fallen === o.dominoTotal) return "every domino falls (too easy to guess)";
  }
  if (format === "freeze" && (base.meta.keyFrame === null || base.meta.keyFrame < 36)) return "key moment too early to freeze before it";
  return null;
}

/** Re-run with tiny nudges (start +-1 px, speed +-1%); reject if outcomes spread too much. */
async function chaosTest(scene, format, extra, answer) {
  const W = scene.world.width, H = scene.world.height, px = W / 1080;
  const spreads = [];
  for (let k = 0; k < CHAOS_RUNS; k++) {
    const s = clone(scene), b = mainBall(s);
    const dx = [-1, -0.5, 0.5, 1][k % 4] * px, sp = 1 + [-0.01, -0.005, 0.005, 0.01, 0][Math.floor(k / 4)];
    b.x += dx;
    b.vx = (b.vx ?? 0) * sp; b.vy = (b.vy ?? 0) * sp;
    const runs = await runAll(s, format, extra);
    let spread;
    const mustHold = format === "place" ? [runs[answer.solution]] : runs;
    if (mustHold.some((r) => r.outOfBounds.length || r.meta.mainSettledSeconds === null)) return { ok: false, reason: "chaos: a nudged run breaks" };
    const o = runs[0].outcome;
    switch (format) {
      case "stop": case "freeze":
        spread = Math.hypot(o.final.x - answer.final.x, o.final.y - answer.final.y) / W; break;
      case "place": {
        // the right spot must reliably hit the star, and the wrong ones must reliably miss it
        const sol = runs[answer.solution].outcome.final;
        spread = Math.hypot(sol.x - answer.target.x, sol.y - answer.target.y) / W;
        const nearMiss = runs.some((r, i) => i !== answer.solution && Math.hypot(r.outcome.final.x - answer.target.x, r.outcome.final.y - answer.target.y) < 0.08 * W);
        if (nearMiss) spread = Infinity;
        break;
      }
      case "height": spread = Math.abs(o.peak - answer.peak) / H; break;
      case "time": spread = o.floorSeconds === null ? Infinity : Math.abs(o.floorSeconds - answer.seconds) / Math.max(answer.seconds, 3); break;
      case "dominoes": spread = o.fallen === answer.fallen ? 0 : Infinity; break;
    }
    spreads.push(spread);
    const limit = format === "height" ? CHAOS.height : format === "time" ? CHAOS.time : format === "dominoes" ? 0 : CHAOS.distance;
    if (spread > limit) return { ok: false, reason: `chaos: spread ${(spread * 100).toFixed(1)}% > ${(limit * 100).toFixed(0)}%` };
  }
  return { ok: true, spread: Math.max(...spreads) };
}

// ---------------------------------------------------------------- difficulty bots
// Each bot predicts like a person with a rule of thumb; its prediction is scored
// exactly like a player's. Puzzles the simple bots get right are easy.

function rampOnly(scene) {
  // "Follows ramp surfaces, ignores bounces, seesaws and collisions":
  // keep static surfaces, turn conveyors into plain ramps, drop everything else that acts.
  const s = clone(scene);
  s.components = s.components.flatMap((c) => {
    if (["bumper", "seesaw", "spring", "fan", "pendulum"].includes(c.type)) return [];
    if (c.type === "conveyor") return [{ type: "ramp", x1: c.x1, y1: c.y, x2: c.x2, y2: c.y, t: 0.16 }];
    return [c];
  });
  return s;
}

function predictionFrom(format, runs, puzzle) {
  const o = runs[0].outcome;
  switch (format) {
    case "stop": case "freeze": return o.final ? { x: o.final.x, y: o.final.y } : null;
    case "height": return o.peak === null ? { y: o.keyY ?? 0 } : { y: o.peak };
    case "time": return o.floorSeconds === null ? null : { t: o.floorSeconds };
    case "dominoes": return { n: o.fallen };
    case "place": {
      // pick the candidate whose (bot-predicted) finish is nearest the target
      let best = 0, bestD = Infinity;
      runs.forEach((r, i) => { const f = r.outcome.final; const d = Math.hypot(f.x - puzzle.answer.target.x, f.y - puzzle.answer.target.y); if (d < bestD) { bestD = d; best = i; } });
      return { choice: best };
    }
  }
}

async function bots(scene, format, extra, puzzle, base) {
  const b = mainBall(scene), floorY = 0.16 + b.r;
  const W = scene.world.width;
  // drop bot: the ball falls straight down from where it leaves the start piece
  let drop;
  const startX = format === "freeze" ? base.recording.bodies[base.mainIndex].x[puzzle.freezeFrame] : b.x;
  const startY = format === "freeze" ? base.recording.bodies[base.mainIndex].y[puzzle.freezeFrame] : b.y;
  switch (format) {
    case "stop": case "freeze": drop = { x: startX, y: floorY }; break;
    case "height": drop = { y: puzzle.answer.keyY }; break;
    case "time": drop = { t: Math.sqrt((2 * (b.y - floorY)) / 10) }; break;
    case "dominoes": drop = { n: puzzle.answer.total }; break;
    case "place": {
      let best = 0;
      extra.candidates.forEach((c, i) => { if (Math.abs(c.x - puzzle.answer.target.x) < Math.abs(extra.candidates[best].x - puzzle.answer.target.x)) best = i; });
      drop = { choice: best };
    }
  }
  // ramp bot: surfaces only, nothing bounces
  const rampRuns = await runAll(rampOnly(scene), format, extra, { noise: { restitution: 0 } });
  let ramp = predictionFrom(format, rampRuns, puzzle);
  if (format === "dominoes" && ramp) ramp = { n: rampRuns[0].touched.includes(scene.components.findIndex((c) => c.type === "dominoes")) || rampRuns[0].outcome.fallen > 0 ? puzzle.answer.total : 0 };
  if (format === "height" && rampRuns[0].outcome.peak === null) ramp = { y: puzzle.answer.keyY };
  // rough-physics bot: the real simulation with wrong-ish materials and launch speed, averaged
  const noises = [
    { friction: 0.4, restitution: 1.4, force: 0.75, launch: 1.2 },
    { friction: 2.0, restitution: 0.6, force: 1.25, launch: 0.8 },
    { friction: 1.4, restitution: 1.2, force: 0.85, launch: 1.1 },
  ];
  const preds = [];
  for (const n of noises) {
    const s = clone(scene), mb = mainBall(s);
    mb.vx = (mb.vx ?? 0) * n.launch; mb.vy = (mb.vy ?? 0) * n.launch;
    preds.push(predictionFrom(format, await runAll(s, format, extra, { noise: n }), puzzle));
  }
  let rough;
  const ok = preds.filter(Boolean);
  const mean = (k) => ok.reduce((s, p) => s + p[k], 0) / ok.length;
  if (!ok.length) rough = null;
  else if (format === "stop" || format === "freeze") rough = { x: mean("x"), y: mean("y") };
  else if (format === "height") rough = { y: mean("y") };
  else if (format === "time") rough = { t: mean("t") };
  else if (format === "dominoes") rough = { n: Math.round(mean("n")) };
  else rough = { choice: median(ok.map((p) => p.choice)) };

  const score = (g) => (g ? scorePuzzle(puzzle, g) : 0);
  const result = { drop: score(drop), ramp: score(ramp), rough: score(rough) };
  const difficulty = 100 - (BOT_WEIGHTS.drop * result.drop + BOT_WEIGHTS.ramp * result.ramp + BOT_WEIGHTS.rough * result.rough);
  return { scores: result, difficulty, predictions: { drop, ramp, rough } };
}

// ---------------------------------------------------------------- twists
function twistsOf(scene, run) {
  const comps = scene.components, main = comps.findIndex((c) => c.role === "main");
  const tags = new Set();
  for (const ci of run.touched) {
    const c = comps[ci];
    if (!c) continue;
    if (c.type === "bumper" || c.type === "spring") tags.add(c.type === "spring" ? "spring launch" : "bounce");
    if (c.type === "seesaw") tags.add("seesaw");
    if (c.type === "conveyor") tags.add("conveyor");
    if (c.type === "pendulum") tags.add("pendulum");
    if (c.material === "ice") tags.add("ice slide");
    if (c.material === "rubber" && c.type !== "conveyor") tags.add("bounce");
    if (c.type === "ball") tags.add("ball-ball collision");
    if (c.type === "dominoes") tags.add("domino chain");
  }
  if (comps.some((c) => c.type === "fan")) {
    const f = comps.find((c) => c.type === "fan");
    const t = run.recording.bodies[run.mainIndex];
    if (t.x.some((x, i) => x > f.x1 && x < f.x2 && t.y[i] > f.y1 && t.y[i] < f.y2)) tags.add("fan");
  }
  if (comps[main]?.material === "rubber") tags.add("bounce");
  return [...tags];
}

function question(format, scene, base) {
  const keyType = scene.components[base.meta.keyComp]?.type;
  switch (format) {
    case "stop": return "Where will ball A come to rest? Tap the spot.";
    case "freeze": return "Watch the start. Where will ball A come to rest?";
    case "height": return `After it hits the ${COMPONENT_NAMES[keyType] ?? "next piece"}, how high will ball A fly? Drag the line.`;
    case "dominoes": return "How many dominoes will fall?";
    case "time": return "How many seconds until ball A first touches the floor?";
    case "place": return "Pick where to put the bumper so ball A stops on the ★.";
  }
}

// ---------------------------------------------------------------- main entry
export async function evaluate(scene, format, extra) {
  const runs = await runAll(scene, format, extra);
  const problem = basicFilters(scene, format, runs);
  if (problem) return { ok: false, reason: problem };
  const answer = outcomeOf(format, runs);

  if (format === "place") {
    // Target = where one candidate's ball ends up, when no other candidate (and not
    // the scene without a bumper) ends up close. Exactly one clear solution.
    const W = scene.world.width;
    const finals = answer.finals;
    const sol = finals.findIndex((f, i) => finals.every((g, j) => j === i || Math.hypot(f.x - g.x, f.y - g.y) > 0.12 * W));
    if (sol < 0) return { ok: false, reason: "place: no candidate has a unique outcome" };
    const bare = await simulate(scene, { maxSeconds: MAX_SETTLE + 1 });
    if (bare.outcome.final && Math.hypot(bare.outcome.final.x - finals[sol].x, bare.outcome.final.y - finals[sol].y) < 0.12 * W) {
      return { ok: false, reason: "place: target reachable without the bumper" };
    }
    answer.target = finals[sol];
    answer.solution = sol;
  }

  const chaos = await chaosTest(scene, format, extra, answer);
  if (!chaos.ok) return { ok: false, reason: chaos.reason };

  const base = runs[format === "place" ? answer.solution : 0];
  const puzzle = {
    format,
    world: scene.world,
    question: question(format, scene, base),
    answer,
    chaosSpread: chaos.spread,
    twists: twistsOf(scene, base),
  };
  if (format === "freeze") puzzle.freezeFrame = Math.max(15, base.meta.keyFrame - 12);
  if (format === "height") puzzle.highlight = base.meta.keyComp;
  if (format === "place") puzzle.candidates = extra.candidates.map(({ x, y, r }) => ({ x, y, r }));
  const b = await bots(scene, format, extra, puzzle, base);
  puzzle.bots = b.scores;
  puzzle.difficulty = b.difficulty;
  return { ok: true, puzzle, runs };
}
