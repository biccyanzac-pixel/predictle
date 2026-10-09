import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { makeDay } from "../tools/gen/make-days.mjs";
import { levelFor, MAX_SETTLE, CHAOS_LIMIT } from "../tools/gen/daily.mjs";
import { unpackDay } from "../public/js/shared/codec.js";

test("a day depends only on its date: generating it twice gives identical bytes", async () => {
  const a = await makeDay("2031-03-03"), b = await makeDay("2031-03-03");
  assert.ok(Buffer.from(a).equals(Buffer.from(b)));
});

test("difficulty level rises by round and through the week", () => {
  assert.ok(levelFor("2026-10-12", 0) < levelFor("2026-10-12", 1) && levelFor("2026-10-12", 1) < levelFor("2026-10-12", 2));
  assert.ok(levelFor("2026-10-12", 2) < levelFor("2026-10-18", 2)); // Monday hard < Sunday hard
  assert.ok(levelFor("2026-10-12", 0) < levelFor("2026-10-18", 0));
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
    assert.deepEqual(d.header.puzzles.map((p) => p.slot), ["easy", "medium", "hard"]);
    d.header.puzzles.forEach((p, i) => {
      assert.equal(p.format, "freeze");
      assert.ok(Math.abs(p.world.width * 4 - p.world.height * 3) < 0.01, "3:4 arena");
      assert.ok(p.chaosSpread <= CHAOS_LIMIT, `${d.date} ${p.slot} chaos`);
      assert.ok(p.freezeFrame > 0 && p.freezeFrame < p.recordings[0].frameCount);
      const { x } = p.answer.final;
      assert.ok(x >= 0.6 && x <= p.world.width - 0.6, `${d.date} ${p.slot} ends against a wall`);
      const m = d.motions[i][0];
      assert.ok(m.bodies[0].x.length / p.fps <= MAX_SETTLE + 1.6, `${d.date} ${p.slot} runs too long`);
      for (const b of m.bodies) for (let f = 0; f < b.x.length; f++) {
        assert.ok(b.x[f] > -0.06 && b.x[f] < p.world.width + 0.06 && b.y[f] > -0.06 && b.y[f] < p.world.height + 0.06, "off screen");
      }
    });
  }
});

test("no layout repeats across shipped rounds", () => {
  const seen = new Set();
  for (const d of shipped) for (const p of d.header.puzzles) {
    const k = JSON.stringify(p.statics);
    assert.ok(!seen.has(k), `${d.date} ${p.slot} repeats a layout`);
    seen.add(k);
  }
});
