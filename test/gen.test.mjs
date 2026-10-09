import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { candidate } from "../tools/gen/pool.mjs";
import { unpackDay } from "../public/js/shared/codec.js";
import { weekdayOf } from "../public/js/shared/daily.js";
import { MAX_SETTLE } from "../tools/gen/evaluate.mjs";

test("generator is deterministic: same seed, same candidate, same bytes", async () => {
  for (const [format, i] of [["stop", 3], ["dominoes", 5], ["height", 2]]) {
    const a = await candidate("test-seed", format, i), b = await candidate("test-seed", format, i);
    assert.deepEqual(a, b, `${format} ${i}`);
  }
});

const dir = new URL("../public/puzzles/", import.meta.url);
const days = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.prd$/.test(f)).sort();
const load = (f) => ({ date: f.slice(0, 10), size: readFileSync(new URL(f, dir)).length, ...unpackDay(new Uint8Array(gunzipSync(readFileSync(new URL(f, dir))))) });
const shipped = days.map(load);

test("shipped day files are valid, small, and have 3 puzzles with answers", () => {
  assert.ok(shipped.length > 0, "no day files");
  for (const d of shipped) {
    assert.equal(d.header.date, d.date);
    assert.ok(d.size < 200 * 1024, `${d.date} is ${d.size} bytes`);
    assert.equal(d.header.puzzles.length, 3);
    for (const p of d.header.puzzles) {
      assert.ok(p.answer && p.question && p.world.width * 4 === p.world.height * 3, `${d.date} ${p.format}`);
      assert.equal(p.recordings.length, p.format === "place" ? p.candidates.length : 1);
      assert.ok(p.chaosSpread !== undefined && p.difficulty !== undefined);
    }
  }
});

test("schedule rules: no repeated layout, no repeated hard twist on consecutive days, >= 4 formats a week", () => {
  const seen = new Set();
  for (const d of shipped) for (const p of d.header.puzzles) {
    const layout = JSON.stringify(p.statics);
    assert.ok(!seen.has(layout), `layout repeats on ${d.date}`);
    seen.add(layout);
  }
  for (let i = 1; i < shipped.length; i++) {
    const a = shipped[i - 1].header.puzzles.find((p) => p.slot === "hard"), b = shipped[i].header.puzzles.find((p) => p.slot === "hard");
    if (a.twists[0] && b.twists[0]) assert.notEqual(a.twists[0], b.twists[0], `${shipped[i].date}: same hard twist as the day before`);
  }
  for (let i = 0; i + 7 <= shipped.length; i++) {
    const formats = new Set(shipped.slice(i, i + 7).flatMap((d) => d.header.puzzles.map((p) => p.format)));
    assert.ok(formats.size >= 4, `week from ${shipped[i].date} has ${formats.size} formats`);
  }
});

test("difficulty rises through the week (hard slot percentile, Monday vs Sunday)", () => {
  const byDay = {};
  for (const d of shipped) (byDay[weekdayOf(d.date)] ??= []).push(d.header.puzzles.find((p) => p.slot === "hard").percentile);
  if (byDay[0] && byDay[6]) assert.ok(Math.max(...byDay[0]) < Math.min(...byDay[6]), "Monday's hard puzzle should be easier than Sunday's");
});

test("every shipped recording: nothing leaves the screen and the main ball settles in time", () => {
  for (const d of shipped) d.header.puzzles.forEach((p, i) => d.motions[i].forEach((m, k) => {
    const main = p.bodies.findIndex((b) => b.role === "main");
    for (const body of m.bodies) for (let f = 0; f < body.x.length; f++) {
      assert.ok(body.x[f] > -0.06 && body.x[f] < p.world.width + 0.06 && body.y[f] > -0.06 && body.y[f] < p.world.height + 0.06, `${d.date} ${p.format} off screen`);
    }
    if (p.format !== "place" || k === p.answer.solution) assert.ok(m.bodies[main].x.length / p.fps <= MAX_SETTLE + 1.6, `${d.date} ${p.format} runs too long`);
  }));
});
