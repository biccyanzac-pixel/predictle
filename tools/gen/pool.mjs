// Candidate pool, generated in parallel. Each candidate depends only on
// (seed, format, index), so the pool is identical however the work is split.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { makeRng } from "./rng.mjs";
import { buildScene } from "./recipe.mjs";
import { evaluate } from "./evaluate.mjs";
import { encodeMotion } from "../../public/js/shared/codec.js";

export async function candidate(seed, format, index) {
  const rng = makeRng(`${seed}:${format}:${index}`);
  const built = await buildScene(rng, format);
  if (!built) return null;
  const r = await evaluate(built.scene, format, built.extra);
  if (!r.ok) return { rejected: r.reason };
  // Keep only what the day file needs from the runs (the motion, already encoded).
  const candidateComp = built.scene.components.length; // index the candidate bumper gets in a "place" run
  const runs = r.runs.map((run) => ({
    motion: encodeMotion(run.recording),
    frameCount: run.meta.frameCount,
    keyFrame: run.meta.keyFrame,
    statics: run.meta.statics.filter((s) => s.comp !== candidateComp || format !== "place"),
    decor: run.meta.decor,
    bodies: run.meta.bodies,
  }));
  return { id: `${format}-${index}`, format, index, scene: built.scene, puzzle: r.puzzle, runs };
}

/** attempts: { format: count }. Returns { accepted: [...], rejected: { reason: n } }. */
export async function generatePool(seed, attempts, { threads = Math.max(1, availableParallelism() - 1), onProgress } = {}) {
  const jobs = Object.entries(attempts).flatMap(([format, n]) => Array.from({ length: n }, (_, index) => ({ format, index })));
  const accepted = [], rejected = {};
  let done = 0;
  await Promise.all(Array.from({ length: threads }, (_, t) => new Promise((resolve, reject) => {
    const mine = jobs.filter((_, j) => j % threads === t);
    const w = new Worker(new URL(import.meta.url), { workerData: { seed, jobs: mine } });
    w.on("message", (m) => {
      done++;
      if (m && m.runs) accepted.push(m);
      else { const k = m?.rejected ?? "recipe gave up"; rejected[k.replace(/[\d.]+%/g, "N%")] = (rejected[k.replace(/[\d.]+%/g, "N%")] ?? 0) + 1; }
      onProgress?.(done, jobs.length);
    });
    w.on("error", reject);
    w.on("exit", resolve);
  })));
  accepted.sort((a, b) => (a.format < b.format ? -1 : a.format > b.format ? 1 : a.index - b.index));
  return { accepted, rejected };
}

if (!isMainThread) {
  const { seed, jobs } = workerData;
  for (const { format, index } of jobs) parentPort.postMessage(await candidate(seed, format, index));
}
