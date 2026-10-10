// Write day files: public/puzzles/YYYY-MM-DD.prd. Each day depends only on its date
// (public/js/gen/day.js), so days can be made in any order, in parallel, on any machine
// or in a browser, and always come out byte-identical.
// Usage: node tools/gen/make-days.mjs --from 2026-10-09 --days 7
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { buildDay } from "../../public/js/gen/day.js";
import { packDay } from "../../public/js/shared/codec.js";

export async function makeDay(date) {
  const { header, streams } = await buildDay(date);
  return gzipSync(packDay(header, streams), { level: 9 });
}

if (isMainThread && process.argv[1]?.endsWith("make-days.mjs")) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const from = arg("from", new Date().toISOString().slice(0, 10));
  const days = +arg("days", 7);
  // --missing-ahead N: only the days from today to today+N that have no file yet (nightly job)
  const ahead = arg("missing-ahead", null);
  let dates = Array.from({ length: days }, (_, d) => new Date(Date.parse(`${from}T00:00:00Z`) + d * 864e5).toISOString().slice(0, 10));
  const list = arg("dates-file", null); // a file with one YYYY-MM-DD per line
  if (list) dates = readFileSync(list, "utf8").split(/\s+/).filter(Boolean);
  if (ahead !== null) {
    const today = new Date().toISOString().slice(0, 10);
    dates = Array.from({ length: +ahead + 1 }, (_, d) => new Date(Date.parse(`${today}T00:00:00Z`) + d * 864e5).toISOString().slice(0, 10))
      .filter((d) => !existsSync(new URL(`../../public/puzzles/${d}.prd`, import.meta.url)));
    console.log(`${dates.length} missing day(s) up to ${ahead} days ahead`);
    if (!dates.length) process.exit(0);
  }
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
} else if (!isMainThread) {
  for (const date of workerData.dates) parentPort.postMessage({ date, file: await makeDay(date) });
}
