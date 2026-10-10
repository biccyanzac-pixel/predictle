import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { makeDay } from "../tools/gen/make-days.mjs";
import { levelFor, MAX_SETTLE, CHAOS_LIMIT } from "../public/js/gen/daily.js";
import { V2_START } from "../public/js/gen/day.js";
import { SWEEP_N } from "../public/js/shared/optics.js";
import { unpackDay } from "../public/js/shared/codec.js";

test("a day depends only on its date: generating it twice gives identical bytes", async () => {
  const a = await makeDay("2031-03-03"), b = await makeDay("2031-03-03");
  assert.ok(Buffer.from(a).equals(Buffer.from(b)));
});

test("difficulty level rises by round and through the week", () => {
  assert.ok(levelFor("2026-10-12", 0) < levelFor("2026-10-12", 1));
  assert.ok(levelFor("2026-10-18", 0) < levelFor("2026-10-12", 1)); // even Sunday easy < Monday hard
  assert.ok(levelFor("2026-10-12", 1) < levelFor("2026-10-18", 1)); // Monday hard < Sunday hard
  assert.ok(levelFor("2026-10-12", 0) < levelFor("2026-10-18", 0));
});

test("shipped files are exactly what the generator makes for their date", async () => {
  // (days before V2_START were made by the first generator; their files are the only copy)
  const f = readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.prd$/.test(x) && x.slice(0, 10) >= V2_START).sort()[0];
  const made = await makeDay(f.slice(0, 10));
  assert.ok(Buffer.from(made).equals(readFileSync(new URL(f, dir))), `${f} differs from a fresh generation`);
});

const dir = new URL("../public/puzzles/", import.meta.url);
const shipped = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.prd$/.test(f)).sort().map((f) => {
  const bytes = readFileSync(new URL(f, dir));
  return { date: f.slice(0, 10), size: bytes.length, ...unpackDay(new Uint8Array(gunzipSync(bytes))) };
});

test("shipped days: 3 freeze-frame rounds, small files, fair and settled", () => {
  assert.ok(shipped.length > 0, "no day files");
  for (const d of shipped) {
    assert.equal(d.header.date, d.date);
    assert.ok(d.size < 200 * 1024);
    assert.deepEqual(d.header.puzzles.map((p) => p.slot), ["easy", "hard", "bonus"]);
    d.header.puzzles.forEach((p, i) => {
      if (p.slot === "bonus" && p.format === "aim") {
        assert.equal(p.sweep.length, SWEEP_N);
        assert.ok(p.answer.hitShare > 0 && p.answer.hitShare < 0.03, `${d.date} aim hit share`);
        assert.ok(p.previewLength > 0);
        return;
      }
      if (p.slot === "bonus") {
        assert.equal(p.format, "laser");
        assert.ok(p.answer.bounces >= 3, `${d.date} laser bounces`);
        const { x, y } = p.answer.hit, W = p.world.width, H = p.world.height;
        assert.ok(Math.min(x, W - x, y, H - y) < 1e-6, `${d.date} laser ends on a wall`);
        return;
      }
      assert.equal(p.format, "freeze");
      assert.ok(Math.abs(p.world.width * 4 - p.world.height * 3) < 0.01, "3:4 arena");
      assert.ok(p.chaosSpread <= CHAOS_LIMIT, `${d.date} ${p.slot} chaos`);
      assert.ok(p.freezeFrame > 0 && p.freezeFrame < p.recordings[0].frameCount);
      const { x } = p.answer.final;
      assert.ok(x >= 0.6 && x <= p.world.width - 0.6, `${d.date} ${p.slot} ends against a wall`);
      const m = d.motions[i][0];
      assert.ok(m.bodies[0].x.length / p.fps <= MAX_SETTLE + 1.6, `${d.date} ${p.slot} runs too long`);
      if (d.date >= V2_START) assert.ok(p.answer.final.y < 0.31 * p.world.height, `${d.date} ${p.slot} stops too high`);
      for (const b of m.bodies) for (let f = 0; f < b.x.length; f++) {
        assert.ok(b.x[f] > -0.06 && b.x[f] < p.world.width + 0.06 && b.y[f] > -0.06 && b.y[f] < p.world.height + 0.06, "off screen");
      }
    });
  }
});

test("no layout repeats across shipped rounds", () => {
  const seen = new Set();
  for (const d of shipped) for (const p of d.header.puzzles) {
    const k = JSON.stringify(p.statics ?? p.mirrors ?? p.pieces);
    assert.ok(!seen.has(k), `${d.date} ${p.slot} repeats a layout`);
    seen.add(k);
  }
});

test("aim scoring on a real day: a hitting aim scores 100, the worst aim scores ~0", async () => {
  const { scorePuzzle } = await import("../public/js/shared/scoring.js");
  const { sweepAngle, TARGET_R } = await import("../public/js/shared/optics.js");
  const d = shipped.find((x) => x.header.puzzles[2].format === "aim");
  assert.ok(d, "no aim day shipped");
  const p = d.header.puzzles[2];
  const hitK = p.sweep.findIndex((v) => v <= Math.round(TARGET_R * 100) - 2);
  assert.ok(hitK >= 0);
  assert.equal(scorePuzzle(p, { a: sweepAngle(hitK) }), 100);
  const worstK = p.sweep.indexOf(Math.max(...p.sweep));
  assert.ok(scorePuzzle(p, { a: sweepAngle(worstK) }) < 2);
  assert.equal(scorePuzzle(p, { x: 1, y: 2 }), 0); // wrong kind of guess
});
