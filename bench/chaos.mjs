// Spread of outcomes under the Phase 2 chaos test's perturbations (20 runs, start +-1 px, speed +-1%),
// on a ball-ramp-seesaw-bumper mini contraption. Lower spread = more candidate puzzles survive.
import { ENGINES } from "./engines.mjs";
const DT = 1 / 60, PX = 9 / 1080; // 1 px on a 1080-px-wide render of a 9 m world
async function once(E, dx, speed) {
  const w = await E.create({ gravity: -10 });
  w.box({ x: 4.5, y: -0.5, hw: 6, hh: 0.5 });
  w.box({ x: -0.1, y: 6, hw: 0.1, hh: 6 }); w.box({ x: 9.1, y: 6, hw: 0.1, hh: 6 }); // walls
  w.box({ x: 2.2, y: 8.6, hw: 1.6, hh: 0.08, angle: -0.35 });              // ramp
  w.circle({ x: 4.6, y: 6.6, r: 0.25, restitution: 0.8 });                  // bumper (rubber)
  const plank = w.box({ x: 5.6, y: 2.2, hw: 1.6, hh: 0.08, dynamic: true, density: 1 });
  w.pin(plank, 5.6, 2.2);                                                    // seesaw
  const weight = w.circle({ x: 6.9, y: 2.6, r: 0.22, dynamic: true, density: 3 });
  const ball = w.circle({ x: 0.9 + dx, y: 9.6, r: 0.2, dynamic: true, density: 2, restitution: 0.3 });
  w.setVelocity(ball, 1.2 * speed, 0, 0);
  for (let i = 0; i < 15 * 60; i++) w.step(DT);
  const out = { ball: w.read(ball).x, weight: w.read(weight).x, wy: w.read(weight).y };
  w.free();
  return out;
}
for (const name of process.argv.slice(2)) {
  const E = ENGINES[name];
  const outs = [];
  for (let k = 0; k < 20; k++) {
    const dx = ((k % 5) - 2) / 2 * PX, sp = 1 + (Math.floor(k / 5) - 1.5) / 1.5 * 0.01;
    outs.push(await once(E, dx, sp));
  }
  const spread = (key) => Math.max(...outs.map(o => o[key])) - Math.min(...outs.map(o => o[key]));
  console.log(name.padEnd(8), "ball landing spread", (spread("ball") / 9 * 100).toFixed(2) + "% of width",
    " weight spread", (spread("weight") / 9 * 100).toFixed(2) + "%", " mean ball x", (outs.reduce((s, o) => s + o.ball, 0) / 20).toFixed(2), " weight", outs[0].weight.toFixed(2), outs[0].wy.toFixed(2));
}
