// Predictle: the daily game page.
// Two freeze-frame rounds (easy, hard), then the laser bonus. Leaderboards for both,
// yesterday's best, and an archive of every past day.
import { unpackDay, decodeMotion } from "./shared/codec.js";
import { MATERIALS } from "./shared/materials.js";
import { scorePuzzle, points, emoji, perimeterPos, perimeterPoint } from "./shared/scoring.js";
import { hypot } from "./shared/dmath.js";
import { Renderer } from "./render.js";
import { drawLaser, beamLength } from "./laser-draw.js";
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

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: play on without saving */ } },
};

// ---------------------------------------------------------------- which day
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

// ---------------------------------------------------------------- header, countdown, help
$("#daynum").textContent = `#${dayNumber(date)}`;
$("#date").textContent = prettyDate(date);
function tickCountdown() {
  if (todayUTC() !== today) { $("#countdown").replaceChildren(el("a", { href: "./" }, "New puzzles: refresh")); return; }
  const s = Math.floor(msUntilNextDay() / 1000), pad = (n) => String(n).padStart(2, "0");
  $("#countdown").textContent = `next in ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
tickCountdown();
setInterval(tickCountdown, 1000);
$("#help-open").addEventListener("click", () => $("#help").showModal());
$("#help-close").addEventListener("click", () => $("#help").close());
buildLegend($("#legend"));
if (!store.get("predictle:seen-help")) { store.set("predictle:seen-help", true); $("#help").showModal(); }

function buildLegend(box) {
  for (const [name, m] of Object.entries(MATERIALS)) {
    const sw = el("canvas", { width: 44, height: 44, "aria-hidden": "true" });
    box.append(el("span", {}, sw, `${m.label} `, el("small", {}, m.note)));
    const r = new Renderer(sw, { world: { width: 1, height: 1 } }, null);
    r.scale = 44; r.tile = 20;
    r.ctx.setTransform(44, 0, 0, -44, 0, 44);
    r.drawShape({ t: "box", x: 0.5, y: 0.5, hw: 0.5, hh: 0.5, m: name });
  }
}

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

const app = $("#app");
let day;
try {
  day = new URLSearchParams(location.search).has("build") ? null : await fetchDay(date);
  if (!day) {
    const status = el("p", { class: "muted" }, "Starting…");
    app.replaceChildren(el("section", { class: "card" }, el("h2", {}, "Building the contraptions"),
      el("p", {}, "There's no ready-made file for this day, so your browser is generating it from the date. Everyone gets exactly the same puzzles. This can take a little while."),
      status));
    day = await buildInBrowser(date, ({ round, attempt }) => {
      status.textContent = round < 2 ? `Round ${round + 1}: trying design ${attempt + 1}…` : "Bonus laser puzzle…";
    });
  }
} catch (e) {
  console.error(e);
  app.replaceChildren(el("section", { class: "card" }, el("h2", {}, "Couldn't load the puzzles"), el("p", {}, String(e.message ?? e))));
}
if (day) {
  showMain();
  renderSideCards();
}

// ---------------------------------------------------------------- main area
function showMain() {
  if (!mainDone()) {
    if (state.scores[0] == null && !state.started) showIntro();
    else playRound(state.scores[0] == null ? 0 : 1);
  } else if (state.playingBonus && !bonusDone()) playLaser();
  else showSummary();
}

function archiveBanner() {
  if (!isArchive) return "";
  return el("p", { class: "banner" }, `Archive: #${dayNumber(date)}, ${prettyDate(date)}. Scores go on that day's "played later" board. `,
    el("a", { href: "./" }, "Back to today"));
}

function showIntro() {
  const tone = ["the gentlest day", "still gentle", "a bit trickier", "midweek", "getting tough", "tough", "the toughest day"][weekdayOf(date)];
  app.replaceChildren(archiveBanner(), el("section", { class: "card intro" },
    el("h2", {}, "Watch, freeze, predict."),
    el("p", {}, "Each contraption plays until just before the tricky part, then freezes. Tap where ", el("b", {}, "A"), " will come to rest, then watch what really happens."),
    el("ol", { class: "plan" },
      el("li", {}, el("b", {}, "Round 1"), " · easy"),
      el("li", {}, el("b", {}, "Round 2"), " · hard"),
      el("li", {}, el("b", {}, "Bonus"), " · where does the laser hit the wall?")),
    el("p", { class: "muted" }, `${DAY_NAMES[weekdayOf(date)]}: ${tone} of the week.`),
    el("button", { class: "primary big", onclick: () => { state.started = true; save(); playRound(0); } }, "Start"),
  ));
}

// ---------------------------------------------------------------- shared stage (canvas + skip + slow-mo badge)
function makeStage(head, question) {
  const canvas = el("canvas", { class: "view", "aria-label": "Puzzle picture" });
  const badge = el("div", { class: "slowmo", hidden: true }, "Slow motion");
  const skip = el("button", { class: "skip", hidden: true }, "Skip ⏭");
  const prompt = el("p", { class: "question" }, question);
  const controls = el("div", { class: "controls" });
  const result = el("div", { class: "result", hidden: true });
  app.replaceChildren(archiveBanner(), el("section", { class: "puzzle" }, head, prompt, el("div", { class: "stage" }, canvas, badge, skip), controls, result));
  window.scrollTo({ top: 0, behavior: "smooth" });
  return { canvas, badge, skip, prompt, controls, result };
}

/** Tap/drag to place a guess, with a magnifier under the finger on touch screens. */
function tapInput(canvas, r, active, onPoint) {
  let dragging = false;
  const at = (e) => {
    const w = r.toWorld(e.clientX, e.clientY);
    onPoint(w);
    r.loupe = e.pointerType === "touch" ? { x: w.px, y: w.py } : null;
  };
  canvas.addEventListener("pointerdown", (e) => { if (!active()) return; dragging = true; canvas.setPointerCapture(e.pointerId); at(e); });
  canvas.addEventListener("pointermove", (e) => { if (dragging && active()) at(e); });
  const up = () => { dragging = false; r.loupe = null; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
}

function resultBox(result, score, detailText, buttons) {
  result.hidden = false;
  result.replaceChildren(
    el("div", { class: "score" }, el("span", { class: "big-num" }, String(points(score))), el("span", { class: "of" }, "/100 "), emoji(score)),
    el("p", {}, detailText),
    el("div", { class: "controls" }, buttons));
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------------------------------------------------------------- a freeze-frame round
function playRound(i) {
  const p = day.header.puzzles[i];
  const W = p.world.width, H = p.world.height;
  const mainK = p.bodies.findIndex((b) => b.role === "main");
  const s0 = p.bodies[mainK].shapes[0];
  const mainR = s0.t === "circle" ? s0.r : Math.max(s0.hw, s0.hh);
  const head = el("div", { class: "puzzle-head" }, el("span", { class: "step" }, `Round ${i + 1} of 2`), el("span", { class: `slot ${p.slot}` }, p.slot));
  const { canvas, badge, skip, prompt, controls, result } = makeStage(head, "Watch the start…");
  const meta = { world: p.world, fps: p.fps, frameCount: p.recordings[0].frameCount, keyFrame: p.recordings[0].keyFrame, statics: p.statics, decor: p.decor, bodies: p.bodies };
  const r = new Renderer(canvas, meta, day.motions[i][0]);

  let phase = "watch";            // watch -> predict -> play -> done
  let frame = 0, wall = 0, playing = true, prev = null, slow = null, guess = null, ended = null;
  const last = meta.frameCount - 1, freezeAt = p.freezeFrame;

  skip.onclick = () => { frame = phase === "watch" ? freezeAt : last; };
  function tick(now) {
    if (!canvas.isConnected) return;
    const dt = prev === null ? 0 : Math.min(0.1, (now - prev) / 1000);
    prev = now; wall += dt;
    if (playing) {
      const inSlow = slow && frame >= slow[0] && frame <= slow[1];
      badge.hidden = !inSlow;
      skip.hidden = false;
      frame += dt * p.fps * (inSlow ? 0.3 : 1);
      if (phase === "watch" && frame >= freezeAt) { frame = freezeAt; playing = false; skip.hidden = true; phase = "predict"; prompt.textContent = p.question; showInput(); }
      if (phase !== "watch" && frame >= last) { frame = last; playing = false; badge.hidden = true; skip.hidden = true; ended?.(); ended = null; }
    }
    r.draw(frame, wall);
    requestAnimationFrame(tick);
  }
  new ResizeObserver(() => r.resize()).observe(canvas);
  requestAnimationFrame(tick);

  const playFrom = (start, slowmo = true) => {
    frame = start;
    const k = meta.keyFrame;
    slow = slowmo && k != null ? [k - p.fps * 0.5, k + p.fps * 0.7] : null;
    playing = true;
    return new Promise((res) => (ended = res));
  };

  const GUESS = "#d9480f", ANSWER = "#1a7f37";
  r.overlay = (ctx, f, t) => {
    const px = 1 / r.scale;
    if (phase === "predict") {
      const q = r.motion.bodies[mainK], fi = Math.round(f);
      ctx.strokeStyle = "rgba(15,143,122,0.9)"; ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.arc(q.x[fi], q.y[fi], mainR + 0.08 + 0.04 * Math.sin(t * 5), 0, 7); ctx.stroke();
    }
    if (guess) {
      ctx.strokeStyle = GUESS; ctx.lineWidth = 3 * px;
      ctx.setLineDash([5 * px, 4 * px]); ctx.beginPath(); ctx.arc(guess.x, guess.y, mainR, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      const a = mainR * 0.6;
      ctx.beginPath(); ctx.moveTo(guess.x - a, guess.y - a); ctx.lineTo(guess.x + a, guess.y + a); ctx.moveTo(guess.x - a, guess.y + a); ctx.lineTo(guess.x + a, guess.y - a); ctx.stroke();
    }
    if (phase === "done") {
      const fin = p.answer.final;
      ctx.strokeStyle = ANSWER; ctx.lineWidth = 4 * px;
      ctx.beginPath(); ctx.arc(fin.x, fin.y, mainR + 0.1, 0, 7); ctx.stroke();
      if (guess) { ctx.setLineDash([4 * px, 4 * px]); ctx.beginPath(); ctx.moveTo(guess.x, guess.y); ctx.lineTo(fin.x, fin.y); ctx.stroke(); ctx.setLineDash([]); }
    }
  };

  const lockBtn = el("button", { class: "primary", disabled: true, onclick: () => lockIn() }, "Lock in");
  const readout = el("span", { class: "readout" }, "Tap where it will stop");
  const clearBtn = el("button", { onclick: () => { guess = null; lockBtn.disabled = true; readout.textContent = "Tap where it will stop"; } }, "Clear");
  const again = el("button", { onclick: () => { if (phase === "predict") { phase = "watch"; prompt.textContent = "Watch the start…"; controls.replaceChildren(); playFrom(0, false); } } }, "Watch again");
  function showInput() { controls.replaceChildren(again, readout, clearBtn, lockBtn); }
  tapInput(canvas, r, () => phase === "predict", (w) => {
    guess = { x: Math.min(W - 0.2, Math.max(0.2, w.x)), y: Math.min(H - 0.2, Math.max(0.2, w.y)) };
    lockBtn.disabled = false; readout.textContent = "Drag to adjust";
  });

  async function lockIn() {
    if (!guess || phase !== "predict") return;
    phase = "play";
    controls.replaceChildren(el("span", { class: "muted" }, "Watch…"));
    await playFrom(freezeAt);
    phase = "done";
    const score = scorePuzzle(p, guess);
    state.guesses[i] = guess; state.scores[i] = score; save();
    const d = hypot(guess.x - p.answer.final.x, guess.y - p.answer.final.y);
    controls.replaceChildren();
    resultBox(result, score, `You were ${d.toFixed(2)} m from where it stopped.`, [
      el("button", { onclick: () => playFrom(Math.max(0, (meta.keyFrame ?? 0) - p.fps * 1.2)) }, "Replay key moment"),
      el("button", { onclick: () => playFrom(0, false) }, "Replay all"),
      el("button", { class: "primary", onclick: () => (i === 0 ? playRound(1) : (showSummary(), renderSideCards())) }, i === 0 ? "Round 2" : "See results"),
    ]);
  }
}

// ---------------------------------------------------------------- the laser bonus
function playLaser() {
  const p = day.header.puzzles[2];
  const world = p.world;
  const head = el("div", { class: "puzzle-head" }, el("span", { class: "step" }, "Bonus"), el("span", { class: "slot bonus" }, "laser"));
  const { canvas, skip, prompt, controls, result } = makeStage(head, p.question);
  void prompt;
  const r = new Renderer(canvas, { world, fps: 30, frameCount: 1, keyFrame: null, statics: [], decor: [], bodies: [] }, { bodies: [] });
  const total = beamLength(p.answer.path);
  const STUB = 0.7; // how much beam you see before you guess
  let phase = "predict", shown = STUB, guess = null, prev = null, wall = 0, ended = null;
  const speed = Math.max(4, total / 4.5); // m/s: the whole beam in at most ~4.5 s

  skip.onclick = () => { shown = total; };
  function tick(now) {
    if (!canvas.isConnected) return;
    const dt = prev === null ? 0 : Math.min(0.1, (now - prev) / 1000);
    prev = now; wall += dt;
    if (shown < total && phase !== "predict") {
      skip.hidden = false;
      shown = Math.min(total, shown + dt * speed);
      if (shown >= total) { skip.hidden = true; ended?.(); ended = null; }
    }
    r.draw(0, wall);
    requestAnimationFrame(tick);
  }
  new ResizeObserver(() => r.resize()).observe(canvas);
  requestAnimationFrame(tick);

  r.overlay = (ctx, _f, t) => drawLaser(ctx, p, { px: 1 / r.scale, shown, guess, answer: phase === "done" && shown >= total ? p.answer.hit : null, time: t });

  const lockBtn = el("button", { class: "primary", disabled: true, onclick: () => lockIn() }, "Lock in");
  const readout = el("span", { class: "readout" }, "Tap the wall where the beam will hit");
  controls.append(readout, el("button", { onclick: () => { guess = null; lockBtn.disabled = true; } }, "Clear"), lockBtn);
  tapInput(canvas, r, () => phase === "predict", (w) => {
    guess = perimeterPoint(perimeterPos(w, world), world); // snap to the nearest wall
    lockBtn.disabled = false; readout.textContent = "Drag along the wall to adjust";
  });

  async function lockIn() {
    if (!guess || phase !== "predict") return;
    phase = "play";
    controls.replaceChildren(el("span", { class: "muted" }, "Firing…"));
    await new Promise((res) => (ended = res));
    phase = "done";
    const score = scorePuzzle(p, guess);
    state.guesses[2] = guess; state.scores[2] = score; state.playingBonus = false; save();
    const P = 2 * (world.width + world.height), a = perimeterPos(guess, world), b = perimeterPos(p.answer.hit, world);
    const miss = Math.min(Math.abs(a - b), P - Math.abs(a - b));
    controls.replaceChildren();
    resultBox(result, score, `The beam bounced ${p.answer.bounces} times. You were ${miss.toFixed(2)} m away, measured along the wall.`, [
      el("button", { onclick: () => { shown = STUB; } }, "Fire again"),
      el("button", { class: "primary", onclick: () => { showSummary(); renderSideCards(); } }, "See results"),
    ]);
  }
}

// ---------------------------------------------------------------- summary
function shareText() {
  const main = `${emoji(state.scores[0])}${emoji(state.scores[1])} ${points(mainTotal())}/200`;
  const bonus = bonusDone() ? ` · ⚡${emoji(state.scores[2])} ${points(state.scores[2])}` : "";
  return `Predictle #${dayNumber(date)} ${main}${bonus}\n${location.origin}${location.pathname}${isArchive ? `?date=${date}` : ""}`;
}

function streak() {
  const h = store.get("predictle:history", {});
  let s = 0;
  for (let d = today; h[d]?.main != null; d = addDays(d, -1)) s++;
  return { streak: s, played: Object.values(h).filter((x) => x.main != null).length };
}

function showSummary() {
  const share = el("pre", { class: "share" }, shareText());
  const copy = el("button", { class: "primary", onclick: async () => {
    try { await navigator.clipboard.writeText(shareText()); copy.textContent = "Copied!"; } catch { copy.textContent = "Select the text to copy"; }
  } }, "Copy result");
  const { streak: st, played } = streak();
  app.replaceChildren(archiveBanner(), el("section", { class: "card" },
    el("h2", {}, `${points(mainTotal())} / 200 `, emoji(state.scores[0]), emoji(state.scores[1])),
    el("ul", { class: "scores" },
      el("li", {}, el("span", {}, "Round 1 · easy"), el("b", {}, `${points(state.scores[0])} ${emoji(state.scores[0])}`)),
      el("li", {}, el("span", {}, "Round 2 · hard"), el("b", {}, `${points(state.scores[1])} ${emoji(state.scores[1])}`)),
      bonusDone() ? el("li", {}, el("span", {}, "⚡ Bonus · laser"), el("b", {}, `${points(state.scores[2])} ${emoji(state.scores[2])}`)) : null),
    bonusDone() ? null : el("div", { class: "bonus-cta" },
      el("p", {}, el("b", {}, "⚡ Bonus round unlocked: "), "a laser fires into a box of mirrors. Where does it hit the wall?"),
      el("button", { class: "primary big", onclick: () => { state.playingBonus = true; save(); playLaser(); } }, "Play the bonus")),
    share,
    el("div", { class: "controls" }, copy),
    el("p", { class: "muted" }, `Streak: ${st} day${st === 1 ? "" : "s"} · days played: ${played}`),
  ));
}

// ---------------------------------------------------------------- leaderboards, yesterday, archive
function boardRows(board, scoreOf) {
  const list = el("ol", { class: "ranks" });
  if (!board.top.length) list.append(el("li", { class: "muted" }, "Nobody yet. Be the first."));
  for (const row of board.top) list.append(el("li", { class: row.you ? "you" : "" }, el("span", {}, `${row.rank}. ${row.name}`), el("span", {}, scoreOf(row))));
  if (board.you) list.append(el("li", { class: "you" }, el("span", {}, `${board.you.rank}. ${board.you.name}`), el("span", {}, scoreOf(board.you))));
  return list;
}
const mainScore = (row) => `${row.scores.map(emoji).join("")} ${points(row.total)}`;
const bonusScore = (row) => `⚡${emoji(row.total)} ${points(row.total)}`;

async function renderSideCards() {
  await api.ready;
  const side = $("#side");
  side.replaceChildren();
  if (api.configured()) {
    side.append(boardCard("main", isArchive ? "Leaderboard for this day" : "Today's leaderboard", mainDone(), () => state.guesses.slice(0, 2), mainScore));
    if (mainDone()) side.append(boardCard("bonus", "Bonus leaderboard ⚡", bonusDone(), () => [state.guesses[2]], bonusScore));
    if (!isArchive) side.append(yesterdayCard());
  }
  side.append(archiveCard());
}

function boardCard(board, title, canSubmit, guesses, scoreOf) {
  const card = el("section", { class: "card board" }, el("h3", {}, title));
  const status = el("p", { class: "muted" });
  const body = el("div");
  card.append(status, body);
  const subKey = `predictle:submitted:${board}:${date}`;
  const load = () => Promise.all([api.board(date, board, false), isArchive ? api.board(date, board, true) : null])
    .then(([onDay, late]) => {
      status.textContent = `${onDay.players} player${onDay.players === 1 ? "" : "s"} on the day`;
      body.replaceChildren(boardRows(onDay, scoreOf));
      if (late) body.append(el("h4", {}, `Played later (${late.players})`), boardRows(late, scoreOf));
    }).catch(() => (status.textContent = "Couldn't load the leaderboard."));
  if (canSubmit && !store.get(subKey)) {
    const name = el("input", { maxlength: 20, placeholder: "Your name", value: store.get("predictle:name", ""), "aria-label": "Your name" });
    const send = el("button", { class: "primary", onclick: async () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      store.set("predictle:name", n);
      send.disabled = true; status.textContent = "Sending…";
      try {
        await api.submit(date, board, n, guesses());
        store.set(subKey, true);
        form.remove();
        load();
      } catch (e) { status.textContent = e.message; send.disabled = false; }
    } }, "Add my score");
    const form = el("div", { class: "controls" }, name, send);
    card.insertBefore(form, status);
  } else if (!canSubmit) {
    card.append(el("p", { class: "muted small" }, "Play to add your score."));
  }
  load();
  return card;
}

function yesterdayCard() {
  const y = addDays(today, -1);
  const card = el("section", { class: "card" }, el("h3", {}, `Yesterday (#${dayNumber(y)})`));
  if (y < LAUNCH_DAY) { card.append(el("p", { class: "muted" }, "Predictle started today.")); return card; }
  const body = el("div", {}, el("p", { class: "muted" }, "Loading…"));
  card.append(body, el("p", {}, el("a", { href: `?date=${y}` }, "Play yesterday's puzzles →")));
  Promise.all([api.board(y, "main", false), api.board(y, "bonus", false)]).then(([m, b]) => {
    const best = (bd, f) => (bd.top[0] ? `${bd.top[0].name}, ${f(bd.top[0])}` : "nobody played");
    body.replaceChildren(
      el("p", {}, el("b", {}, "Best: "), best(m, mainScore), m.players ? ` (${m.players} played)` : ""),
      el("p", {}, el("b", {}, "Best bonus: "), best(b, bonusScore)));
  }).catch(() => body.replaceChildren(el("p", { class: "muted" }, "Couldn't load yesterday's results.")));
  return card;
}

function archiveCard() {
  const h = store.get("predictle:history", {});
  const days = [];
  for (let d = addDays(today, -1); d >= LAUNCH_DAY; d = addDays(d, -1)) days.push(d);
  const card = el("section", { class: "card archive" }, el("h3", {}, "Archive: replay a past day"));
  if (isArchive) card.append(el("p", {}, el("a", { href: "./" }, `← Today (#${dayNumber(today)})`)));
  if (!days.length) { card.append(el("p", { class: "muted" }, "Past days will appear here.")); return card; }
  const list = el("ul", { class: "days" });
  const item = (d) => {
    const mine = h[d];
    return el("li", { class: d === date ? "current" : "" }, el("a", { href: `?date=${d}` },
      el("span", {}, `#${dayNumber(d)} · ${prettyDate(d)}`),
      el("span", { class: "muted" }, mine?.main != null ? `${points(mine.main)}/200${mine.bonus != null ? ` · ⚡${points(mine.bonus)}` : ""}` : "not played")));
  };
  days.slice(0, 7).forEach((d) => list.append(item(d)));
  card.append(list);
  if (days.length > 7) {
    const more = el("button", { onclick: () => { days.slice(7).forEach((d) => list.append(item(d))); more.remove(); } }, `Show all ${days.length} days`);
    card.append(more);
  }
  return card;
}
