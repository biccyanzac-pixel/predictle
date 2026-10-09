// Scoring: 0-100 from how close the guess was. Shared by the game, the generator's
// difficulty checks and the leaderboard worker, so all three agree exactly. Uses
// only deterministic maths (dmath.js): the generator runs in browsers too.
// Changing a constant here changes scores for every day: flag it to the owner first.
import { hypot, powi } from "./dmath.js";

/** Score curve: 100 * (1 - miss / worstPossibleMiss)^POWER.
 *  0 only for the worst possible guess; near misses still score well, far ones little.
 *  Miss as a share of the worst: 5% -> 81, 10% -> 66, 20% -> 41, 30% -> 24, 50% -> 6. */
export const POWER = 4;
const curve = (miss, worst) => 100 * powi(Math.max(0, 1 - miss / worst), POWER);

// ---------------------------------------------------------------- where does it stop
/** Worst possible guess = the arena corner farthest from the true spot. */
export function maxDistance(actual, world) {
  const xs = [0, world.width], ys = [0, world.height];
  return Math.max(...xs.flatMap((x) => ys.map((y) => hypot(x - actual.x, y - actual.y))));
}
export function scoreDistance(guess, actual, world) {
  return curve(hypot(guess.x - actual.x, guess.y - actual.y), maxDistance(actual, world));
}

// ---------------------------------------------------------------- laser: where does it hit the wall
/** Position of a point on the arena's edge as a distance along the perimeter,
 *  starting at the bottom-left corner and going anticlockwise. Snaps to the nearest edge. */
export function perimeterPos(p, world) {
  const W = world.width, H = world.height;
  const d = [p.y, W - p.x, H - p.y, p.x]; // distance to bottom, right, top, left edges
  const edge = d.indexOf(Math.min(...d));
  const x = Math.min(W, Math.max(0, p.x)), y = Math.min(H, Math.max(0, p.y));
  if (edge === 0) return x;                    // bottom, left -> right
  if (edge === 1) return W + y;                // right, bottom -> top
  if (edge === 2) return W + H + (W - x);      // top, right -> left
  return 2 * W + H + (H - y);                  // left, top -> bottom
}
/** The point on the edge at perimeter position s (inverse of perimeterPos). */
export function perimeterPoint(s, world) {
  const W = world.width, H = world.height, P = 2 * (W + H);
  s = ((s % P) + P) % P;
  if (s <= W) return { x: s, y: 0 };
  if (s <= W + H) return { x: W, y: s - W };
  if (s <= 2 * W + H) return { x: W - (s - W - H), y: H };
  return { x: 0, y: H - (s - 2 * W - H) };
}
/** Miss measured the short way round the walls; the worst possible is half the perimeter. */
export function scoreWall(guess, actual, world) {
  const P = 2 * (world.width + world.height);
  const a = perimeterPos(guess, world), b = perimeterPos(actual, world);
  const miss = Math.min(Math.abs(a - b), P - Math.abs(a - b));
  return curve(miss, P / 2);
}

// ---------------------------------------------------------------- per puzzle
const finite = (x) => typeof x === "number" && Number.isFinite(x);

/** Score one puzzle. `puzzle` is a day-file puzzle header, `guess` the player's answer. */
export function scorePuzzle(puzzle, guess) {
  if (!guess || !finite(guess.x) || !finite(guess.y)) return 0;
  if (puzzle.format === "freeze") return scoreDistance(guess, puzzle.answer.final, puzzle.world);
  if (puzzle.format === "laser") return scoreWall(guess, puzzle.answer.hit, puzzle.world);
  return 0;
}

/** Display: whole points. */
export const points = (s) => Math.round(s);

export function emoji(score) {
  if (score >= 90) return "🟢";
  if (score >= 60) return "🟡";
  if (score >= 30) return "🟠";
  return "🔴";
}
