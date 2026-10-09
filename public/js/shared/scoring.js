// Scoring: every question format gives 0-100, from how close the guess was.
// Shared by the game, the generator's difficulty bots and the leaderboard worker,
// so all three agree exactly. Changing a constant here changes scores for every
// day: flag it to the owner first.
//
// All curves are a Gaussian of the error: 100 * exp(-(error / sigma)^2).
// That gives ~100 for a near-miss, falls smoothly, and is 0-ish for a wild guess.

const gauss = (err, sigma) => 100 * Math.exp(-((err / sigma) ** 2));

/** Where does it stop? 2D distance, relative to world width.
 *  2% of width -> 99, 5% -> 93, 10% -> 73, 20% -> 29, 30% -> 6. */
export const SIGMA_DISTANCE = 0.18;
export function scoreDistance(guess, actual, worldWidth) {
  const d = Math.hypot(guess.x - actual.x, guess.y - actual.y);
  return gauss(d, SIGMA_DISTANCE * worldWidth);
}

/** How high? Vertical error relative to world height.
 *  5% of height -> 89, 10% -> 64, 20% -> 17. */
export const SIGMA_HEIGHT = 0.15;
export function scoreHeight(guessY, actualY, worldHeight) {
  return gauss(guessY - actualY, SIGMA_HEIGHT * worldHeight);
}

/** How many dominoes fall? Exact = 100, off by 1 = 68, by 2 = 21 (sigma grows a little for long rows). */
export function scoreCount(guess, actual, total) {
  return gauss(guess - actual, Math.max(1.6, total * 0.15));
}

/** How long until...? Error relative to the true time (at least 0.4 s of slack).
 *  10% off -> 85, 25% off -> 37. */
export const SIGMA_TIME = 0.25;
export function scoreTime(guess, actual) {
  return gauss(guess - actual, Math.max(0.4, SIGMA_TIME * actual));
}

/** Score one puzzle. `puzzle` is a day-file puzzle header, `guess` the player's answer. */
export function scorePuzzle(puzzle, guess) {
  const { world, answer } = puzzle;
  if (!guess) return 0;
  switch (puzzle.format) {
    case "stop":
    case "freeze":
      if (!finite(guess.x) || !finite(guess.y)) return 0;
      return scoreDistance(guess, answer.final, world.width);
    case "height":
      if (!finite(guess.y)) return 0;
      return scoreHeight(guess.y, answer.peak, world.height);
    case "dominoes":
      if (!Number.isInteger(guess.n)) return 0;
      return scoreCount(guess.n, answer.fallen, answer.total);
    case "time":
      if (!finite(guess.t)) return 0;
      return scoreTime(guess.t, answer.seconds);
    case "place": {
      const v = answer.finals[guess.choice];
      if (!v) return 0;
      return scoreDistance(v, answer.target, world.width);
    }
    default:
      return 0;
  }
}

const finite = (x) => typeof x === "number" && Number.isFinite(x);

/** Display: whole points. */
export const points = (s) => Math.round(s);

export function emoji(score) {
  if (score >= 90) return "🟢";
  if (score >= 60) return "🟡";
  if (score >= 30) return "🟠";
  return "🔴";
}
