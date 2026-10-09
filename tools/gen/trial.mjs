// Quick acceptance-rate check: node tools/gen/trial.mjs [attemptsPerFormat] [format...]
import { makeRng } from "./rng.mjs";
import { buildScene } from "./recipe.mjs";
import { evaluate, FORMATS } from "./evaluate.mjs";
const n = +process.argv[2] || 10;
const formats = process.argv.slice(3).length ? process.argv.slice(3) : FORMATS;
for (const format of formats) {
  const reasons = {}; let ok = 0; const t0 = performance.now(); const diffs = [];
  for (let i = 0; i < n; i++) {
    const rng = makeRng(`trial-${format}-${i}`);
    const built = await buildScene(rng, format);
    if (!built) { reasons["recipe gave up"] = (reasons["recipe gave up"] ?? 0) + 1; continue; }
    const r = await evaluate(built.scene, format, built.extra);
    if (r.ok) { ok++; diffs.push(r.puzzle.difficulty.toFixed(0) + ` [${Object.values(r.puzzle.bots).map((s) => s.toFixed(0)).join("/")}]`); }
    else { const k = r.reason.replace(/[\d.]+%/g, "N%"); reasons[k] = (reasons[k] ?? 0) + 1; }
  }
  console.log(`${format.padEnd(9)} ${ok}/${n} ok, ${((performance.now() - t0) / n).toFixed(0)} ms/attempt. difficulty [drop/ramp/rough]: ${diffs.join(", ")}`);
  console.log("   rejected:", JSON.stringify(reasons));
}
