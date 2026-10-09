import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreDistance, scoreHeight, scoreCount, scoreTime, scorePuzzle, emoji } from "../public/js/shared/scoring.js";

const near = (a, b, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("distance score: 0 only for the worst possible guess, 100 only for (nearly) exact", () => {
  const world = { width: 9, height: 12 };
  const actual = { x: 2, y: 1 };                       // farthest corner is (9, 12): dMax = hypot(7, 11)
  const dMax = Math.hypot(7, 11);
  near(scoreDistance(actual, actual, world), 100, 1e-9);
  near(scoreDistance({ x: 9, y: 12 }, actual, world), 0, 1e-9);
  near(scoreDistance({ x: 2 + 0.05 * dMax, y: 1 }, actual, world), 90.25, 0.01);
  near(scoreDistance({ x: 2 + 0.25 * dMax, y: 1 }, actual, world), 56.25, 0.01);
  near(scoreDistance({ x: 2 + 0.5 * dMax, y: 1 }, actual, world), 25, 0.01);
  // a typical miss of a metre or two still scores well; rounding to 100 needs ~4 cm
  assert.ok(scoreDistance({ x: 3.5, y: 1 }, actual, world) > 75);
  assert.ok(Math.round(scoreDistance({ x: 2.1, y: 1 }, actual, world)) < 100);
});

test("height, count and time scores", () => {
  near(scoreHeight(6, 6, 12), 100, 1e-9);
  near(scoreHeight(6.6, 6, 12), 89.5); // 5% of height
  assert.equal(scoreCount(4, 4, 6), 100);
  near(scoreCount(5, 4, 6), 67.7);
  near(scoreCount(6, 4, 6), 21.0);
  near(scoreTime(4.4, 4), 85.2);       // 10% off
  near(scoreTime(0.2, 0.5), 57.0);     // slack floor of 0.4 s for short times
});

test("scorePuzzle per format, and junk guesses score 0", () => {
  const W = { width: 9, height: 12 };
  assert.equal(scorePuzzle({ format: "stop", world: W, answer: { final: { x: 1, y: 2 } } }, { x: 1, y: 2 }), 100);
  assert.equal(scorePuzzle({ format: "dominoes", world: W, answer: { fallen: 3, total: 7 } }, { n: 3 }), 100);
  assert.equal(scorePuzzle({ format: "freeze", world: W, answer: { final: { x: 1, y: 2 } } }, { x: 1, y: 2 }), 100);
  assert.equal(scorePuzzle({ format: "place", world: W, answer: { finals: [{ x: 0, y: 0 }], target: { x: 5, y: 0 } } }, { choice: 7 }), 0);
  assert.equal(scorePuzzle({ format: "stop", world: W, answer: { final: { x: 1, y: 2 } } }, { x: "1", y: 2 }), 0);
  assert.equal(scorePuzzle({ format: "time", world: W, answer: { seconds: 3 } }, null), 0);
  assert.equal(scorePuzzle({ format: "dominoes", world: W, answer: { fallen: 3, total: 7 } }, { n: 2.5 }), 0);
});

test("emoji bands", () => {
  assert.deepEqual([95, 75, 40, 10].map(emoji), ["🟢", "🟡", "🟠", "🔴"]);
});
