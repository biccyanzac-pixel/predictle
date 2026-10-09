import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreDistance, scoreHeight, scoreCount, scoreTime, scorePuzzle, emoji } from "../public/js/shared/scoring.js";

const near = (a, b, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("distance score: exact 100, smooth fall-off relative to world width", () => {
  near(scoreDistance({ x: 3, y: 1 }, { x: 3, y: 1 }, 9), 100, 1e-9);
  near(scoreDistance({ x: 0, y: 0 }, { x: 0.45, y: 0 }, 9), 92.6); // 5% of width
  near(scoreDistance({ x: 0, y: 0 }, { x: 0.9, y: 0 }, 9), 73.4);  // 10%
  near(scoreDistance({ x: 0, y: 0 }, { x: 1.8, y: 0 }, 9), 29.1);  // 20%
  // same relative miss -> same score in a bigger world
  near(scoreDistance({ x: 0, y: 0 }, { x: 1.05, y: 0 }, 10.5), scoreDistance({ x: 0, y: 0 }, { x: 0.75, y: 0 }, 7.5), 1e-9);
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
  assert.equal(scorePuzzle({ format: "place", world: W, answer: { finals: [{ x: 0, y: 0 }, { x: 5, y: 0 }], target: { x: 5, y: 0 } } }, { choice: 1 }), 100);
  assert.equal(scorePuzzle({ format: "place", world: W, answer: { finals: [{ x: 0, y: 0 }], target: { x: 5, y: 0 } } }, { choice: 7 }), 0);
  assert.equal(scorePuzzle({ format: "stop", world: W, answer: { final: { x: 1, y: 2 } } }, { x: "1", y: 2 }), 0);
  assert.equal(scorePuzzle({ format: "time", world: W, answer: { seconds: 3 } }, null), 0);
  assert.equal(scorePuzzle({ format: "dominoes", world: W, answer: { fallen: 3, total: 7 } }, { n: 2.5 }), 0);
});

test("emoji bands", () => {
  assert.deepEqual([95, 75, 40, 10].map(emoji), ["🟢", "🟡", "🟠", "🔴"]);
});
