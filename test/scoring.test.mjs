import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreDistance, scoreWall, perimeterPos, perimeterPoint, scorePuzzle, emoji, POWER } from "../public/js/shared/scoring.js";
import { sin, cos, atan2, hypot, powi } from "../public/js/shared/dmath.js";

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("distance score: 0 only for the worst possible guess; curve 100*(1-miss/worst)^4", () => {
  assert.equal(POWER, 4);
  const world = { width: 9, height: 12 }, actual = { x: 2, y: 1 }, dMax = Math.hypot(7, 11);
  near(scoreDistance(actual, actual, world), 100, 1e-9);
  near(scoreDistance({ x: 9, y: 12 }, actual, world), 0, 1e-9);
  near(scoreDistance({ x: 2 + 0.05 * dMax, y: 1 }, actual, world), 81.45);
  near(scoreDistance({ x: 2 + 0.1 * dMax, y: 1 }, actual, world), 65.61);
  near(scoreDistance({ x: 2 + 0.5 * dMax, y: 1 }, actual, world), 6.25);
});

test("laser: guesses snap to the wall, misses are measured the short way round", () => {
  const world = { width: 8, height: 12 }; // perimeter 40
  assert.equal(perimeterPos({ x: 3, y: 0.1 }, world), 3);          // bottom edge
  assert.equal(perimeterPos({ x: 7.9, y: 5 }, world), 8 + 5);      // right edge
  assert.deepEqual(perimeterPoint(13, world), { x: 8, y: 5 });
  near(scoreWall({ x: 0.5, y: 0 }, { x: 0.5, y: 0 }, world), 100, 1e-9);
  // 1 m either side of the bottom-left corner: 2 m apart around the corner, not 38
  near(scoreWall({ x: 1, y: 0 }, { x: 0, y: 1 }, world), 100 * (1 - 2 / 20) ** 4);
  near(scoreWall({ x: 4, y: 12 }, { x: 4, y: 0 }, world), 0, 1e-9); // directly opposite = worst
});

test("scorePuzzle: freeze and laser; junk scores 0", () => {
  const W = { width: 9, height: 12 };
  assert.equal(scorePuzzle({ format: "freeze", world: W, answer: { final: { x: 1, y: 2 } } }, { x: 1, y: 2 }), 100);
  assert.equal(scorePuzzle({ format: "laser", world: W, answer: { hit: { x: 9, y: 4 } } }, { x: 9, y: 4 }), 100);
  assert.equal(scorePuzzle({ format: "freeze", world: W, answer: { final: { x: 1, y: 2 } } }, { x: "1", y: 2 }), 0);
  assert.equal(scorePuzzle({ format: "freeze", world: W, answer: { final: { x: 1, y: 2 } } }, null), 0);
});

test("emoji bands", () => assert.deepEqual([95, 75, 40, 10].map(emoji), ["🟢", "🟡", "🟠", "🔴"]));

test("deterministic maths agrees with Math to ~1e-14", () => {
  for (let x = -20; x <= 20; x += 0.37) {
    near(sin(x), Math.sin(x), 1e-13); near(cos(x), Math.cos(x), 1e-13);
    near(atan2(x, 1.3), Math.atan2(x, 1.3), 1e-13); near(atan2(-1.1, x), Math.atan2(-1.1, x), 1e-13);
  }
  assert.equal(hypot(3, 4), 5);
  assert.equal(powi(0.5, 4), 0.0625);
});
