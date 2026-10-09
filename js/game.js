// Predictle: the daily game. Loads the day's file, runs intro -> 3 puzzles -> results.
import { unpackDay } from "./shared/codec.js";
import { MATERIALS } from "./shared/materials.js";
import { scorePuzzle, points, emoji } from "./shared/scoring.js";
import { Renderer } from "./render.js";
import * as api from "./api.js";
import { todayUTC, pickDate, weekdayOf, dayFile } from "./shared/daily.js";

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const FORMAT_NAMES = {
  stop: "Where does it stop?", freeze: "Freeze frame", height: "How high?",
  dominoes: "Domino count", time: "Stopwatch", place: "Place the bumper",
};
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);

// ---------------------------------------------------------------- storage (fails soft)
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } },
};

// ---------------------------------------------------------------- day loading
async function loadDay(date) {
  const res = await fetch(`./${dayFile(date)}`, { cache: "no-cache" });
  if (!res.ok) return null;
  const gz = await res.arrayBuffer();
  const raw = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return unpackDay(new Uint8Array(raw));
}


// ---------------------------------------------------------------- app
const app = $("#app");
const date = pickDate(location.search, { local: isLocal });
const weekday = weekdayOf(date);
$("#date").textContent = `${DAY_NAMES[weekday]} ${date}`;
buildLegend();

let day;
try { day = await loadDay(date); } catch (e) { console.error(e); }
if (!day) {
  app.replaceChildren(el("section", { class: "card" }, el("h2", {}, "No puzzles for this day"),
    el("p", {}, `There's no puzzle file for ${date}.`), await devDayPicker()));
} else {
  const saveKey = `predictle:${date}`;
  const state = store.get(saveKey, { guesses: [], scores: [] });
  const save = () => store.set(saveKey, state);
  const next = state.scores.length;
  if (next >= day.header.puzzles.length) showResults(day, state);
  else if (next === 0) showIntro(day, state, save);
  else playPuzzle(day, state, save, next);
}

async function devDayPicker() {
  if (!isLocal) return null;
  try {
    const idx = await (await fetch("./puzzles/index.json", { cache: "no-cache" })).json();
    return el("p", { class: "dev" }, "Local test days: ",
      ...Object.keys(idx.days).sort().map((d) => el("a", { href: `?date=${d}` }, d, " ")));
  } catch { return null; }
}

function buildLegend() {
  const box = $("#legend");
  for (const [name, m] of Object.entries(MATERIALS)) {
    const sw = el("canvas", { width: 44, height: 44, "aria-hidden": "true" });
    box.append(el("span", {}, sw, `${m.label} `, el("small", {}, m.note)));
    const r = new Renderer(sw, { world: { width: 1, height: 1 } }, null);
    r.scale = 44; r.tile = 20;
    r.ctx.setTransform(44, 0, 0, -44, 0, 44);
    r.drawShape({ t: "box", x: 0.5, y: 0.5, hw: 0.5, hh: 0.5, m: name });
  }
}

// ---------------------------------------------------------------- intro
async function showIntro(day, state, save) {
  const ps = day.header.puzzles;
  app.replaceChildren(el("section", { class: "card intro" },
    el("h2", {}, "Three contraptions. Watch, freeze, predict."),
    el("p", {}, "Each round plays until just before the tricky part, then freezes. ",
      "Tap where A will come to rest, then watch what really happens. ",
      "You score 0–100: the closer, the more. Rounds get harder through the day, and days get harder through the week (Monday gentlest, Sunday toughest)."),
    el("ol", { class: "plan" }, ps.map((p, k) => el("li", {}, el("b", {}, `Round ${k + 1}`), ` · ${p.slot}`))),
    el("p", { class: "muted" }, "Rules of this world: sand stops anything that lands in it. Ice is slippery whatever touches it, rubber bounces whatever hits it, steel is heavy. ",
      "Fans push anything inside their zone; conveyor belts carry things along."),
    el("button", { class: "primary big", onclick: () => playPuzzle(day, state, save, 0) }, "Start"),
    await devDayPicker(),
  ));
}

// ---------------------------------------------------------------- one puzzle
function playPuzzle(day, state, save, i) {
  const p = day.header.puzzles[i];
  const W = p.world.width, H = p.world.height;
  const mainK = p.bodies.findIndex((b) => b.role === "main");
  const s0 = p.bodies[mainK].shapes[0];
  const mainR = s0.t === "circle" ? s0.r : Math.max(s0.hw, s0.hh);

  // Which recording plays: "place" has one per choice.
  let rec = 0;
  const metaFor = (k) => ({
    world: p.world, fps: p.fps, frameCount: p.recordings[k ?? 0].frameCount, keyFrame: p.recordings[k ?? 0].keyFrame,
    // "place": k = the chosen spot (null while predicting: no bumper placed yet)
    statics: p.format === "place" && k !== null ? [...p.statics, { t: "circle", x: p.candidates[k].x, y: p.candidates[k].y, r: p.candidates[k].r, m: "rubber" }] : p.statics,
    decor: p.decor, bodies: p.bodies,
  });

  const canvas = el("canvas", { class: "view", "aria-label": "Physics contraption" });
  // Skip: while watching the start, jump to the freeze; while watching the outcome, jump to the end.
  const skipBtn = el("button", { class: "skip", hidden: true, onclick: () => {
    if (phase === "predict") frame = freezeAt;
    else frame = last();
  } }, "Skip ⏭");
  const badge = el("div", { class: "slowmo", hidden: true }, "Slow motion");
  const prompt = el("p", { class: "question" }, p.question);
  const controls = el("div", { class: "controls" });
  const result = el("div", { class: "result", hidden: true });
  app.replaceChildren(el("section", { class: "puzzle" },
    el("div", { class: "puzzle-head" },
      el("span", { class: "step" }, `Round ${i + 1} of ${day.header.puzzles.length}`),
      el("span", { class: `slot ${p.slot}` }, p.slot),
      p.format !== "freeze" ? el("span", { class: "fmt" }, FORMAT_NAMES[p.format]) : null),
    prompt,
    el("div", { class: "stage" }, canvas, badge, skipBtn),
    controls, result));

  const r = new Renderer(canvas, metaFor(p.format === "place" ? null : 0), day.motions[i][0]);
  const setRecording = (k) => { rec = k; r.meta = metaFor(k); r.motion = day.motions[i][k]; };

  // ------------------------------------------------ playback state
  let phase = "predict";          // predict -> play -> done
  let frame = 0, wall = 0, playing = false, prev = null;
  let slow = null;                // [from, to] frames played at 0.3x
  let guess = null;
  let ended = null;
  const last = () => r.meta.frameCount - 1;
  const freezeAt = p.format === "freeze" ? p.freezeFrame : 0;
  if (p.format === "freeze") { playing = true; prompt.textContent = "Watch the start…"; }

  function tick(now) {
    if (!canvas.isConnected) return;
    const dt = prev === null ? 0 : Math.min(0.1, (now - prev) / 1000);
    prev = now;
    wall += dt;
    if (playing) {
      const inSlow = slow && frame >= slow[0] && frame <= slow[1];
      badge.hidden = !inSlow;
      skipBtn.hidden = false;
      frame += dt * p.fps * (inSlow ? 0.3 : 1);
      if (phase === "predict" && frame >= freezeAt) { frame = freezeAt; playing = false; skipBtn.hidden = true; prompt.textContent = p.question; }
      if (frame >= last()) { frame = last(); playing = false; badge.hidden = true; skipBtn.hidden = true; ended?.(); ended = null; }
    }
    r.draw(frame, wall);
    requestAnimationFrame(tick);
  }
  new ResizeObserver(() => r.resize()).observe(canvas);
  requestAnimationFrame(tick);

  function playFrom(start, { slowmo = true } = {}) {
    frame = start;
    const k = r.meta.keyFrame;
    slow = slowmo && k != null ? [k - p.fps * 0.5, k + p.fps * 0.7] : null;
    playing = true;
    return new Promise((res) => (ended = res));
  }

  // ------------------------------------------------ overlay: hints, guess, answer
  const answerShown = () => phase === "done";
  r.overlay = (ctx, f, t) => {
    const px = 1 / r.scale;
    if (phase === "predict" && f === freezeAt) {
      // ring around ball A and its launch arrow, so it's clear what moves and how
      const pose = r.motion.bodies[mainK];
      const bx = pose.x[Math.round(f)], by = pose.y[Math.round(f)];
      ctx.strokeStyle = "rgba(15,143,122,0.9)";
      ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.arc(bx, by, mainR + 0.08 + 0.04 * Math.sin(t * 5), 0, 7); ctx.stroke();
      if (f === 0 && (p.launch.vx || p.launch.vy)) arrow(ctx, bx, by, p.launch.vx, p.launch.vy, px);
    }
    if (p.highlight != null && phase === "predict") highlightComp(ctx, p.highlight, px, t);
    if (p.format === "place") drawCandidates(ctx, px);
    drawGuess(ctx, px);
    if (answerShown()) drawAnswer(ctx, px);
  };

  function arrow(ctx, x, y, vx, vy, px) {
    const s = Math.hypot(vx, vy), L = 0.35 + 0.25 * s, ux = vx / s, uy = vy / s;
    const x0 = x + ux * (mainR + 0.05), y0 = y + uy * (mainR + 0.05), x1 = x0 + ux * L, y1 = y0 + uy * L;
    ctx.strokeStyle = "#0f8f7a"; ctx.fillStyle = "#0f8f7a"; ctx.lineWidth = 4 * px;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1 + ux * 0.14, y1 + uy * 0.14); ctx.lineTo(x1 - uy * 0.1, y1 + ux * 0.1); ctx.lineTo(x1 + uy * 0.1, y1 - ux * 0.1); ctx.fill();
  }

  function highlightComp(ctx, comp, px, t) {
    ctx.strokeStyle = `rgba(255, 170, 0, ${0.6 + 0.3 * Math.sin(t * 4)})`;
    ctx.lineWidth = 6 * px;
    for (const s of r.meta.statics) if (s.comp === comp) outline(ctx, s);
    r.meta.bodies.forEach((b, k) => {
      if (b.comp !== comp) return;
      const q = r.motion.bodies[k], fi = Math.round(frame);
      ctx.save(); ctx.translate(q.x[fi], q.y[fi]); ctx.rotate(q.a[fi]);
      for (const s of b.shapes) outline(ctx, s);
      ctx.restore();
    });
  }
  function outline(ctx, s) {
    ctx.beginPath();
    if (s.t === "circle") ctx.arc(s.x, s.y, s.r + 0.05, 0, 7);
    else if (s.t === "box") { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a ?? 0); ctx.rect(-s.hw - 0.05, -s.hh - 0.05, 2 * s.hw + 0.1, 2 * s.hh + 0.1); ctx.restore(); }
    else if (s.t === "path") { ctx.moveTo(...s.pts[0]); for (const q of s.pts.slice(1)) ctx.lineTo(...q); }
    ctx.stroke();
  }

  function star(ctx, x, y, R, fill) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? R * 0.45 : R; ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }

  function drawCandidates(ctx, px) {
    star(ctx, p.answer.target.x, p.answer.target.y, 0.32, "rgba(255, 176, 0, 0.95)");
    if (phase !== "predict") return;
    p.candidates.forEach((c, k) => {
      const chosen = guess?.choice === k;
      ctx.setLineDash(chosen ? [] : [6 * px, 5 * px]);
      ctx.lineWidth = (chosen ? 4 : 2.5) * px;
      ctx.strokeStyle = chosen ? MATERIALS.rubber.ink : "rgba(140, 29, 69, 0.75)";
      ctx.fillStyle = chosen ? "rgba(224, 69, 123, 0.85)" : "rgba(224, 69, 123, 0.12)";
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.save(); ctx.translate(c.x, c.y); ctx.scale(1, -1);
      ctx.fillStyle = chosen ? "#fff" : "#8c1d45"; ctx.font = `bold ${c.r}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(k + 1), 0, 0); ctx.restore();
    });
  }

  const GUESS = "#d9480f", ANSWER = "#1a7f37";
  function drawGuess(ctx, px) {
    if (!guess) return;
    ctx.strokeStyle = GUESS; ctx.fillStyle = GUESS; ctx.lineWidth = 3 * px;
    if (guess.x != null) {
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath(); ctx.arc(guess.x, guess.y, mainR, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      const a = mainR * 0.6;
      ctx.beginPath(); ctx.moveTo(guess.x - a, guess.y - a); ctx.lineTo(guess.x + a, guess.y + a); ctx.moveTo(guess.x - a, guess.y + a); ctx.lineTo(guess.x + a, guess.y - a); ctx.stroke();
    } else if (guess.y != null && p.format === "height") {
      hLine(ctx, guess.y, GUESS, "your guess", px);
    }
  }
  function hLine(ctx, y, colour, label, px) {
    ctx.strokeStyle = colour; ctx.lineWidth = 3 * px; ctx.setLineDash([10 * px, 6 * px]);
    ctx.beginPath(); ctx.moveTo(0.15, y); ctx.lineTo(W - 0.15, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.save(); ctx.translate(0.3, y + 0.08); ctx.scale(1, -1); ctx.fillStyle = colour; ctx.font = `600 ${0.28}px system-ui`; ctx.fillText(label, 0, 0); ctx.restore();
  }
  function drawAnswer(ctx, px) {
    const a = p.answer;
    if (p.format === "stop" || p.format === "freeze") {
      ctx.strokeStyle = ANSWER; ctx.lineWidth = 4 * px;
      ctx.beginPath(); ctx.arc(a.final.x, a.final.y, mainR + 0.1, 0, 7); ctx.stroke();
      if (guess) { ctx.setLineDash([4 * px, 4 * px]); ctx.beginPath(); ctx.moveTo(guess.x, guess.y); ctx.lineTo(a.final.x, a.final.y); ctx.stroke(); ctx.setLineDash([]); }
    }
    if (p.format === "height") hLine(ctx, a.peak, ANSWER, "actual peak", px);
  }

  // ------------------------------------------------ input per format
  const lockBtn = el("button", { class: "primary", disabled: true, onclick: () => lockIn() }, "Lock in");
  const clearBtn = el("button", { onclick: () => { guess = null; lockBtn.disabled = true; refreshReadout(); } }, "Clear");
  const readout = el("span", { class: "readout" });
  const refreshReadout = () => {
    if (p.format === "height") readout.textContent = guess ? `${guess.y.toFixed(1)} m up` : "Tap or drag on the picture";
    else if (p.format === "stop" || p.format === "freeze") readout.textContent = guess ? "Drag to adjust" : "Tap where it will stop";
    else if (p.format === "place") readout.textContent = guess ? `Bumper ${guess.choice + 1}` : "Tap a dashed circle";
  };

  if (["stop", "freeze", "height", "place"].includes(p.format)) {
    let dragging = false;
    const at = (e) => {
      const w = r.toWorld(e.clientX, e.clientY);
      const x = Math.min(W - 0.2, Math.max(0.2, w.x)), y = Math.min(H - 0.2, Math.max(0.2, w.y));
      if (p.format === "height") guess = { y };
      else if (p.format === "place") {
        let best = null, bd = Infinity;
        p.candidates.forEach((c, k) => { const d = Math.hypot(c.x - w.x, c.y - w.y); if (d < bd) { bd = d; best = k; } });
        if (bd < 1.2) guess = { choice: best };
      } else guess = { x, y };
      lockBtn.disabled = !guess;
      refreshReadout();
      if (e.pointerType === "touch" && p.format !== "place") r.loupe = { x: w.px, y: w.py };
    };
    canvas.addEventListener("pointerdown", (e) => { if (phase !== "predict" || playing) return; dragging = true; canvas.setPointerCapture(e.pointerId); at(e); });
    canvas.addEventListener("pointermove", (e) => { if (dragging) at(e); });
    const up = () => { dragging = false; r.loupe = null; };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    controls.append(readout, clearBtn, lockBtn);
    refreshReadout();
  } else if (p.format === "dominoes") {
    const n = p.answer.total;
    let v = Math.ceil(n / 2);
    const out = el("output", { class: "count" }, String(v));
    const set = (x) => { v = Math.max(0, Math.min(n, x)); out.textContent = String(v); guess = { n: v }; lockBtn.disabled = false; };
    guess = { n: v }; lockBtn.disabled = false;
    controls.append(el("div", { class: "stepper" },
      el("button", { "aria-label": "fewer", onclick: () => set(v - 1) }, "−"), out,
      el("button", { "aria-label": "more", onclick: () => set(v + 1) }, "+"),
      el("span", { class: "muted" }, ` of ${n} dominoes`)), lockBtn);
  } else if (p.format === "time") {
    const out = el("output", { class: "count" }, "3.0 s");
    const slider = el("input", { type: "range", min: 0.5, max: 12, step: 0.1, value: 3, "aria-label": "seconds" });
    slider.addEventListener("input", () => { guess = { t: +slider.value }; out.textContent = `${(+slider.value).toFixed(1)} s`; lockBtn.disabled = false; });
    guess = { t: 3 }; lockBtn.disabled = false;
    controls.append(el("div", { class: "slider" }, slider, out), lockBtn);
  }
  if (p.format === "freeze") controls.prepend(el("button", { onclick: () => { if (phase === "predict") { frame = 0; playing = true; prompt.textContent = "Watch the start…"; } } }, "Watch again"));

  // ------------------------------------------------ play and score
  let timer = null;
  async function lockIn() {
    if (!guess || phase !== "predict") return;
    phase = "play";
    controls.replaceChildren(el("span", { class: "muted" }, "Watch…"));
    if (p.format === "place") setRecording(guess.choice);
    if (p.format === "time") {
      timer = el("div", { class: "stopwatch" }, "0.0 s");
      controls.replaceChildren(timer);
    }
    const startFrame = p.format === "freeze" ? freezeAt : 0;
    const t0 = performance.now();
    if (timer) {
      const floorF = Math.round(p.answer.seconds * p.fps);
      const id = setInterval(() => {
        const f = Math.min(frame, floorF);
        timer.textContent = `${(f / p.fps).toFixed(1)} s${frame >= floorF ? " · floor!" : ""}`;
        if (!canvas.isConnected) clearInterval(id);
      }, 50);
    }
    await playFrom(startFrame);
    phase = "done";
    const score = scorePuzzle(p, guess);
    state.guesses[i] = guess;
    state.scores[i] = score;
    save();
    showResult(score);
  }

  function detail(score) {
    const a = p.answer;
    switch (p.format) {
      case "stop": case "freeze": {
        const d = Math.hypot(guess.x - a.final.x, guess.y - a.final.y);
        return `You were ${d.toFixed(2)} m from where it stopped. (0 points is the worst spot in the whole arena.)`;
      }
      case "height": return `It peaked ${a.peak.toFixed(2)} m up; you said ${guess.y.toFixed(2)} m.`;
      case "dominoes": return `${a.fallen} of ${a.total} fell; you said ${guess.n}.`;
      case "time": return `It touched the floor after ${a.seconds.toFixed(1)} s; you said ${guess.t.toFixed(1)} s.`;
      case "place": return guess.choice === a.solution ? "Bullseye: that's the spot." : `Bumper ${a.solution + 1} was the one. Yours stopped ${Math.hypot(a.finals[guess.choice].x - a.target.x, a.finals[guess.choice].y - a.target.y).toFixed(2)} m from the star.`;
    }
  }

  function showResult(score) {
    result.hidden = false;
    result.replaceChildren(
      el("div", { class: "score" }, el("span", { class: "big-num" }, String(points(score))), el("span", { class: "of" }, "/100 "), emoji(score)),
      el("p", {}, detail(score)),
      el("div", { class: "controls" },
        el("button", { onclick: () => { const k = r.meta.keyFrame ?? 0; playFrom(Math.max(0, k - p.fps * 1.2)); } }, "Replay key moment"),
        el("button", { onclick: () => playFrom(0, { slowmo: false }) }, "Replay all"),
        el("button", { class: "primary", onclick: () => {
          if (i + 1 < day.header.puzzles.length) playPuzzle(day, state, save, i + 1);
          else showResults(day, state);
        } }, i + 1 < day.header.puzzles.length ? "Next puzzle" : "See results")));
    controls.replaceChildren();
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

// ---------------------------------------------------------------- results
function updateStreak(date, total) {
  const h = store.get("predictle:history", {});
  h[date] = Math.round(total);
  store.set("predictle:history", h);
  let streak = 0;
  for (let d = new Date(`${todayUTC()}T00:00:00Z`); h[d.toISOString().slice(0, 10)] != null; d = new Date(d - 864e5)) streak++;
  return { streak, played: Object.keys(h).length };
}

function showResults(day, state) {
  const ps = day.header.puzzles;
  const total = state.scores.reduce((s, x) => s + x, 0);
  const line = state.scores.map(emoji).join("");
  const { streak, played } = updateStreak(day.header.date, total);
  const url = `${location.origin}${location.pathname}`;
  const share = `Predictle ${day.header.date} ${line} ${points(total)}/300\n${url}`;
  const copyBtn = el("button", { class: "primary", onclick: async () => {
    try { await navigator.clipboard.writeText(share); copyBtn.textContent = "Copied!"; } catch { copyBtn.textContent = "Copy failed: select the text"; }
  } }, "Copy result");
  app.replaceChildren(el("section", { class: "card" },
    el("h2", {}, `${points(total)} / 300 `, line),
    el("ul", { class: "scores" }, ps.map((p, k) => el("li", {}, el("span", {}, `${FORMAT_NAMES[p.format]} · ${p.slot}`), el("b", {}, `${points(state.scores[k])} ${emoji(state.scores[k])}`)))),
    el("pre", { class: "share" }, share),
    el("div", { class: "controls" }, copyBtn),
    el("p", { class: "muted" }, `Streak: ${streak} day${streak === 1 ? "" : "s"} · days played: ${played}`),
    el("p", { class: "muted" }, "Next puzzles at 00:00 UTC."),
  ), leaderboardPanel(day, state, total));
}

function leaderboardPanel(day, state, total) {
  const box = el("section", { class: "card board" }, el("h3", {}, "Today's leaderboard"));
  api.ready.then(() => fillBoard(box, day, state));
  return box;
}

function fillBoard(box, day, state) {
  if (!api.configured()) { box.append(el("p", { class: "muted" }, "Leaderboard not connected in this build.")); return; }
  const date = day.header.date;
  const submittedKey = `predictle:submitted:${date}`;
  const list = el("ol", { class: "ranks" });
  const status = el("p", { class: "muted" });
  const render = (board) => {
    list.replaceChildren(...board.top.map((row) => el("li", { class: row.you ? "you" : "" },
      el("span", {}, `${row.rank}. ${row.name}`), el("span", {}, `${row.scores.map(emoji).join("")} ${points(row.total)}`))));
    if (board.you) list.append(el("li", { class: "you" }, el("span", {}, `${board.you.rank}. ${board.you.name}`), el("span", {}, points(board.you.total))));
    status.textContent = `${board.players} player${board.players === 1 ? "" : "s"}${board.late ? " (played late)" : ""}`;
  };
  if (store.get(submittedKey)) {
    api.board(date).then(render).catch(() => (status.textContent = "Couldn't load the leaderboard."));
    box.append(status, list);
    return;
  }
  const name = el("input", { maxlength: 20, placeholder: "Your name", value: store.get("predictle:name", "") });
  const send = el("button", { class: "primary", onclick: async () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    store.set("predictle:name", n);
    send.disabled = true; status.textContent = "Sending…";
    try {
      const res = await api.submit(date, n, state.guesses);
      store.set(submittedKey, true);
      form.remove();
      render(res.board);
    } catch (e) { status.textContent = e.message; send.disabled = false; }
  } }, "Add my score");
  const form = el("div", { class: "controls" }, name, send);
  box.append(form, status, list);
  api.board(date).then(render).catch(() => {});
}
