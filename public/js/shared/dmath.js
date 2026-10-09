// Deterministic maths: the same bits in every JavaScript engine.
//
// JavaScript's Math.sin, cos, atan2, hypot, exp and ** are "implementation-
// approximated": Chrome (V8), Safari (JavaScriptCore) and Firefox (SpiderMonkey)
// may round them differently in the last bit. In a chaotic simulation one bit is
// enough to change where a ball ends up, so different players would get different
// puzzles. Everything the generator and simulator compute goes through these
// functions instead, which use only + - * / and sqrt. Those are exactly rounded
// IEEE-754 operations (JavaScript never fuses multiply-add, and sqrt compiles to the
// correctly-rounded hardware instruction in every engine), so the results are
// identical everywhere. Box2D itself runs in WebAssembly, whose float maths is
// deterministic by specification and imports nothing from JavaScript's Math.
//
// Accuracy is ~1e-15, far better than the physics needs; determinism is the point.

export const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** sin(x) for |x| <= pi/2: Taylor series to x^21 (error < 1e-16). */
function sinCore(x) {
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n <= 10; n++) {
    term = (term * -x2) / ((2 * n) * (2 * n + 1));
    sum = sum + term;
  }
  return sum;
}

export function sin(x) {
  let r = x - Math.round(x / TWO_PI) * TWO_PI; // now in [-pi, pi]
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinCore(r);
}

export function cos(x) {
  return sin(x + HALF_PI);
}

/** atan(z) for z >= 0, via two half-angle reductions then a series. */
function atanPos(z) {
  let k = 1;
  for (let i = 0; i < 2; i++) { z = z / (1 + Math.sqrt(1 + z * z)); k = k * 2; }
  const z2 = z * z;
  let term = z, sum = z;
  for (let n = 1; n <= 12; n++) {
    term = term * -z2;
    sum = sum + term / (2 * n + 1);
  }
  return k * sum;
}

export function atan2(y, x) {
  if (x === 0 && y === 0) return 0;
  const ay = y < 0 ? -y : y, ax = x < 0 ? -x : x;
  let a = ay <= ax ? atanPos(ay / ax) : HALF_PI - atanPos(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

export function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}

/** x^n for a small non-negative integer n, by repeated multiplication. */
export function powi(x, n) {
  let r = 1;
  for (let i = 0; i < n; i++) r = r * x;
  return r;
}
