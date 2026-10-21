// Predictle: the daily game page (same layout and feel as ridd-le).
// Two freeze-frame rounds (easy, hard), then the laser bonus. Leaderboards for both,
// yesterday's best, and an archive of every past day.
import { unpackDay, decodeMotion } from "./shared/codec.js";
import { MATERIALS } from "./shared/materials.js";
import { scorePuzzle, points, emoji, perimeterPos, perimeterPoint } from "./shared/scoring.js";
import { hypot } from "./shared/dmath.js";
import { Renderer } from "./render.js";
import { drawLaser, beamLength } from "./laser-draw.js";
import { drawAim } from "./optics-draw.js";
import { traceBeam, pathLength, TARGET_R } from "./shared/optics.js";
import * as api from "./api.js";
import { todayUTC, pickDate, weekdayOf, dayFile, dayNumber, addDays, LAUNCH_DAY, msUntilNextDay } from "./shared/daily.js";

// ---------------------------------------------------------------- tiny DOM helpers
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const prettyDate = (d) => `${DAY_NAMES[weekdayOf(d)].slice(0, 3)} ${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}`;
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);

// ---------------------------------------------------------------- motion (the jacob.gg kit's JGG.motion, if it loaded)
const M = () => window.JGG?.motion;
const mq = (q) => matchMedia(q);
const calmMQ = mq("(prefers-reduced-motion: reduce)"), lightMQ = mq("(prefers-color-scheme: light)");
const calm = () => calmMQ.matches;
const scrollTo = (e, block) => M()?.scroll ? M().scroll(e, { block }) : e.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block });
/** A new phase in a card area. The first render on load stays still; later ones enter (220 ms), tappable at once. */
function swapIn(area, kids, enter = true) {
  area._stop?.(); area._stop = null; // the old round's loop, observers and listeners
  area.replaceChildren(...kids);
  if (area.dataset.p && enter) M()?.enter(area);
  area.dataset.p = 1;
}
/** cubic-bezier(0.23, 1, 0.32, 1), the kit's --jgg-ease-out. */
function easeOut(x) {
  const b = (t, p, q) => 3 * t * (1 - t) ** 2 * p + 3 * t * t * (1 - t) * q + t ** 3;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 20; i++) { t = (lo + hi) / 2; if (b(t, 0.23, 0.32) < x) lo = t; else hi = t; }
  return b(t, 1, 1);
}
/**
 * A round's draw loop. It runs only while something moves: busy() returns 1 (playback or an animation: every
 * frame), 2 (only a pulsing cue: drawn at ~30 fps) or 0 (sleep). It sleeps after the round, when idle under reduce
 * motion and while the canvas is off-screen (playback still advances there, undrawn). wake() redraws on demand.
 */
function drawLoop(canvas, r, signal, step, draw, busy) {
  let id = 0, prev = null, seen = true, dirty = true, last = -1e9;
  const frame = (now) => {
    id = 0;
    if (!canvas.isConnected) return;
    const dt = prev === null ? 0 : Math.min(0.1, (now - prev) / 1000);
    prev = now;
    step(dt);
    const b = busy();
    if (seen && (dirty || b !== 2 || now - last >= 32)) { draw(); dirty = false; last = now; }
    if (b === 1 || (b && seen)) id = requestAnimationFrame(frame);
    else prev = null;
  };
  const wake = r.wake = () => { dirty = true; if (!id && !signal.aborted) id = requestAnimationFrame(frame); };
  const ro = new ResizeObserver(() => { r.resize(); wake(); });
  const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; if (seen) wake(); });
  ro.observe(canvas); io.observe(canvas);
  const theme = () => { r.bg = null; wake(); };
  lightMQ.addEventListener("change", theme, { signal });
  calmMQ.addEventListener("change", wake, { signal });
  signal.addEventListener("abort", () => { cancelAnimationFrame(id); id = 0; ro.disconnect(); io.disconnect(); });
  wake();
}

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: play on without saving */ } },
};

// ---------------------------------------------------------------- which day, saved progress
const today = todayUTC();
const date = pickDate(location.search, { local: isLocal });
const isArchive = date !== today;
const saveKey = `predictle:v3:${date}`;
const state = store.get(saveKey, { guesses: [], scores: [] });
const mainDone = () => state.scores[0] != null && state.scores[1] != null;
const bonusDone = () => state.scores[2] != null;
const mainTotal = () => (state.scores[0] ?? 0) + (state.scores[1] ?? 0);
const save = () => {
  store.set(saveKey, state);
  const h = store.get("predictle:history", {});
  h[date] = { main: mainDone() ? mainTotal() : null, bonus: bonusDone() ? state.scores[2] : null };
  store.set("predictle:history", h);
};
// the name shared by every jacob.gg game (kit/jgg.js), else this game's own
const playerName = () => window.JGG?.name() || store.get("predictle:name", "") || "";
let changingName = false;

// ---------------------------------------------------------------- header
$("#daynum").textContent = `Daily #${dayNumber(date)}`;
if (isArchive) {
  $("#challenge-label").replaceChildren(`Archive · ${prettyDate(date)} `, el("span", { class: "late-badge" }, "played late"));
} else if (window.JGG) {
  $("#challenge-label").replaceChildren(JGG.levelChip(date));
}
function tickCountdown() {
  if (todayUTC() !== today) { $("#countdown").replaceChildren(el("a", { href: "./" }, "new puzzles ready — refresh")); return; }
  const s = Math.floor(msUntilNextDay() / 1000), pad = (n) => String(n).padStart(2, "0");
  $("#countdown").textContent = `next in ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
tickCountdown();
setInterval(tickCountdown, 1000);
for (const [name, m] of Object.entries(MATERIALS)) {
  const sw = el("canvas", { width: 32, height: 32, "aria-hidden": "true" });
  $("#legend").append(el("span", {}, sw, `${m.label} `, el("small", {}, m.note)));
  const r = new Renderer(sw, { world: { width: 1, height: 1 } }, null);
  r.scale = 32; r.tile = 15;
  r.ctx.setTransform(32, 0, 0, -32, 0, 32);
  r.drawShape({ t: "box", x: 0.5, y: 0.5, hw: 0.5, hh: 0.5, m: name });
}
setupArchive();

// ---------------------------------------------------------------- loading a day
async function fetchDay(d) {
  const res = await fetch(`./${dayFile(d)}`, { cache: "no-cache" });
  if (!res.ok) return null;
  const gz = await res.arrayBuffer();
  const raw = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return unpackDay(new Uint8Array(raw));
}

/** No file for this day: build it right here (identical to what the file would hold). */
function buildInBrowser(d, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./gen/worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.progress) return onProgress(data.progress);
      w.terminate();
      if (data.error) return reject(new Error(data.error));
      let k = 0;
      const motions = data.header.puzzles.map((p) => p.recordings.map((r) => decodeMotion(new Uint8Array(data.streams[k++]), p.bodies.length, r.frameCount)));
      resolve({ header: data.header, motions });
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ date: d });
  });
}

const mainArea = $("#main-area");
let day;
try {
  day = new URLSearchParams(location.search).has("build") ? null : await fetchDay(date);
  if (!day) {
    const status = el("span", {}, "Starting…");
    mainArea.replaceChildren(el("p", { class: "board-locked" },
      "There's no ready-made file for this day, so your browser is building it from the date (everyone gets exactly the same puzzles). This can take a minute or two. ", status));
    day = await buildInBrowser(date, ({ round, attempt }) => {
      status.textContent = round < 2 ? `Round ${round + 1}: trying design ${attempt + 1}…` : "Bonus laser puzzle…";
    });
  }
} catch (e) {
  console.error(e);
  mainArea.replaceChildren(el("p", { class: "error" }, `Couldn't load the puzzles: ${e.message ?? e}`));
}
if (day) {
  showMain();
  showBonus();
  api.ready.then(() => { showBoard(); showYesterday(); });
}

// ---------------------------------------------------------------- main card
function showMain() {
  if (mainDone()) return showDailyScore();
  if (state.scores[0] != null) return playRound(1);
  showStart();
}

function showStart() {
  const nameInput = el("input", { id: "name", type: "text", maxlength: 20, autocomplete: "nickname", autocapitalize: "none", autocorrect: "off", placeholder: "e.g. jacob", value: playerName() });
  const err = el("p", { class: "error", hidden: true });
  const start = el("button", { class: "submit", onclick: () => {
    const n = nameInput.value.replace(/\s+/g, " ").trim();
    if (!n) { err.textContent = "Pick a name for the leaderboard first."; err.hidden = false; nameInput.focus(); return; }
    store.set("predictle:name", n);
    window.JGG?.setName(n);
    changingName = false;
    state.started = true; save();
    playRound(state.scores[0] == null ? 0 : 1);
  } }, "Start round 1 of 2");
  const known = changingName ? "" : playerName();
  swapIn(mainArea, [el("div", { class: "play" },
    known
      ? el("p", { class: "playing-as" }, "Playing as", el("b", { class: "who", dir: "auto", title: known }, known), "·", el("button", { type: "button", class: "jgg-change", onclick: () => { changingName = true; showStart(); } }, "change"))
      : el("label", { class: "field" }, el("span", { class: "label" }, "Your name"), nameInput),
    err, start,
    el("p", { class: "fineprint" }, `${["Monday: the gentlest day of the week", "Tuesday: still gentle", "Wednesday: a bit trickier", "Thursday: midweek", "Friday: getting tough", "Saturday: tough", "Sunday: the toughest day of the week"][weekdayOf(date)]}. One go per day.`))], !changingName); // editing the name swaps one line, so the card stays still
}

// a stage (canvas, slow-mo badge, skip button) inside a container
function makeStage(container, pillText, pillClass, stepText, question) {
  const canvas = el("canvas", { class: "view", "aria-label": "Puzzle picture" });
  const badge = el("div", { class: "slowmo", hidden: true }, "Slow motion");
  const skip = el("button", { class: "skip", hidden: true }, "Skip ⏭");
  const prompt = el("p", { class: "question" }, question);
  const controls = el("div", { class: "controls" });
  const result = el("div", { hidden: true });
  swapIn(container, [
    el("div", { class: "round-head" }, el("span", { class: `pill ${pillClass}` }, pillText), el("span", { class: "eyebrow" }, stepText)),
    prompt, el("div", { class: "stage" }, canvas, badge, skip), controls, result]);
  const ac = new AbortController();
  container._stop = () => ac.abort();
  scrollTo(container, "start");
  return { canvas, badge, skip, prompt, controls, result, signal: ac.signal };
}

/** Tap/drag to place a guess, with a magnifier under the finger on touch screens. */
function tapInput(canvas, r, signal, active, onPoint) {
  let dragging = false;
  const at = (e) => {
    const w = r.toWorld(e.clientX, e.clientY);
    onPoint(w);
    r.loupe = e.pointerType === "touch" ? { x: w.px, y: w.py } : null;
    r.wake();
  };
  const on = (type, fn) => canvas.addEventListener(type, fn, { signal });
  on("pointerdown", (e) => { if (!active()) return; dragging = true; canvas.setPointerCapture(e.pointerId); at(e); });
  on("pointermove", (e) => { if (dragging && active()) at(e); });
  const up = () => { dragging = false; r.loupe = null; r.wake(); };
  on("pointerup", up);
  on("pointercancel", up);
}

function roundResult(result, score, text, buttons) {
  const num = el("span", { class: "num" }, String(points(score))), box = el("div", { class: "round-result" }, num, el("p", {}, `/100 ${emoji(score)} · ${text}`));
  result.hidden = false;
  result.replaceChildren(box, el("div", { class: "controls" }, buttons));
  M()?.enter(box, { kind: "reveal" });
  M()?.settle(num, points(score)); // tap to skip; the buttons are there at once
  scrollTo(result, "nearest");
}

// ---------------------------------------------------------------- a freeze-frame round
function playRound(i) {
  const p = day.header.puzzles[i];
  const W = p.world.width, H = p.world.height;
  const mainK = p.bodies.findIndex((b) => b.role === "main");
  const s0 = p.bodies[mainK].shapes[0];
  const mainR = s0.t === "circle" ? s0.r : Math.max(s0.hw, s0.hh);
  const { canvas, badge, skip, prompt, controls, result, signal } = makeStage(mainArea, p.slot, p.slot, `Round ${i + 1} of 2`, "Watch the start…");
  const meta = { world: p.world, fps: p.fps, frameCount: p.recordings[0].frameCount, keyFrame: p.recordings[0].keyFrame, statics: p.statics, decor: p.decor, bodies: p.bodies };
  const r = new Renderer(canvas, meta, day.motions[i][0]);

  let phase = "watch";            // watch -> predict -> play -> done
  let frame = 0, wall = 0, playing = true, slow = null, guess = null, ended = null, doneAt = 0;
  const last = meta.frameCount - 1, freezeAt = p.freezeFrame;
  const RING = 0.32; // s: the answer ring grows in (--jgg-t-reveal)
  const ringK = () => (calm() ? 1 : Math.min(1, (wall - doneAt) / RING));

  skip.onclick = () => { frame = phase === "watch" ? freezeAt : last; };
  drawLoop(canvas, r, signal, (dt) => {
    wall += dt;
    if (playing) {
      const inSlow = slow && frame >= slow[0] && frame <= slow[1];
      badge.hidden = !inSlow;
      skip.hidden = false;
      frame += dt * p.fps * (inSlow ? 0.3 : 1);
      if (phase === "watch" && frame >= freezeAt) { frame = freezeAt; playing = false; skip.hidden = true; phase = "predict"; canvas.classList.add("takes-input"); prompt.textContent = p.question; showInput(); }
      if (phase !== "watch" && frame >= last) { frame = last; playing = false; badge.hidden = true; skip.hidden = true; ended?.(); ended = null; }
    }
  }, () => r.draw(frame, wall),
  // playback and the answer ring: every frame; the pulsing ring while you predict: ~30 fps; otherwise asleep
  () => (playing || (phase === "done" && ringK() < 1) ? 1 : phase === "predict" && !calm() ? 2 : 0));

  const playFrom = (start, slowmo = true) => {
    frame = start;
    const k = meta.keyFrame;
    slow = slowmo && k != null ? [k - p.fps * 0.5, k + p.fps * 0.7] : null;
    playing = true;
    r.wake();
    return new Promise((res) => (ended = res));
  };

  const GUESS = "#d9480f", ANSWER = "#1a7f37";
  r.overlay = (ctx, f, t) => {
    const px = 1 / r.scale;
    if (phase === "predict") {
      const q = r.motion.bodies[mainK], fi = Math.round(f);
      ctx.strokeStyle = "rgba(75,91,220,0.95)"; ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.arc(q.x[fi], q.y[fi], mainR + 0.08 + 0.04 * Math.sin(t * 5), 0, 7); ctx.stroke();
    }
    if (guess) {
      ctx.strokeStyle = GUESS; ctx.lineWidth = 3 * px;
      ctx.setLineDash([5 * px, 4 * px]); ctx.beginPath(); ctx.arc(guess.x, guess.y, mainR, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      const a = mainR * 0.6;
      ctx.beginPath(); ctx.moveTo(guess.x - a, guess.y - a); ctx.lineTo(guess.x + a, guess.y + a); ctx.moveTo(guess.x - a, guess.y + a); ctx.lineTo(guess.x + a, guess.y - a); ctx.stroke();
    }
    if (phase === "done") {
      // the answer ring grows from 0.9x and fades in, then the line from your guess
      const fin = p.answer.final, k = ringK(), e = easeOut(k);
      ctx.strokeStyle = ANSWER; ctx.lineWidth = 4 * px; ctx.globalAlpha = e;
      ctx.beginPath(); ctx.arc(fin.x, fin.y, (mainR + 0.1) * (0.9 + 0.1 * e), 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
      // the line fades in as the ring settles (the last 15% of its ease), not after a visible pause
      if (guess && e > 0.85) {
        ctx.globalAlpha = Math.min(1, (e - 0.85) / 0.15);
        ctx.setLineDash([4 * px, 4 * px]); ctx.beginPath(); ctx.moveTo(guess.x, guess.y); ctx.lineTo(fin.x, fin.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
  };

  const lockBtn = el("button", { class: "submit", disabled: true, onclick: () => lockIn() }, "Lock in");
  const readout = el("span", { class: "readout" }, "Tap where it will come to rest.");
  const clearBtn = el("button", { class: "ghost", onclick: () => { guess = null; lockBtn.disabled = true; readout.textContent = "Tap where it will come to rest."; r.wake(); } }, "Clear");
  const again = el("button", { class: "ghost", onclick: () => { if (phase === "predict") { phase = "watch"; canvas.classList.remove("takes-input"); prompt.textContent = "Watch the start…"; controls.replaceChildren(); playFrom(0, false); } } }, "Watch again");
  function showInput() { controls.replaceChildren(readout, again, clearBtn, lockBtn); }
  tapInput(canvas, r, signal, () => phase === "predict", (w) => {
    guess = { x: Math.min(W - 0.2, Math.max(0.2, w.x)), y: Math.min(H - 0.2, Math.max(0.2, w.y)) };
    lockBtn.disabled = false; readout.textContent = "Drag to adjust, then lock in.";
  });

  async function lockIn() {
    if (!guess || phase !== "predict") return;
    phase = "play"; canvas.classList.remove("takes-input");
    controls.replaceChildren(el("span", { class: "readout" }, "Watch…"));
    await playFrom(freezeAt);
    phase = "done"; doneAt = wall; r.wake();
    const score = scorePuzzle(p, guess);
    state.guesses[i] = guess; state.scores[i] = score; save();
    const d = hypot(guess.x - p.answer.final.x, guess.y - p.answer.final.y);
    controls.replaceChildren();
    if (i === 1) { submitBoard("main"); showBonus(); }
    roundResult(result, score, `${d.toFixed(2)} m from where it stopped`, [
      el("button", { class: "ghost", onclick: () => playFrom(Math.max(0, (meta.keyFrame ?? 0) - p.fps * 1.2)) }, "Replay key moment"),
      el("button", { class: "ghost", onclick: () => playFrom(0, false) }, "Replay all"),
      el("button", { class: "submit", onclick: () => (i === 0 ? playRound(1) : showDailyScore("all")) }, i === 0 ? "Round 2 of 2 →" : "See my daily score"),
    ]);
  }
}

// ---------------------------------------------------------------- daily score (ridd-le style)
function shareText() {
  const main = `${emoji(state.scores[0])}${emoji(state.scores[1])} ${points(mainTotal())}/200`;
  const bonus = bonusDone() ? ` · 🎁${emoji(state.scores[2])} ${points(state.scores[2])}` : "";
  return `predictle #${dayNumber(date)} ${main}${bonus}\n${location.origin}${location.pathname}${isArchive ? `?date=${date}` : ""}`;
}

function streak() {
  const h = store.get("predictle:history", {});
  let s = 0;
  for (let d = today; h[d]?.main != null; d = addDays(d, -1)) s++;
  return s;
}

/** fresh: "all" just after round 2 (the score counts up, the rows reveal), "bonus" just after the bonus (only its row
 *  reveals); nothing on a reload. The share text, Copy button and boards are there at once. */
function showDailyScore(fresh) {
  const copy = el("button", { class: "ghost", onclick: async () => {
    try { await navigator.clipboard.writeText(shareText()); copy.textContent = "Copied!"; } catch { copy.textContent = "Select the text to copy"; }
  } }, "Copy result");
  const st = streak();
  const total = points(mainTotal()), num = el("span", {}, String(total));
  const row = (label, s) => el("li", {}, el("span", {}, label), el("b", {}, `${points(s)} ${emoji(s)}`));
  const rows = [row("Round 1 · easy", state.scores[0]), row("Round 2 · hard", state.scores[1])];
  if (bonusDone()) rows.push(row("🎁 Bonus · laser", state.scores[2]));
  swapIn(mainArea, [el("div", { class: "attempts" },
    el("p", { class: "eyebrow" }, isArchive ? "Your archive score" : "Daily score"),
    el("p", { class: "score" }, num, el("small", {}, " / 200")),
    el("ol", { class: "attempt-list" }, rows),
    el("pre", { class: "share" }, shareText()),
    el("div", { class: "controls" }, copy),
    el("p", { class: "fineprint", style: "margin-top: .9rem" }, isArchive ? "Archive play: counted on that day's late board only." : `Streak: ${st} day${st === 1 ? "" : "s"}. Come back tomorrow for new contraptions.`),
    bonusDone() ? null : el("button", { class: "play-bonus-button", onclick: () => scrollTo($("#bonus"), "start") }, "🎁 Play the bonus round →"),
    el("div", { id: "rate" }))], false);
  if (fresh === "all") { M()?.settle(num, total); M()?.reveal(rows); }
  if (fresh === "bonus" && rows[2]) M()?.reveal([rows[2]]);
  window.JGG?.rate({ game: "predictle", day: date, mount: $("#rate") });
}

// ---------------------------------------------------------------- the laser bonus
function showBonus() {
  const card = $("#bonus"), area = $("#bonus-area");
  card.hidden = false;
  if (!mainDone()) { swapIn(area, [el("p", { class: "bonus-locked" }, "🔒 Unlocks once you've finished both rounds.")]); return; }
  if (bonusDone()) { bonusDoneView(); return; }
  const aim = day.header.puzzles[2].format === "aim";
  $(".bonus-note").textContent = aim
    ? "Aim the laser so its beam passes through the target. Mirrors (and mirrored bits of wall) reflect, glass bends light, dark blocks and plain walls absorb it. You see the first half of the beam before you fire."
    : "A laser fires into a box of mirrors. Every mirror reflects on both sides; dark blocks absorb the beam. Tap the wall where it will hit.";
  swapIn(area, [el("button", { class: "submit", style: "width: 100%", onclick: () => (aim ? playAim() : playLaser()) }, aim ? "Aim the laser" : "Fire the laser")]);
}

function bonusFinished() { bonusDoneView(); if (mainDone()) showDailyScore("bonus"); }

function bonusDoneView() {
  const area = $("#bonus-area");
  swapIn(area, [
    el("p", { class: "eyebrow" }, "Bonus score"),
    el("p", { class: "score" }, String(points(state.scores[2])), el("small", {}, " / 100")),
    el("div", { class: "bonus-board", id: "bonus-board" })]);
  fillBoard($("#bonus-board"), "bonus", (row) => `${emoji(row.total)} ${points(row.total)}`);
}

function playLaser() {
  const p = day.header.puzzles[2];
  const world = p.world;
  const { canvas, skip, controls, result, signal } = makeStage($("#bonus-area"), "bonus", "bonus", "Laser", p.question);
  const r = new Renderer(canvas, { world, fps: 30, frameCount: 1, keyFrame: null, statics: [], decor: [], bodies: [] }, { bodies: [] });
  const total = beamLength(p.answer.path);
  const STUB = 0.7; // how much beam you see before you guess
  let phase = "predict", shown = STUB, guess = null, wall = 0, ended = null;
  canvas.classList.add("takes-input");
  const speed = Math.max(4, total / 5); // m/s: the whole beam in at most ~5 s

  skip.onclick = () => { shown = total; };
  drawLoop(canvas, r, signal, (dt) => {
    wall += dt;
    if (shown < total && phase !== "predict") {
      skip.hidden = false;
      shown = Math.min(total, shown + dt * speed);
      if (shown >= total) { skip.hidden = true; ended?.(); ended = null; }
    }
  }, () => r.draw(0, wall), () => (shown < total && phase !== "predict" ? 1 : phase === "predict" && !calm() ? 2 : 0));
  r.overlay = (ctx, _f, t) => drawLaser(ctx, p, { px: 1 / r.scale, shown, guess, answer: phase === "done" && shown >= total ? p.answer.hit : null, time: t });

  const lockBtn = el("button", { class: "submit", disabled: true, onclick: () => lockIn() }, "Lock in");
  const readout = el("span", { class: "readout" }, "Tap the wall where the beam will hit.");
  controls.append(readout, el("button", { class: "ghost", onclick: () => { guess = null; lockBtn.disabled = true; r.wake(); } }, "Clear"), lockBtn);
  tapInput(canvas, r, signal, () => phase === "predict", (w) => {
    guess = perimeterPoint(perimeterPos(w, world), world); // snap to the nearest wall
    lockBtn.disabled = false; readout.textContent = "Drag along the wall to adjust, then lock in.";
  });

  async function lockIn() {
    if (!guess || phase !== "predict") return;
    phase = "play"; canvas.classList.remove("takes-input");
    controls.replaceChildren(el("span", { class: "readout" }, "Firing…"));
    r.wake();
    await new Promise((res) => (ended = res));
    phase = "done"; r.wake();
    const score = scorePuzzle(p, guess);
    state.guesses[2] = guess; state.scores[2] = score; save();
    submitBoard("bonus");
    const P = 2 * (world.width + world.height), a = perimeterPos(guess, world), b = perimeterPos(p.answer.hit, world);
    const miss = Math.min(Math.abs(a - b), P - Math.abs(a - b));
    controls.replaceChildren();
    roundResult(result, score, `${p.answer.bounces} reflections · ${miss.toFixed(2)} m away along the wall`, [
      el("button", { class: "ghost", onclick: () => { shown = STUB; r.wake(); } }, "Fire again"),
      el("button", { class: "submit", onclick: bonusFinished }, "Done"),
    ]);
  }
}

// ---------------------------------------------------------------- the aim-the-laser bonus
function playAim() {
  const p = day.header.puzzles[2];
  const { canvas, skip, controls, result, signal } = makeStage($("#bonus-area"), "bonus", "bonus", "Laser", p.question);
  const r = new Renderer(canvas, { world: p.world, fps: 30, frameCount: 1, keyFrame: null, statics: [], decor: [], bodies: [] }, { bodies: [] });
  const e = p.emitter;
  let aim = Math.atan2(p.target.y - e.y, p.target.x - e.x) + 0.6; // start somewhere that isn't the answer
  let phase = "aim", tr = traceBeam(p, e, aim, p.target), shown = p.previewLength, wall = 0, ended = null;
  let locked = null; // { a, path, closestAt }
  canvas.classList.add("takes-input");
  const total = () => pathLength(tr.path);
  const retrace = () => { tr = traceBeam(p, e, aim, p.target); if (phase !== "fire") shown = phase === "aim" ? p.previewLength : Infinity; r.wake(); };
  const deg = (a) => (((a * 180) / Math.PI) % 360 + 360) % 360;

  skip.onclick = () => { shown = total(); };
  drawLoop(canvas, r, signal, (dt) => {
    wall += dt;
    if (phase === "fire") {
      skip.hidden = false;
      shown = Math.min(total(), shown + dt * Math.max(5, total() / 4));
      if (shown >= total()) { skip.hidden = true; ended?.(); ended = null; }
    }
  }, () => r.draw(0, wall), () => (phase === "fire" ? 1 : phase === "aim" && !calm() ? 2 : 0));
  r.overlay = (ctx, _f, t) => drawAim(ctx, p, {
    px: 1 / r.scale, aim, path: tr.path, shown, time: t,
    showRing: phase === "explore", guessPath: phase === "explore" ? locked?.path : null,
    closestAt: phase === "done" || (phase === "explore" && locked) ? (phase === "explore" ? tr.closestAt : locked.closestAt) : null, done: phase !== "aim" && phase !== "fire",
  });

  const readout = el("span", { class: "readout" });
  const showAngle = () => { readout.textContent = phase === "explore"
    ? `Exploring: ${deg(aim).toFixed(1)}° ${tr.closest <= TARGET_R ? "hits ✓" : `misses by ${(tr.closest - TARGET_R).toFixed(2)} m`}. Green on the ring = aims that hit.`
    : `Aim: ${deg(aim).toFixed(1)}°. Drag on the picture to aim; you see the first half of the beam.`; };
  const nudge = (d) => { if (phase === "aim" || phase === "explore") { aim += (d * Math.PI) / 180; retrace(); showAngle(); } };
  const lockBtn = el("button", { class: "submit", onclick: () => lockIn() }, "Fire");
  controls.append(readout, el("button", { class: "ghost", onclick: () => nudge(-0.1) }, "◀ 0.1°"), el("button", { class: "ghost", onclick: () => nudge(0.1) }, "0.1° ▶"), lockBtn);
  showAngle();
  tapInput(canvas, r, signal, () => phase === "aim" || phase === "explore", (w) => {
    if (Math.hypot(w.x - e.x, w.y - e.y) < 0.05) return;
    aim = Math.atan2(w.y - e.y, w.x - e.x);
    retrace(); showAngle();
  });

  async function lockIn() {
    if (phase !== "aim") return;
    phase = "fire"; canvas.classList.remove("takes-input"); shown = p.previewLength;
    controls.replaceChildren(el("span", { class: "readout" }, "Firing…"));
    r.wake();
    await new Promise((res) => (ended = res));
    phase = "done"; r.wake();
    const score = scorePuzzle(p, { a: aim });
    locked = { a: aim, path: tr.path, closestAt: tr.closestAt };
    state.guesses[2] = { a: aim }; state.scores[2] = score; save();
    submitBoard("bonus");
    const text = tr.closest <= TARGET_R ? "a direct hit!" : `closest the beam got: ${(tr.closest - TARGET_R).toFixed(2)} m from the target`;
    controls.replaceChildren();
    roundResult(result, score, text, [
      el("button", { class: "ghost", onclick: () => { phase = "explore"; canvas.classList.add("takes-input"); retrace(); showAngle(); controls.replaceChildren(readout, el("button", { class: "ghost", onclick: () => nudge(-0.1) }, "◀ 0.1°"), el("button", { class: "ghost", onclick: () => nudge(0.1) }, "0.1° ▶"), el("button", { class: "submit", onclick: bonusFinished }, "Done")); } }, "Explore other aims"),
      el("button", { class: "submit", onclick: bonusFinished }, "Done"),
    ]);
  }
}

// ---------------------------------------------------------------- leaderboards
function rowsFor(board, scoreOf) {
  if (!board.top.length) return el("p", { class: "board-empty" }, isArchive ? "Nobody played on the actual day." : "Nobody has played yet today. Be the first.");
  const ol = el("ol", { class: "rows" });
  const row = (r) => el("li", { class: `row${r.you ? " me" : ""}` },
    el("span", { class: "row-rank" }, String(r.rank)),
    el("span", { class: "row-name", dir: "auto", title: r.name }, r.name || "—"),
    el("span", { class: "row-score" }, scoreOf(r)));
  for (const r of board.top) ol.append(row(r));
  if (board.you) ol.append(row(board.you));
  return ol;
}
const mainScore = (r) => `${(r.scores ?? []).map(emoji).join("")} ${points(r.total)}`;

async function submitBoard(board) {
  await api.ready;
  if (!api.configured() || !playerName()) return;
  const key = `predictle:submitted:${board}:${date}`;
  if (store.get(key)) return;
  try {
    await api.submit(date, board, playerName(), board === "main" ? state.guesses.slice(0, 2) : [state.guesses[2]]);
    store.set(key, true);
  } catch (e) {
    if (/already/i.test(e.message)) store.set(key, true);
    else console.warn("leaderboard:", e.message);
  }
  if (board === "main") showBoard();
  else if ($("#bonus-board")) fillBoard($("#bonus-board"), "bonus", (row) => `${emoji(row.total)} ${points(row.total)}`);
}

/** Main board card; in the archive it shows that day's real board and the late board side by side. */
function showBoard() {
  if (!api.configured()) return;
  const card = $("#board");
  card.hidden = false;
  $("#board-title").textContent = isArchive ? `Leaderboards · #${dayNumber(date)}` : "Today's leaderboard";
  fillBoard($("#board-body"), "main", mainScore, (n) => ($("#players").textContent = `${n} player${n === 1 ? "" : "s"}`));
}

function fillBoard(container, board, scoreOf, onPlayers) {
  if (!api.configured()) return;
  Promise.all([api.board(date, board, false), isArchive ? api.board(date, board, true) : null]).then(([real, late]) => {
    onPlayers?.(real.players);
    if (!late) { container.replaceChildren(rowsFor(real, scoreOf)); return; }
    container.replaceChildren(el("div", { class: "archive-boards" },
      el("div", {}, el("h4", { class: "eyebrow" }, "That day's real leaderboard"), rowsFor(real, scoreOf)),
      el("div", {}, el("h4", { class: "eyebrow" }, "Late leaderboard ", el("span", { class: "late-badge" }, "not made on the original day")),
        late.top.length ? rowsFor(late, scoreOf) : el("p", { class: "board-empty" }, "Nobody has replayed this day yet."))));
  }).catch(() => container.replaceChildren(el("p", { class: "board-empty" }, "Couldn't load the leaderboard.")));
}

function showYesterday() {
  if (!api.configured() || isArchive) return;
  const y = addDays(today, -1);
  if (y < LAUNCH_DAY) return;
  $("#yesterday").hidden = false;
  $("#yesterday-title").textContent = `Yesterday's best · #${dayNumber(y)}`;
  const body = $("#yesterday-body");
  Promise.all([api.board(y, "main", false), api.board(y, "bonus", false)]).then(([m, b]) => {
    const top3 = (bd) => ({ ...bd, top: bd.top.slice(0, 3), you: null });
    body.replaceChildren(
      el("div", { class: "yesterday-rows" }, rowsFor(top3(m), mainScore)),
      el("div", { class: "yesterday-best" }, el("h3", { class: "eyebrow" }, "Yesterday's bonus round"),
        el("div", { class: "yesterday-rows" }, rowsFor(top3(b), (r) => `${emoji(r.total)} ${points(r.total)}`))),
      el("p", { class: "riddle-note" }, el("a", { href: `?date=${y}` }, "Play yesterday's contraptions →")));
  }).catch(() => ($("#yesterday").hidden = true));
}

// ---------------------------------------------------------------- archive dropdown
function setupArchive() {
  const btn = $("#archive-browse"), list = $("#archive-list");
  $("#archive-today").hidden = !isArchive;
  btn.addEventListener("click", () => {
    if (!list.hidden) { list.hidden = true; btn.textContent = "Browse archive"; return; }
    const h = store.get("predictle:history", {});
    list.replaceChildren();
    for (let d = addDays(today, -1); d >= LAUNCH_DAY; d = addDays(d, -1)) {
      const mine = h[d];
      list.append(el("li", {}, el("a", { class: `archive-list-item${d === date ? " current" : ""}`, href: `?date=${d}` },
        el("span", { class: "archive-list-day" }, `Daily #${dayNumber(d)} — ${prettyDate(d)}`),
        el("span", { class: "archive-list-prompt" }, mine?.main != null ? `You scored ${points(mine.main)}/200${mine.bonus != null ? ` · bonus ${points(mine.bonus)}` : ""}` : "Not played yet"))));
    }
    if (!list.children.length) list.append(el("li", { class: "archive-list-prompt" }, "No past days yet: today is the first."));
    M() ? M().enter(list) : (list.hidden = false);
    btn.textContent = "Hide archive";
  });
}
