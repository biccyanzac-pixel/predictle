// Phase 1 prototype: one hand-made contraption using every component type.
// Simulates it in Node, records it, writes public/puzzles/prototype.prd (gzipped).
// Usage: node tools/prototype.mjs [--trace]
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { simulate } from "./sim/simulate.mjs";
import { encodeMotion, packPuzzle, unpackPuzzle } from "../public/js/shared/codec.js";
import { PROTOTYPE } from "./scenes/prototype.mjs";


const trace = process.argv.includes("--trace");
const t0 = performance.now();
const out = await simulate(PROTOTYPE, { maxSeconds: 20 });
const simMs = performance.now() - t0;

const motion = encodeMotion(out.recording);
const file = gzipSync(packPuzzle(out.meta, motion), { level: 9 });
mkdirSync(new URL("../public/puzzles/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/puzzles/prototype.prd", import.meta.url), file);

// Round trip check: decoded positions equal the quantised originals.
const back = unpackPuzzle(new Uint8Array(gunzipSync(file)));
let maxErr = 0;
out.recording.bodies.forEach((b, k) => b.x.forEach((x, f) => {
  maxErr = Math.max(maxErr, Math.abs(x - back.motion.bodies[k].x[f]), Math.abs(b.y[f] - back.motion.bodies[k].y[f]));
}));

const names = PROTOTYPE.components.map((c, i) => `${i}:${c.type}${c.material ? "/" + c.material : ""}`);
console.log(`simulated ${(out.meta.frameCount / out.meta.fps).toFixed(1)} s in ${simMs.toFixed(0)} ms; settled at ${out.meta.settledSeconds ?? "never"} s (main ball ${out.meta.mainSettledSeconds ?? "never"} s)`);
console.log(`bodies ${out.meta.bodies.length}, frames ${out.meta.frameCount}, motion ${motion.length} B raw -> file ${file.length} B gzipped`);
console.log(`round-trip max error ${(maxErr * 1000).toFixed(3)} mm (quantum 1 mm -> expect <= 0.5)`);
console.log(`main ball touched: ${out.touched.map((i) => names[i]).join(", ")}`);
console.log(`out of bounds: ${out.outOfBounds.length ? out.outOfBounds.join(",") : "none"}; key frame ${out.meta.keyFrame}`);
if (trace) {
  const touchedBy = (comp) => new Set(out.contacts.filter((c) => c.a === comp || c.b === comp).map((c) => names[c.a === comp ? c.b : c.a]));
  for (const k of out.meta.bodies.map((b, k) => (b.label ? k : -1)).filter((k) => k >= 0)) {
    const t = out.recording.bodies[k];
    console.log(`\nbody ${k} (${out.meta.bodies[k].label}) path every 0.5 s:`);
    console.log(t.x.filter((_, f) => f % 15 === 0).map((x, j) => `${(j * 0.5).toFixed(1)}s(${x.toFixed(2)},${t.y[j * 15].toFixed(2)})`).join(" "));
    console.log(`  contacts: ${[...touchedBy(out.meta.bodies[k].comp)].join(", ")}`);
  }
  const dom = out.meta.bodies.map((b, k) => (b.kind === "domino" ? Math.abs(out.recording.bodies[k].a.at(-1)) > 0.6 : null)).filter((x) => x !== null);
  console.log(`\ndominoes fallen: ${dom.filter(Boolean).length}/${dom.length}`);
}
