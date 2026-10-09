import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { simulate } from "../tools/sim/simulate.mjs";
import { encodeMotion, packPuzzle, unpackPuzzle } from "../public/js/shared/codec.js";
import { PROTOTYPE } from "../tools/scenes/prototype.mjs";

test("simulation is deterministic: same scene, identical recording", async () => {
  const a = await simulate(PROTOTYPE), b = await simulate(PROTOTYPE);
  assert.deepEqual(a.recording, b.recording);
  assert.deepEqual(a.meta.keyFrame, b.meta.keyFrame);
});

test("playback matches the raw simulation at sampled frames (within 0.5 mm / 0.5 mrad)", async () => {
  const out = await simulate(PROTOTYPE);
  const file = gzipSync(packPuzzle(out.meta, encodeMotion(out.recording)));
  const { motion } = unpackPuzzle(new Uint8Array(gunzipSync(file)));
  for (let f = 0; f < out.meta.frameCount; f += 7) {
    out.recording.bodies.forEach((raw, k) => {
      assert.ok(Math.abs(raw.x[f] - motion.bodies[k].x[f]) <= 0.0005 + 1e-9, `x body ${k} frame ${f}`);
      assert.ok(Math.abs(raw.y[f] - motion.bodies[k].y[f]) <= 0.0005 + 1e-9, `y body ${k} frame ${f}`);
      assert.ok(Math.abs(raw.a[f] - motion.bodies[k].a[f]) <= 0.0005 + 1e-9, `a body ${k} frame ${f}`);
    });
  }
});

test("prototype stays on screen, settles within 15 s, and the main ball touches many components", async () => {
  const out = await simulate(PROTOTYPE);
  assert.deepEqual(out.outOfBounds, []);
  assert.ok(out.meta.mainSettledSeconds !== null && out.meta.mainSettledSeconds < 15);
  assert.ok(out.touched.length >= 2);
});
