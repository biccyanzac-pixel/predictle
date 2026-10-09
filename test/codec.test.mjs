import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { encodeMotion, decodeMotion, packPuzzle, unpackPuzzle, poseAt, POS_Q, ANG_Q } from "../public/js/shared/codec.js";

function randomRecording(seed, bodies = 5, frames = 200) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return {
    fps: 30, frameCount: frames,
    bodies: Array.from({ length: bodies }, () => {
      let x = rnd() * 9, y = rnd() * 12, a = 0, vx = 0, vy = 0;
      const t = { x: [], y: [], a: [] };
      for (let f = 0; f < frames; f++) {
        // smooth motion with occasional hard bounces and big angle swings
        if (rnd() < 0.03) { vx = (rnd() - 0.5) * 20; vy = (rnd() - 0.5) * 20; }
        x += vx / 30; y += vy / 30; a += (rnd() - 0.5) * 2;
        t.x.push(x); t.y.push(y); t.a.push(a);
      }
      return t;
    }),
  };
}

test("motion round-trips to within half a quantum", () => {
  const rec = randomRecording(7);
  const back = decodeMotion(encodeMotion(rec), rec.bodies.length, rec.frameCount);
  rec.bodies.forEach((b, k) => b.x.forEach((_, f) => {
    assert.ok(Math.abs(b.x[f] - back.bodies[k].x[f]) <= 0.5 / POS_Q + 1e-12);
    assert.ok(Math.abs(b.y[f] - back.bodies[k].y[f]) <= 0.5 / POS_Q + 1e-12);
    assert.ok(Math.abs(b.a[f] - back.bodies[k].a[f]) <= 0.5 / ANG_Q + 1e-12);
  }));
});

test("encoding is exact on already-quantised values, including negatives and large jumps", () => {
  const rec = { fps: 30, frameCount: 4, bodies: [{ x: [0, -5, 9000, -9000], y: [1.234, 1.234, 1.234, 0], a: [-3.141, 3.141, 100, -100] }] };
  const back = decodeMotion(encodeMotion(rec), 1, 4);
  assert.deepEqual([...back.bodies[0].x], rec.bodies[0].x);
  assert.deepEqual([...back.bodies[0].y], rec.bodies[0].y);
  assert.deepEqual([...back.bodies[0].a], rec.bodies[0].a);
});

test("pack/unpack carries the header and survives gzip", () => {
  const rec = randomRecording(3, 2, 50);
  const meta = { v: 1, frameCount: 50, bodies: [{ kind: "ball" }, { kind: "domino" }], note: "héllo" };
  const file = gzipSync(packPuzzle(meta, encodeMotion(rec)));
  const { meta: m2, motion } = unpackPuzzle(new Uint8Array(gunzipSync(file)));
  assert.deepEqual(m2, meta);
  assert.equal(motion.bodies.length, 2);
  assert.throws(() => unpackPuzzle(new Uint8Array(16)), /not a Predictle recording/);
});

test("trailing bytes are rejected", () => {
  const rec = randomRecording(1, 1, 10);
  const bytes = encodeMotion(rec);
  const extra = new Uint8Array(bytes.length + 1); extra.set(bytes);
  assert.throws(() => decodeMotion(extra, 1, 10), /trailing/);
});

test("poseAt interpolates between frames and clamps at the ends", () => {
  const b = { x: [0, 1], y: [0, 2], a: [0, 1] };
  assert.deepEqual(poseAt(b, 0.5), { x: 0.5, y: 1, a: 0.5 });
  assert.deepEqual(poseAt(b, -1), { x: 0, y: 0, a: 0 });
  assert.deepEqual(poseAt(b, 5), { x: 1, y: 2, a: 1 });
});
