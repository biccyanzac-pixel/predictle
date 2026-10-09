// Offline simulator: scene (list of components) -> recording + events.
// Engine: Box2D v3.1 via box2d3-wasm, "compat" build (no SIMD/threads) so every
// machine produces the same bits. See docs/engine-decision.md.
//
// Memory rule for this embind API: property getters (def.material, jointDef.base,
// base.localFrameA, ...) return REFERENCES into the parent. Never .delete() them;
// delete only objects we constructed (new b2Vec2, b2Default*Def) or got back by
// value from a function (b2Body_GetPosition, b2MakeRot, b2MakeOffsetBox, ...).
// Deleting a reference double-frees and corrupts the heap later, far from the cause.
//
// Units: metres, seconds, radians, y up. World is WORLD.width x WORLD.height.
//
// Component types (all static unless marked dynamic):
//   ball      {x,y,r,material,vx?,vy?,role?}           dynamic; role "main" = the ball the question is about
//   block     {x,y,hw,hh,angle?,material}              dynamic box
//   wall      {x1,y1,x2,y2,t?,material?}               thick segment
//   ramp      {x1,y1,x2,y2,t?,material?}               same physics as wall, drawn as a ramp
//   curve     {cx,cy,r,a0,a1,t?,material?}             circular arc (angles in radians)
//   bumper    {x,y,r}                                  rubber post
//   chute     {x,y,w,h}                                vertical tube, open at the bottom; x,y = bottom centre
//   seesaw    {x,y,half,t?,material?,limit?}           dynamic plank on a pivot at (x,y)
//   dominoes  {x0,y,n,gap,w,h,material?,breakAt?,breakGap?}  dynamic, standing on y (needs something underneath)
//   pendulum  {px,py,len,r,angle,material?}            dynamic rod + bob, pivot (px,py), angle 0 = hanging down
//   spring    {x,y,w,stroke,hertz}                     dynamic plate on a sprung slider; y = plate rest height
//   conveyor  {x1,x2,y,speed,t?}                       belt surface moves at speed (m/s, + = right)
//   fan       {x1,y1,x2,y2,ax,ay}                      zone that accelerates bodies inside by (ax,ay) m/s^2
//   buckets   {x1,x2,y,n,h,t?}                         n equal buckets with dividers, floor at y
//   sand      {x1,x2,y,depth?}                         sandpit surface (top at y): things stop where they land
//
// Any component may carry frame: true (walls/floor: not counted as "touched") and
// floor: true (the floor, for "when does it hit the floor" questions).
// scene.world = { width, height } overrides the default world size.
//
// options.noise (for the rough-physics bot): { friction, restitution, force } multipliers.

import Box2DFactory from "../../node_modules/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs";
import { MATERIALS, WORLD } from "../../public/js/shared/materials.js";

export const STEP_HZ = 60;

// x of domino k; breakAt/breakGap optionally widen one gap so the chain can stop there.
export const dominoX = (c, k) => c.x0 + k * c.gap + (c.breakAt != null && k >= c.breakAt ? c.breakGap - c.gap : 0);
export const SUBSTEPS = 4;
export const RECORD_FPS = 30;

let modulePromise;
export const loadBox2D = () => (modulePromise ??= Box2DFactory());

export async function simulate(scene, { maxSeconds = 20, settleTail = 0.5, noise = null } = {}) {
  const B = await loadBox2D();
  const sim = new Sim(B, noise);
  let result;
  try {
    result = sim.run(scene, maxSeconds, settleTail);
  } catch (e) {
    if (process.env.SIM_DEBUG) console.error("run failed:", e.message, "SCENE", JSON.stringify(scene));
    throw e;
  } finally {
    sim.destroy();
  }
  return result;
}

class Sim {
  constructor(B, noise) {
    this.B = B;
    this.noise = { friction: 1, restitution: 1, force: 1, ...(noise ?? {}) };
    const wd = B.b2DefaultWorldDef();
    const g = this.vec(0, -10);
    wd.gravity = g;
    g.delete();
    this.world = B.b2CreateWorld(wd);
    wd.delete();
    // Learnable rules: ice is slippery and rubber bouncy whatever they touch.
    // Sand overrides both: full grip, no bounce.
    const SAND_ID = BigInt(MATERIALS.sand.id);
    B.b2World_SetFrictionCallback(this.world, (fa, ma, fb, mb) => (ma === SAND_ID || mb === SAND_ID ? 1 : Math.min(fa, fb)));
    B.b2World_SetRestitutionCallback(this.world, (ra, ma, rb, mb) => (ma === SAND_ID || mb === SAND_ID ? 0 : Math.max(ra, rb)));
    const gd = B.b2DefaultBodyDef();
    this.ground = B.b2CreateBody(this.world, gd);
    gd.delete();
    this.shapeOwner = new Map(); // shape index -> { comp, body }
    this.dynamics = [];          // { id, comp, kind, material, shapes, mainBall? }
    this.statics = [];           // drawable static shapes
    this.decor = [];             // drawable decorations: fans, conveyors, pivots, ...
    this.fans = [];
    this.sandpits = [];
  }

  vec(x, y) { return new this.B.b2Vec2(x, y); }
  destroy() { this.B.b2DestroyWorld(this.world); }

  // ------------------------------------------------------------ bodies and shapes
  body({ dynamic, x, y, angle = 0, bullet = false, angularDamping = 0 }) {
    const B = this.B, d = B.b2DefaultBodyDef();
    d.angularDamping = angularDamping;
    d.type = dynamic ? B.b2BodyType.b2_dynamicBody : B.b2BodyType.b2_staticBody;
    const p = this.vec(x, y); d.position = p; p.delete();
    const r = B.b2MakeRot(angle); d.rotation = r; r.delete();
    d.isBullet = bullet;
    const id = B.b2CreateBody(this.world, d);
    d.delete();
    return id;
  }

  shapeDef(materialName, extra = {}) {
    const m = MATERIALS[materialName];
    const sd = this.B.b2DefaultShapeDef();
    sd.density = m.density;
    sd.enableContactEvents = true;
    sd.enableHitEvents = true;
    const sm = sd.material;
    sm.friction = m.friction * this.noise.friction;
    sm.restitution = Math.min(0.95, m.restitution * this.noise.restitution);
    sm.rollingResistance = m.rolling;
    sm.userMaterialId = BigInt(m.id);
    if (extra.tangentSpeed) sm.tangentSpeed = extra.tangentSpeed;
    sd.material = sm; // sm is a reference into sd (embind getters return references): never delete it
    return sd;
  }

  addBox(body, comp, material, hw, hh, cx = 0, cy = 0, a = 0, extra) {
    const B = this.B, sd = this.shapeDef(material, extra);
    const c = this.vec(cx, cy), r = B.b2MakeRot(a);
    const poly = B.b2MakeOffsetBox(hw, hh, c, r);
    const sid = B.b2CreatePolygonShape(body, sd, poly);
    poly.delete(); c.delete(); r.delete(); sd.delete();
    this.shapeOwner.set(sid.index1, { comp, body });
    return { t: "box", x: cx, y: cy, hw, hh, a, m: material };
  }

  addCircle(body, comp, material, r, cx = 0, cy = 0) {
    const B = this.B, sd = this.shapeDef(material);
    const circle = new B.b2Circle();
    const c = this.vec(cx, cy); circle.center = c; c.delete();
    circle.radius = r;
    const sid = B.b2CreateCircleShape(body, sd, circle);
    circle.delete(); sd.delete();
    this.shapeOwner.set(sid.index1, { comp, body });
    return { t: "circle", x: cx, y: cy, r, m: material };
  }

  // A thick static segment from (x1,y1) to (x2,y2).
  staticBar(comp, x1, y1, x2, y2, t, material, extra) {
    const len = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1);
    const shape = this.addBox(this.ground, comp, material, len / 2, t / 2, (x1 + x2) / 2, (y1 + y2) / 2, a, extra);
    this.statics.push({ ...shape, comp });
  }

  addDynamic(comp, kind, material, bodyId, shapes, extra = {}) {
    const baseAngularDamping = kind === "plank" ? 1.5 : kind === "pendulum" ? 0.3 : 0;
    this.dynamics.push({ id: bodyId, comp, kind, material, shapes, baseAngularDamping, ...extra });
  }

  pin(body, x, y, { limit } = {}) {
    const B = this.B, jd = B.b2DefaultRevoluteJointDef();
    const base = jd.base;
    base.bodyIdA = this.ground;
    base.bodyIdB = body;
    const fa = base.localFrameA; const pa = this.vec(x, y); fa.p = pa; base.localFrameA = fa;
    const w = this.vec(x, y); const local = B.b2Body_GetLocalPoint(body, w);
    const fb = base.localFrameB; fb.p = local; base.localFrameB = fb;
    jd.base = base;
    if (limit) { jd.enableLimit = true; jd.lowerAngle = -limit; jd.upperAngle = limit; }
    B.b2CreateRevoluteJoint(this.world, jd);
    // base, fa, fb are references into jd: only delete what we created or were returned by value
    pa.delete(); w.delete(); local.delete(); jd.delete();
  }

  // ------------------------------------------------------------ components
  build(scene) {
    scene.components.forEach((c, i) => {
      const fn = this[`make_${c.type}`];
      if (!fn) throw new Error(`unknown component type "${c.type}"`);
      fn.call(this, c, i);
    });
  }

  make_ball(c, i) {
    const b = this.body({ dynamic: true, x: c.x, y: c.y, bullet: true });
    const s = this.addCircle(b, i, c.material ?? "wood", c.r);
    if (c.vx || c.vy) { const v = this.vec(c.vx ?? 0, c.vy ?? 0); this.B.b2Body_SetLinearVelocity(b, v); v.delete(); }
    this.addDynamic(i, "ball", c.material ?? "wood", b, [s], { role: c.role ?? null, label: c.label ?? null });
  }

  make_block(c, i) {
    const b = this.body({ dynamic: true, x: c.x, y: c.y, angle: c.angle ?? 0, bullet: c.role === "main" });
    if (c.vx || c.vy) { const v = this.vec(c.vx ?? 0, c.vy ?? 0); this.B.b2Body_SetLinearVelocity(b, v); v.delete(); }
    this.addDynamic(i, "block", c.material ?? "wood", b, [this.addBox(b, i, c.material ?? "wood", c.hw, c.hh)], { role: c.role ?? null, label: c.label ?? null });
  }

  // Sandpit: a sand surface from x1 to x2 whose top is at y. Things that land in it stop.
  make_sand(c, i) {
    const depth = c.depth ?? 0.14;
    const shape = this.addBox(this.ground, i, "sand", (c.x2 - c.x1) / 2, depth / 2, (c.x1 + c.x2) / 2, c.y - depth / 2);
    this.statics.push({ ...shape, comp: i });
    this.sandpits.push(c);
  }

  make_wall(c, i) { this.staticBar(i, c.x1, c.y1, c.x2, c.y2, c.t ?? 0.16, c.material ?? "wood"); }
  make_ramp(c, i) { this.staticBar(i, c.x1, c.y1, c.x2, c.y2, c.t ?? 0.12, c.material ?? "wood"); }

  make_curve(c, i) {
    // Arc built from short overlapping bars. Fine segments + a little overlap keep
    // a rolling ball from catching on the joins.
    const n = Math.max(6, Math.ceil(Math.abs(c.a1 - c.a0) * c.r / 0.15));
    const t = c.t ?? 0.12, pts = [];
    for (let k = 0; k <= n; k++) {
      const a = c.a0 + ((c.a1 - c.a0) * k) / n;
      pts.push([c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)]);
    }
    for (let k = 0; k < n; k++) {
      const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
      const len = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1);
      this.addBox(this.ground, i, c.material ?? "wood", len / 2 + t / 4, t / 2, (x1 + x2) / 2, (y1 + y2) / 2, a);
    }
    this.statics.push({ t: "path", pts, thick: t, m: c.material ?? "wood", comp: i });
  }

  make_bumper(c, i) {
    this.statics.push({ ...this.addCircle(this.ground, i, "rubber", c.r, c.x, c.y), comp: i, bumper: true });
  }

  // dir "down" (default): vertical tube, (x,y) = bottom centre, h tall.
  // dir "left"/"right": horizontal tube, (x,y) = centre of the open mouth, h long.
  make_chute(c, i) {
    const t = 0.1, half = c.w / 2 + t / 2;
    if (!c.dir || c.dir === "down") {
      this.staticBar(i, c.x - half, c.y, c.x - half, c.y + c.h, t, "wood");
      this.staticBar(i, c.x + half, c.y, c.x + half, c.y + c.h, t, "wood");
      this.decor.push({ t: "chute", x1: c.x - c.w / 2, y1: c.y, x2: c.x + c.w / 2, y2: c.y + c.h, comp: i });
    } else {
      const back = c.x - (c.dir === "right" ? 1 : -1) * c.h;
      this.staticBar(i, back, c.y - half, c.x, c.y - half, t, "wood");
      this.staticBar(i, back, c.y + half, c.x, c.y + half, t, "wood");
      this.staticBar(i, back, c.y - half - t / 2, back, c.y + half + t / 2, t, "wood"); // closed back
      this.decor.push({ t: "chute", x1: Math.min(back, c.x), y1: c.y - c.w / 2, x2: Math.max(back, c.x), y2: c.y + c.w / 2, comp: i });
    }
  }

  make_seesaw(c, i) {
    const t = c.t ?? 0.12, m = c.material ?? "wood";
    const b = this.body({ dynamic: true, x: c.x, y: c.y + t / 2, angularDamping: 1.5 }); // pivot friction
    const shapes = [this.addBox(b, i, m, c.half, t / 2)];
    // optional end stops, so a ball resting on the plank waits for the launch
    for (const side of c.stops ?? []) {
      const sx = side === "left" ? -c.half + 0.04 : c.half - 0.04;
      shapes.push(this.addBox(b, i, m, 0.04, 0.12, sx, t / 2 + 0.12));
    }
    this.pin(b, c.x, c.y + t / 2, { limit: c.limit ?? 0.45 });
    this.addDynamic(i, "plank", m, b, shapes);
    this.decor.push({ t: "fulcrum", x: c.x, y: c.y, comp: i });
  }

  make_dominoes(c, i) {
    const m = c.material ?? "wood";
    for (let k = 0; k < c.n; k++) {
      const b = this.body({ dynamic: true, x: dominoX(c, k), y: c.y + c.h / 2 });
      this.addDynamic(i, "domino", m, b, [this.addBox(b, i, m, c.w / 2, c.h / 2)]);
    }
  }

  make_pendulum(c, i) {
    const m = c.material ?? "steel";
    // Body origin at the pivot; rod and bob hang along -y in body space.
    const b = this.body({ dynamic: true, x: c.px, y: c.py, angle: c.angle ?? 0, angularDamping: 0.3 });
    const rod = this.addBox(b, i, "wood", 0.035, (c.len - c.r) / 2, 0, -(c.len - c.r) / 2);
    const bob = this.addCircle(b, i, m, c.r, 0, -c.len);
    this.pin(b, c.px, c.py);
    this.addDynamic(i, "pendulum", m, b, [rod, bob]);
    this.decor.push({ t: "pivot", x: c.px, y: c.py, comp: i });
  }

  make_spring(c, i) {
    const B = this.B, t = 0.12;
    const b = this.body({ dynamic: true, x: c.x, y: c.y });
    const s = this.addBox(b, i, "rubber", c.w / 2, t / 2);
    const jd = B.b2DefaultPrismaticJointDef();
    const base = jd.base;
    base.bodyIdA = this.ground; base.bodyIdB = b;
    const up = B.b2MakeRot(Math.PI / 2);
    const fa = base.localFrameA; const pa = this.vec(c.x, c.y); fa.p = pa; fa.q = up; base.localFrameA = fa;
    const fb = base.localFrameB; const pb = this.vec(0, 0); fb.p = pb; fb.q = up; base.localFrameB = fb;
    jd.base = base;
    jd.enableSpring = true; jd.hertz = (c.hertz ?? 5) * Math.sqrt(this.noise.force); jd.dampingRatio = 0.1;
    jd.enableLimit = true; jd.lowerTranslation = -c.stroke; jd.upperTranslation = 0.05;
    B.b2CreatePrismaticJoint(this.world, jd);
    [up, pa, pb, jd].forEach((o) => o.delete()); // base, fa, fb are references into jd
    // The base the spring sits on.
    this.staticBar(i, c.x - c.w / 2, c.y - c.stroke - 0.15, c.x + c.w / 2, c.y - c.stroke - 0.15, 0.1, "steel");
    this.addDynamic(i, "plate", "rubber", b, [s]);
    this.decor.push({ t: "spring", x: c.x, y: c.y, w: c.w, base: c.y - c.stroke - 0.1, comp: i });
  }

  make_conveyor(c, i) {
    const t = c.t ?? 0.16;
    // tangentSpeed moves the surface; Box2D's sign is relative to the shape's
    // winding, measured in the prototype: positive = top surface moves right.
    this.staticBar(i, c.x1, c.y, c.x2, c.y, t, "rubber", { tangentSpeed: c.speed * this.noise.force });
    this.decor.push({ t: "conveyor", x1: c.x1, x2: c.x2, y: c.y, h: t, speed: c.speed, comp: i });
  }

  make_fan(c, i) {
    this.fans.push(c);
    this.decor.push({ t: "fan", ...c, comp: i });
  }

  make_buckets(c, i) {
    const t = c.t ?? 0.1, w = (c.x2 - c.x1) / c.n;
    this.staticBar(i, c.x1, c.y, c.x2, c.y, t, "wood");
    for (let k = 0; k <= c.n; k++) {
      const x = c.x1 + k * w;
      this.staticBar(i, x, c.y, x, c.y + c.h, t, "wood");
    }
    this.decor.push({ t: "buckets", x1: c.x1, x2: c.x2, y: c.y, n: c.n, h: c.h, comp: i });
  }

  // ------------------------------------------------------------ run
  read(id) {
    const B = this.B, p = B.b2Body_GetPosition(id), r = B.b2Body_GetRotation(id);
    const out = { x: p.x, y: p.y, a: Math.atan2(r.s, r.c) };
    p.delete(); r.delete();
    return out;
  }

  velocity(id) {
    const v = this.B.b2Body_GetLinearVelocity(id);
    const out = { x: v.x, y: v.y };
    v.delete();
    return out;
  }

  // Drag inside sandpits (on top of the no-bounce, full-grip contact rules), so a
  // body that lands in sand stops within a few centimetres instead of rolling on.
  applySand() {
    if (!this.sandpits.length) return;
    const B = this.B;
    for (const d of this.dynamics) {
      const p = this.read(d.id);
      const inside = this.sandpits.some((s) => p.x > s.x1 && p.x < s.x2 && p.y < s.y + 0.4 && p.y > s.y - 0.3);
      if (inside === !!d.inSand) continue;
      d.inSand = inside;
      B.b2Body_SetLinearDamping(d.id, inside ? 6 : 0);
      B.b2Body_SetAngularDamping(d.id, inside ? 6 : (d.baseAngularDamping ?? 0));
    }
  }

  applyFans() {
    if (!this.fans.length) return;
    const B = this.B;
    for (const d of this.dynamics) {
      const p = this.read(d.id);
      for (const f of this.fans) {
        if (p.x < f.x1 || p.x > f.x2 || p.y < f.y1 || p.y > f.y2) continue;
        const m = B.b2Body_GetMass(d.id);
        const F = this.vec(m * f.ax * this.noise.force, m * f.ay * this.noise.force);
        B.b2Body_ApplyForceToCenter(d.id, F, true);
        F.delete();
      }
    }
  }

  run(scene, maxSeconds, settleTail) {
    const B = this.B;
    const world = scene.world ?? WORLD;
    this.build(scene);
    const dt = 1 / STEP_HZ, every = STEP_HZ / RECORD_FPS;
    const tracks = this.dynamics.map(() => ({ x: [], y: [], a: [] }));
    const lastA = this.dynamics.map(() => null);
    const sample = () => this.dynamics.forEach((d, k) => {
      const p = this.read(d.id);
      // unwrap the angle so it changes smoothly through +-pi
      if (lastA[k] !== null) p.a = lastA[k] + Math.atan2(Math.sin(p.a - lastA[k]), Math.cos(p.a - lastA[k]));
      lastA[k] = p.a;
      tracks[k].x.push(p.x); tracks[k].y.push(p.y); tracks[k].a.push(p.a);
    });

    const comps = scene.components;
    const isFrame = (i) => !!comps[i]?.frame;
    const mainIdx = this.dynamics.findIndex((d) => d.role === "main");
    const mainComp = mainIdx >= 0 ? this.dynamics[mainIdx].comp : -1;
    const contacts = [];       // { step, a: comp, b: comp, speed }
    const touched = new Set(); // non-frame components the main ball touched
    const kick = [];           // per step: |delta v| of the main ball, gravity removed
    const kickComp = [];       // per step: non-frame component the main ball hit then (or null)
    let firstFloorStep = null;
    let prevV = mainIdx >= 0 ? this.velocity(this.dynamics[mainIdx].id) : null;
    const outOfBounds = new Set();
    let settledAt = null, mainSettledAt = null, step = 0;
    const maxSteps = Math.round(maxSeconds * STEP_HZ);
    const pos = [];            // main ball position per step (for peak after the key moment)

    const noteMainContact = (other, step) => {
      if (other === mainComp) return;
      if (comps[other]?.floor && firstFloorStep === null) firstFloorStep = step;
      if (!isFrame(other)) { touched.add(other); kickComp[step - 1] = other; }
    };

    sample();
    while (step < maxSteps) {
      this.applyFans();
      this.applySand();
      B.b2World_Step(this.world, dt, SUBSTEPS);
      step++;
      kickComp.push(null);

      const ev = B.b2World_GetContactEvents(this.world);
      for (let k = 0; k < ev.beginCount; k++) {
        const e = ev.GetBeginEvent(k);
        const A = this.shapeOwner.get(e.shapeIdA.index1), Bo = this.shapeOwner.get(e.shapeIdB.index1);
        e.delete();
        if (!A || !Bo || A.comp === Bo.comp) continue;
        contacts.push({ step, a: A.comp, b: Bo.comp, speed: 0 });
        if (A.comp === mainComp) noteMainContact(Bo.comp, step);
        if (Bo.comp === mainComp) noteMainContact(A.comp, step);
      }
      for (let k = 0; k < ev.hitCount; k++) {
        const e = ev.GetHitEvent(k);
        const A = this.shapeOwner.get(e.shapeIdA.index1), Bo = this.shapeOwner.get(e.shapeIdB.index1);
        if (A && Bo && A.comp !== Bo.comp) {
          contacts.push({ step, a: A.comp, b: Bo.comp, speed: +e.approachSpeed.toFixed(3), hit: true });
          if (A.comp === mainComp) noteMainContact(Bo.comp, step);
          if (Bo.comp === mainComp) noteMainContact(A.comp, step);
        }
        e.delete();
      }
      ev.delete();

      if (mainIdx >= 0) {
        const id = this.dynamics[mainIdx].id;
        const v = this.velocity(id);
        kick.push(Math.hypot(v.x - prevV.x, v.y - prevV.y + 10 * dt));
        prevV = v;
        pos.push(this.read(id));
      }
      if (step % every === 0) {
        sample();
        this.dynamics.forEach((d, k) => {
          const t = tracks[k], n = t.x.length - 1;
          if (t.x[n] < -0.05 || t.x[n] > world.width + 0.05 || t.y[n] < -0.05 || t.y[n] > world.height + 0.05) outOfBounds.add(k);
        });
        // Settled = nothing has moved more than 2 mm (or 0.01 rad) over the last 0.5 s.
        const win = RECORD_FPS / 2, n = tracks[0].x.length - 1;
        // (every frame in the window, not just its ends: a rocking body can return to the same spot)
        const still = (k) => {
          if (n < win) return false;
          const t = tracks[k];
          for (let f = n - win; f < n; f++) {
            if (Math.abs(t.x[f] - t.x[n]) >= 0.002 || Math.abs(t.y[f] - t.y[n]) >= 0.002 || Math.abs(t.a[f] - t.a[n]) >= 0.01) return false;
          }
          return true;
        };
        if (mainSettledAt === null && mainIdx >= 0 && still(mainIdx)) mainSettledAt = step - win * every;
        if (mainSettledAt !== null && mainIdx >= 0 && !still(mainIdx)) mainSettledAt = null; // it moved again
        if (settledAt === null && this.dynamics.every((_, k) => still(k))) settledAt = step - win * every;
        if (settledAt !== null && step - settledAt >= (settleTail + 0.5) * STEP_HZ) break;
      }
    }

    // Key moment: the biggest non-gravity change in the main ball's velocity that
    // happened while touching a real component (a bounce off the floor or a wall
    // doesn't count). Falls back to the biggest change overall.
    let keyStep = null, keyComp = null, best = -1;
    kick.forEach((k, s) => {
      const c = kickComp[s] ?? kickComp[s - 1] ?? null;
      if (c !== null && k > best) { best = k; keyStep = s + 1; keyComp = c; }
    });
    if (keyStep === null) kick.forEach((k, s) => { if (k > best) { best = k; keyStep = s + 1; } });

    // Outcomes the question formats ask about.
    const mainTrack = mainIdx >= 0 ? tracks[mainIdx] : null;
    const final = mainTrack ? { x: mainTrack.x.at(-1), y: mainTrack.y.at(-1) } : null;
    let peak = null;
    if (keyStep !== null && pos.length) {
      const from = keyStep - 1;
      // highest point after the key moment, until the ball next comes back down to the key height
      peak = pos[from].y;
      for (let s = from; s < pos.length; s++) {
        peak = Math.max(peak, pos[s].y);
        if (s > from + 6 && pos[s].y < pos[from].y - 0.05) break;
      }
    }
    const dominoes = this.dynamics.map((d, k) => (d.kind === "domino" ? k : -1)).filter((k) => k >= 0);
    const fallen = dominoes.filter((k) => {
      const t = tracks[k];
      return Math.abs(t.a.at(-1) - t.a[0]) > 0.3 || Math.hypot(t.x.at(-1) - t.x[0], t.y.at(-1) - t.y[0]) > 0.3;
    }).length;

    const frameCount = tracks[0]?.x.length ?? 0;
    const meta = {
      v: 1,
      world,
      fps: RECORD_FPS,
      frameCount,
      components: scene.components,
      statics: this.statics,
      decor: this.decor,
      bodies: this.dynamics.map((d) => ({ comp: d.comp, kind: d.kind, m: d.material, shapes: d.shapes, role: d.role ?? undefined, label: d.label ?? undefined })),
      keyFrame: keyStep === null ? null : Math.round(keyStep / every),
      keyComp,
      settledSeconds: settledAt === null ? null : settledAt / STEP_HZ,
      mainSettledSeconds: mainSettledAt === null ? null : mainSettledAt / STEP_HZ,
    };
    return {
      meta,
      recording: { fps: RECORD_FPS, frameCount, bodies: tracks },
      contacts,
      touched: [...touched],
      outOfBounds: [...outOfBounds],
      mainIndex: mainIdx,
      outcome: {
        final,
        peak,
        keyY: keyStep !== null && pos.length ? pos[keyStep - 1].y : null,
        floorSeconds: firstFloorStep === null ? null : firstFloorStep / STEP_HZ,
        fallen,
        dominoTotal: dominoes.length,
      },
    };
  }
}
