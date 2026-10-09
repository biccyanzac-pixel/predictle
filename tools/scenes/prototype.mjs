// Phase 1 hand-made contraption: every component type at least once.
// Chain 1: steel ball A, chute -> ramp -> bumper -> conveyor -> fan -> ice ramp -> curve -> spring.
// Chain 2: pendulum -> steel dominoes -> seesaw -> rubber ball B.
export const PROTOTYPE = {
  components: [
    // frame
    { type: "wall", x1: 0.08, y1: 0, x2: 0.08, y2: 12, frame: true },
    { type: "wall", x1: 8.92, y1: 0, x2: 8.92, y2: 12, frame: true },
    { type: "wall", x1: 0, y1: 0.08, x2: 9, y2: 0.08, frame: true, floor: true },
    // chain 1: the main steel ball
    { type: "chute", x: 1.0, y: 10.75, w: 0.5, h: 1.1 },
    { type: "ball", x: 1.0, y: 11.4, r: 0.2, material: "steel", role: "main", label: "A" },
    { type: "ramp", x1: 0.3, y1: 10.45, x2: 3.4, y2: 9.55, material: "wood" },
    { type: "bumper", x: 3.95, y: 8.95, r: 0.25 },
    { type: "conveyor", x1: 4.4, x2: 7.2, y: 8.0, speed: 2.5 },
    { type: "fan", x1: 7.3, y1: 4.6, x2: 8.84, y2: 7.9, ax: -9, ay: 4 },
    { type: "ramp", x1: 8.84, y1: 5.5, x2: 6.2, y2: 4.6, material: "ice" },
    { type: "curve", cx: 6.2, cy: 5.6, r: 1.0, a0: -Math.PI / 2, a1: -Math.PI / 2 - 1.0, material: "wood" },
    { type: "spring", x: 3.9, y: 3.9, w: 1.0, stroke: 0.4, hertz: 5 },
    { type: "buckets", x1: 0.16, x2: 4.0, y: 0.16, n: 4, h: 0.7 },
    // chain 2: pendulum -> dominoes -> seesaw -> rubber ball
    { type: "ramp", x1: 5.05, y1: 2.0, x2: 8.84, y2: 2.0, material: "wood" },
    { type: "dominoes", x0: 5.2, y: 2.06, n: 6, gap: 0.45, w: 0.1, h: 0.75, material: "steel" },
    { type: "pendulum", px: 7.7, py: 3.7, len: 1.3, r: 0.22, angle: 0.6, material: "steel" },
    { type: "seesaw", x: 3.6, y: 1.4, half: 1.1, material: "wood", stops: ["left"] },
    { type: "ball", x: 2.65, y: 1.7, r: 0.15, material: "rubber", label: "B" },
  ],
};
