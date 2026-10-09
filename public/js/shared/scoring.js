// Scoring: every question format gives 0-100, from how close the guess was.
// Shared by the game, the generator's difficulty bots and the leaderboard worker,
// so all three agree exactly. Changing a constant here changes scores for every
// day: flag it to the owner first.
//
// Distance (the main game): 0 only for the worst possible guess, see scoreDistance.
// The other (older, unused) formats use a Gaussian of the error: 100 * exp(-(error / sigma)^2).

const gauss = (err, sigma) => 100 * Math.exp(-((err / sigma) ** 2));

/** Where does it stop? Distance from the true spot, relative to the WORST possible guess
 *  (the arena corner farthest from the true spot): score = 100 * (1 - d / dMax)^2.
 *  So 0 only for the worst guess in the arena; a guess 5% of dMax away scores 90,
 *  10% -> 81, 25% -> 56, 50% -> 25. 100 needs a near-exact tap (within ~0.3% of dMax). */
export const DISTANCE_POWER = 2;
export function maxDistance(actual, world) {
  const xs = [0, world.width], ys = [0, world.height];
  return Math.max(...xs.flatMap((x) => ys.map((y) => Math.hypot(x - actual.x, y - actual.y))));
}
export function scoreDistance(guess, actual, world) {
  const d = Math.hypot(guess.x - actual.x, guess.y - actual.y);
  return 100 * Math.max(0, 1 - d / maxDistance(actual, world)) ** DISTANCE_POWER;
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
      return scoreDistance(guess, answer.final, world);
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
      return scoreDistance(v, answer.target, world);
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
