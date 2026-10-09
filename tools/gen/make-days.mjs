// Write day files: public/puzzles/YYYY-MM-DD.prd, each = the date's 3 generated rounds.
// Usage: node tools/gen/make-days.mjs --from 2026-10-09 --days 7
// Each day depends only on its date (see daily.mjs), so days can be generated in any
// order, in parallel, on any machine, and regenerating a day gives the same bytes.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { generateRound, SLOTS } from "./daily.mjs";
import { encodeMotion, packDay } from "../../public/js/shared/codec.js";

const r3 = (x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);
const round3 = (o) => JSON.parse(JSON.stringify(o, (_, v) => r3(v)));

export async function makeDay(date) {
  const puzzles = [], streams = [];
  for (let k = 0; k < SLOTS.length; k++) {
    const g = await generateRound(date, k);
    // End the recording 1 s after the tracked object stops (other things may still be swinging).
    const fps = g.run.meta.fps;
    const frames = Math.min(g.run.meta.frameCount, Math.ceil((g.run.meta.mainSettledSeconds + 1) * fps) + 1);
    const rec = { ...g.run.recording, frameCount: frames, bodies: g.run.recording.bodies.map((b) => ({ x: b.x.slice(0, frames), y: b.y.slice(0, frames), a: b.a.slice(0, frames) })) };
    const motion = encodeMotion(rec);
    puzzles.push(round3({
      id: g.seed,
      slot: SLOTS[k],
      ...g.puzzle,
      fps: g.run.meta.fps,
      statics: g.run.meta.statics,
      decor: g.run.meta.decor,
      bodies: g.run.meta.bodies,
      recordings: [{ frameCount: frames, keyFrame: g.run.meta.keyFrame, length: motion.length }],
    }));
    streams.push(motion);
  }
  return gzipSync(packDay({ v: 2, date, puzzles }, streams), { level: 9 });
}

if (isMainThread) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const from = arg("from", new Date().toISOString().slice(0, 10));
  const days = +arg("days", 7);
  const dates = Array.from({ length: days }, (_, d) => new Date(Date.parse(`${from}T00:00:00Z`) + d * 864e5).toISOString().slice(0, 10));
  const outDir = new URL("../../public/puzzles/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const indexFile = new URL("index.json", outDir);
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : { days: {} };
  const threads = Math.min(dates.length, Math.max(1, availableParallelism() - 1));
  const t0 = performance.now();
  let done = 0;
  await Promise.all(Array.from({ length: threads }, (_, t) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { dates: dates.filter((_, i) => i % threads === t) } });
    w.on("message", ({ date, file }) => {
      writeFileSync(new URL(`${date}.prd`, outDir), Buffer.from(file));
      index.days[date] = true;
      console.log(`${date}  ${(file.length / 1024).toFixed(1)} KB  (${++done}/${dates.length})`);
    });
    w.on("error", reject);
    w.on("exit", resolve);
  })));
  index.days = Object.fromEntries(Object.keys(index.days).sort().map((d) => [d, true]));
  writeFileSync(indexFile, JSON.stringify(index, null, 1));
  console.log(`done in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
} else {
  for (const date of workerData.dates) parentPort.postMessage({ date, file: await makeDay(date) });
}
