// Generate daily puzzle files.
// Usage: node tools/gen/make-days.mjs --from 2026-10-09 --days 10 [--seed predictle-v1] [--scale 1]
// Writes public/puzzles/YYYY-MM-DD.prd (gzipped) and public/puzzles/index.json.
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { generatePool } from "./pool.mjs";
import { packDay } from "../../public/js/shared/codec.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SEED = arg("seed", "predictle-v1");
const FROM = arg("from", new Date().toISOString().slice(0, 10));
const DAYS = +arg("days", 7);
const SCALE = +arg("scale", 1);

// Attempts per format, sized from measured acceptance rates so every format has spares.
const ATTEMPTS = { stop: 90, freeze: 110, height: 260, time: 80, dominoes: 220, place: 260 };

// Three formats a day, rotating so each week covers all six.
export const DAY_FORMATS = [
  ["stop", "dominoes", "height"],
  ["freeze", "time", "place"],
  ["stop", "height", "time"],
  ["dominoes", "freeze", "place"],
  ["time", "stop", "height"],
  ["freeze", "dominoes", "stop"],
  ["height", "time", "place"],
];

// Difficulty rises Monday -> Sunday. Targets are percentiles of difficulty within
// a format's pool: Monday easy = 8th, Sunday hard = 100th (see docs/difficulty.md).
export function targets(weekday /* 0 = Monday */) {
  return { easy: 0.08 + 0.06 * weekday, medium: 0.24 + 0.08 * weekday, hard: 0.4 + 0.1 * weekday };
}
const SLOTS = ["easy", "medium", "hard"];

const r3 = (x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);
const round = (o) => JSON.parse(JSON.stringify(o, (_, v) => r3(v)));
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const weekday = (d) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
const dayNumber = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 864e5);

const attempts = Object.fromEntries(Object.entries(ATTEMPTS).map(([k, v]) => [k, Math.ceil(v * SCALE)]));
const t0 = performance.now();
let lastShown = 0;
const { accepted, rejected } = await generatePool(SEED, attempts, {
  onProgress: (d, n) => { if (d - lastShown >= 25 || d === n) { lastShown = d; process.stdout.write(`\r  ${d}/${n} candidates`); } },
});
console.log(`\npool: ${accepted.length} accepted in ${((performance.now() - t0) / 1000).toFixed(0)} s`);

// percentile of difficulty within each format
const byFormat = {};
for (const c of accepted) (byFormat[c.format] ??= []).push(c);
for (const list of Object.values(byFormat)) {
  const sorted = [...list].sort((a, b) => a.puzzle.difficulty - b.puzzle.difficulty);
  sorted.forEach((c, i) => (c.percentile = sorted.length > 1 ? i / (sorted.length - 1) : 0.5));
}
for (const f of Object.keys(ATTEMPTS)) console.log(`  ${f.padEnd(9)} ${(byFormat[f] ?? []).length} accepted of ${attempts[f]}`);
console.log("  rejections:", JSON.stringify(rejected));

// difficulty distribution of the pool, for docs/difficulty.md
writeFileSync(new URL("./pool-stats.json", import.meta.url), JSON.stringify({
  seed: SEED, attempts, rejected,
  formats: Object.fromEntries(Object.entries(byFormat).map(([f, list]) => [f, list.map((c) => ({ d: r3(c.puzzle.difficulty), bots: round(c.puzzle.bots), twists: c.puzzle.twists }))])),
}, null, 1));

const used = new Set();
const outDir = new URL("../../public/puzzles/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const indexFile = new URL("index.json", outDir);
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : { days: {} };
let prevHardTwist = null;

for (let d = 0; d < DAYS; d++) {
  const date = addDays(FROM, d), wd = weekday(date);
  const formats = DAY_FORMATS[((dayNumber(date) % 7) + 7) % 7];
  const tg = targets(wd);
  const puzzles = [], streams = [];
  formats.forEach((format, s) => {
    const slot = SLOTS[s], want = tg[slot];
    let pool = (byFormat[format] ?? []).filter((c) => !used.has(c.id));
    if (pool.length > 3) pool = pool.filter((c) => c.percentile >= 0.05); // never trivially easy
    if (slot === "hard" && prevHardTwist) {
      const fresh = pool.filter((c) => c.puzzle.twists[0] !== prevHardTwist);
      if (fresh.length) pool = fresh; // same twist type is never the hard slot two days running
    }
    if (!pool.length) throw new Error(`ran out of ${format} puzzles on ${date}: raise ATTEMPTS or --scale`);
    pool.sort((a, b) => Math.abs(a.percentile - want) - Math.abs(b.percentile - want));
    const c = pool[0];
    used.add(c.id);
    if (slot === "hard") prevHardTwist = c.puzzle.twists[0] ?? null;
    const main = c.scene.components.find((x) => x.role === "main");
    puzzles.push(round({
      id: `${SEED}:${c.id}`,
      slot,
      ...c.puzzle,
      percentile: c.percentile,
      launch: { x: main.x, y: main.y, vx: main.vx ?? 0, vy: main.vy ?? 0 },
      fps: 30,
      statics: c.runs[0].statics,
      decor: c.runs[0].decor,
      bodies: c.runs[0].bodies,
      recordings: c.runs.map((r) => ({ frameCount: r.frameCount, keyFrame: r.keyFrame, length: r.motion.length })),
    }));
    streams.push(...c.runs.map((r) => r.motion));
  });
  const file = gzipSync(packDay({ v: 2, date, seed: SEED, puzzles }, streams), { level: 9 });
  writeFileSync(new URL(`${date}.prd`, outDir), file);
  index.days[date] = puzzles.map((p) => `${p.slot}:${p.format}`);
  console.log(`${date} (${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][wd]})  ${puzzles.map((p) => `${p.slot} ${p.format} d=${p.difficulty.toFixed(0)} p${(p.percentile * 100).toFixed(0)}`).join(" | ")}  ${(file.length / 1024).toFixed(1)} KB`);
}
writeFileSync(indexFile, JSON.stringify(index, null, 1));
