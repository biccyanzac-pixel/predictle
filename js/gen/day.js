// A whole day = f(date): two freeze-frame rounds (easy, hard) and the laser bonus.
// Used by the Node tool that writes day files AND by the browser when a day has no
// file, so both produce exactly the same header and motion bytes.
import { generateRound, SLOTS } from "./daily.js";
import { generateLaser } from "./laser.js";
import { generateAim } from "./aim.js";

// Generator versions. Days before V2 were made by the first live generator; their files
// are the only copy (they never change). From V2 on: pachinko rounds + aim-the-laser bonus.
export const V2_START = "2026-10-11";
import { encodeMotion } from "../shared/codec.js";

const r3 = (x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);
const round3 = (o) => JSON.parse(JSON.stringify(o, (_, v) => r3(v)));

/** The day's bonus puzzle, exactly as stored in its file. */
export function bonusFor(date) {
  const bonus = date >= V2_START ? generateAim(date) : generateLaser(date);
  // the aim sweep is stored as whole centimetres already: keep it exact
  const { sweep, ...rest } = bonus.puzzle;
  return { ...round3({ id: bonus.seed, slot: "bonus", ...rest }), ...(sweep ? { sweep } : {}) };
}

/** { header, streams }: streams[i] = motion bytes for header.puzzles[i].recordings, in order. */
export async function buildDay(date, { onProgress } = {}) {
  const puzzles = [], streams = [];
  for (let k = 0; k < SLOTS.length; k++) {
    onProgress?.(k, 0);
    const g = await generateRound(date, k, { onAttempt: (a) => onProgress?.(k, a) });
    // End the recording 1 s after the tracked object stops (other things may still be moving).
    const fps = g.run.meta.fps;
    const frames = Math.min(g.run.meta.frameCount, Math.ceil((g.run.meta.mainSettledSeconds + 1) * fps) + 1);
    const motion = encodeMotion({ fps, frameCount: frames, bodies: g.run.recording.bodies.map((b) => ({ x: b.x.slice(0, frames), y: b.y.slice(0, frames), a: b.a.slice(0, frames) })) });
    puzzles.push(round3({
      id: g.seed, slot: SLOTS[k], ...g.puzzle, fps,
      statics: g.run.meta.statics, decor: g.run.meta.decor, bodies: g.run.meta.bodies,
      recordings: [{ frameCount: frames, keyFrame: g.run.meta.keyFrame, length: motion.length }],
    }));
    streams.push(motion);
  }
  onProgress?.(SLOTS.length, 0);
  puzzles.push(bonusFor(date));
  return { header: { v: 3, date, puzzles }, streams };
}
