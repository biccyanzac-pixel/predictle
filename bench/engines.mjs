// One small adapter per candidate engine, so the benchmark scenes are written once.
// Units: metres, kilograms, seconds, y up, angles in radians (counter-clockwise).
//
// world = await ENGINES[name].create({ gravity: -10 })
//   world.box({ x, y, hw, hh, angle, dynamic, density, friction, restitution }) -> body
//   world.circle({ x, y, r, dynamic, density, friction, restitution }) -> body
//   world.pin(body, x, y)                 hinge body to the static world at a world point
//   world.setVelocity(body, vx, vy, w)
//   world.step(dt)                        one fixed step
//   world.read(body) -> { x, y, a }
//   world.free()

import planck from "planck";
import Matter from "matter-js";
import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import Box2DFactory from "box2d3-wasm";
import Box2DCompatFactory from "../node_modules/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs";
import * as PB from "../node_modules/phaser-box2d/dist/PhaserBox2D.js";

const MAT = { density: 1, friction: 0.6, restitution: 0.1 };
const mat = (o) => ({ ...MAT, ...o });

// ---------------------------------------------------------------- Planck (Box2D v2.4 port)
async function createPlanck({ gravity }) {
  const w = new planck.World({ gravity: planck.Vec2(0, gravity) });
  const ground = w.createBody();
  const make = (o, shape) => {
    const m = mat(o);
    const b = w.createBody({
      type: o.dynamic ? "dynamic" : "static",
      position: planck.Vec2(o.x, o.y),
      angle: o.angle || 0,
      bullet: !!o.bullet,
    });
    b.createFixture(shape, { density: m.density, friction: m.friction, restitution: m.restitution });
    return b;
  };
  return {
    box: (o) => make(o, planck.Box(o.hw, o.hh)),
    circle: (o) => make(o, planck.Circle(o.r)),
    pin: (b, x, y) => w.createJoint(planck.RevoluteJoint({}, ground, b, planck.Vec2(x, y))),
    setVelocity: (b, vx, vy, av = 0) => { b.setLinearVelocity(planck.Vec2(vx, vy)); b.setAngularVelocity(av); },
    // 8 velocity / 3 position iterations is Box2D v2's recommended default.
    step: (dt) => w.step(dt, 8, 3),
    read: (b) => { const p = b.getPosition(); return { x: p.x, y: p.y, a: b.getAngle() }; },
    free: () => {},
  };
}

// ---------------------------------------------------------------- Rapier 2D (deterministic build)
let rapierReady;
async function createRapier({ gravity }) {
  rapierReady ??= RAPIER.init();
  await rapierReady;
  const w = new RAPIER.World({ x: 0, y: gravity });
  const ground = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const make = (o, colliderDesc) => {
    const m = mat(o);
    const desc = (o.dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed())
      .setTranslation(o.x, o.y)
      .setRotation(o.angle || 0)
      .setCcdEnabled(!!o.bullet);
    const b = w.createRigidBody(desc);
    // Match Box2D's mixing for restitution (max). Rapier has no sqrt rule for
    // friction, so friction stays Average: a known difference, noted in the report.
    colliderDesc.setDensity(m.density).setFriction(m.friction).setRestitution(m.restitution)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    w.createCollider(colliderDesc, b);
    return b;
  };
  return {
    box: (o) => make(o, RAPIER.ColliderDesc.cuboid(o.hw, o.hh)),
    circle: (o) => make(o, RAPIER.ColliderDesc.ball(o.r)),
    pin: (b, x, y) => {
      const p = b.translation(), a = b.rotation();
      const dx = x - p.x, dy = y - p.y, c = Math.cos(-a), s = Math.sin(-a);
      const local = { x: c * dx - s * dy, y: s * dx + c * dy };
      return w.createImpulseJoint(RAPIER.JointData.revolute({ x, y }, local), ground, b, true);
    },
    setVelocity: (b, vx, vy, av = 0) => { b.setLinvel({ x: vx, y: vy }, true); b.setAngvel(av, true); },
    step: (dt) => { w.timestep = dt; w.step(); },
    read: (b) => { const p = b.translation(); return { x: p.x, y: p.y, a: b.rotation() }; },
    free: () => w.free(),
  };
}

// ---------------------------------------------------------------- Matter.js (y down, pixels)
const PX = 100; // pixels per metre; default gravity (y = 1, scale 0.001) is then 10 m/s^2
async function createMatter({ gravity }) {
  const { Engine, Bodies, Body, Composite, Constraint } = Matter;
  const engine = Engine.create({ positionIterations: 6, velocityIterations: 4 });
  engine.gravity.y = -gravity / 10;
  const make = (o, body) => {
    Composite.add(engine.world, body);
    return body;
  };
  const opts = (o) => {
    const m = mat(o);
    return {
      isStatic: !o.dynamic,
      angle: -(o.angle || 0),
      density: 0.001 * m.density,
      friction: m.friction,
      frictionStatic: m.friction * 1.2,
      restitution: m.restitution,
      frictionAir: 0,
      slop: 0.01,
    };
  };
  const stepMs = 1000 / 60;
  return {
    box: (o) => make(o, Bodies.rectangle(o.x * PX, -o.y * PX, o.hw * 2 * PX, o.hh * 2 * PX, opts(o))),
    circle: (o) => make(o, Bodies.circle(o.x * PX, -o.y * PX, o.r * PX, opts(o))),
    pin: (b, x, y) => {
      const c = Constraint.create({
        bodyA: b,
        pointA: { x: x * PX - b.position.x, y: -y * PX - b.position.y },
        pointB: { x: x * PX, y: -y * PX },
        length: 0,
        stiffness: 1,
      });
      Composite.add(engine.world, c);
      return c;
    },
    // Matter velocities are in px per (1000/60 ms) step.
    setVelocity: (b, vx, vy, av = 0) => {
      Body.setVelocity(b, { x: (vx * PX) / 60, y: (-vy * PX) / 60 });
      Body.setAngularVelocity(b, -av / 60);
    },
    step: (dt) => Engine.update(engine, dt * 1000 || stepMs),
    read: (b) => ({ x: b.position.x / PX, y: -b.position.y / PX, a: -b.angle }),
    free: () => Engine.clear(engine),
  };
}

// ---------------------------------------------------------------- Box2D v3.1 (box2d3-wasm, embind)
const box2dModules = {};
async function createBox2d3({ gravity }, flavour = "auto") {
  // The "compat" build has no SIMD or threads, so it behaves the same on every
  // machine; "deluxe" is picked automatically by the default entry otherwise.
  box2dModules[flavour] ??= flavour === "compat" ? Box2DCompatFactory() : Box2DFactory();
  const B = await box2dModules[flavour];
  const trash = []; // embind objects must be freed by hand
  const v = (x, y) => { const o = new B.b2Vec2(x, y); trash.push(o); return o; };
  const wd = B.b2DefaultWorldDef();
  wd.gravity = v(0, gravity);
  const world = B.b2CreateWorld(wd);
  wd.delete();
  const groundDef = B.b2DefaultBodyDef();
  const ground = B.b2CreateBody(world, groundDef);
  groundDef.delete();
  const make = (o, attach) => {
    const m = mat(o);
    const bd = B.b2DefaultBodyDef();
    bd.type = o.dynamic ? B.b2BodyType.b2_dynamicBody : B.b2BodyType.b2_staticBody;
    bd.position = v(o.x, o.y);
    bd.rotation = B.b2MakeRot(o.angle || 0);
    bd.isBullet = !!o.bullet;
    const body = B.b2CreateBody(world, bd);
    bd.delete();
    const sd = B.b2DefaultShapeDef();
    sd.density = m.density;
    const sm = sd.material;
    sm.friction = m.friction;
    sm.restitution = m.restitution;
    sd.material = sm;
    attach(body, sd);
    sd.delete();
    return body;
  };
  const free = () => { for (const o of trash.splice(0)) if (!o.isDeleted()) o.delete(); };
  return {
    box: (o) => make(o, (body, sd) => {
      const poly = B.b2MakeBox(o.hw, o.hh);
      B.b2CreatePolygonShape(body, sd, poly);
      poly.delete();
    }),
    circle: (o) => make(o, (body, sd) => {
      const c = new B.b2Circle();
      c.center = v(0, 0);
      c.radius = o.r;
      B.b2CreateCircleShape(body, sd, c);
      c.delete();
    }),
    pin: (body, x, y) => {
      const jd = B.b2DefaultRevoluteJointDef();
      const base = jd.base;
      base.bodyIdA = ground;
      base.bodyIdB = body;
      const fa = base.localFrameA; fa.p = v(x, y); base.localFrameA = fa;
      const local = B.b2Body_GetLocalPoint(body, v(x, y));
      const fb = base.localFrameB; fb.p = local; base.localFrameB = fb;
      local.delete();
      jd.base = base;
      const j = B.b2CreateRevoluteJoint(world, jd);
      jd.delete();
      return j;
    },
    setVelocity: (body, vx, vy, av = 0) => { B.b2Body_SetLinearVelocity(body, v(vx, vy)); B.b2Body_SetAngularVelocity(body, av); },
    // 4 sub-steps is Box2D v3's recommended default.
    step: (dt) => { B.b2World_Step(world, dt, 4); if (trash.length > 1000) free(); },
    read: (body) => {
      const p = B.b2Body_GetPosition(body), r = B.b2Body_GetRotation(body);
      const out = { x: p.x, y: p.y, a: Math.atan2(r.s, r.c) };
      p.delete(); r.delete();
      return out;
    },
    free: () => { B.b2DestroyWorld(world); free(); },
  };
}

// ---------------------------------------------------------------- Box2D v3.0 (phaser-box2d, pure JS)
async function createPhaser({ gravity }) {
  PB.b2CreateWorldArray(); // phaser-box2d needs its world pool allocated once
  const wd = PB.b2DefaultWorldDef();
  wd.gravity = new PB.b2Vec2(0, gravity);
  const world = PB.b2CreateWorld(wd);
  const ground = PB.b2CreateBody(world, PB.b2DefaultBodyDef());
  const make = (o, attach) => {
    const m = mat(o);
    const bd = PB.b2DefaultBodyDef();
    bd.type = o.dynamic ? PB.b2BodyType.b2_dynamicBody : PB.b2BodyType.b2_staticBody;
    bd.position = new PB.b2Vec2(o.x, o.y);
    bd.rotation = PB.b2MakeRot(o.angle || 0);
    bd.isBullet = !!o.bullet;
    const body = PB.b2CreateBody(world, bd);
    const sd = PB.b2DefaultShapeDef();
    sd.density = m.density; sd.friction = m.friction; sd.restitution = m.restitution;
    attach(body, sd);
    return body;
  };
  return {
    box: (o) => make(o, (b, sd) => PB.b2CreatePolygonShape(b, sd, PB.b2MakeBox(o.hw, o.hh))),
    circle: (o) => make(o, (b, sd) => PB.b2CreateCircleShape(b, sd, new PB.b2Circle(new PB.b2Vec2(0, 0), o.r))),
    pin: (b, x, y) => {
      const jd = PB.b2DefaultRevoluteJointDef();
      jd.bodyIdA = ground; jd.bodyIdB = b;
      jd.localAnchorA = new PB.b2Vec2(x, y);
      jd.localAnchorB = PB.b2Body_GetLocalPoint(b, new PB.b2Vec2(x, y));
      return PB.b2CreateRevoluteJoint(world, jd);
    },
    setVelocity: (b, vx, vy, av = 0) => { PB.b2Body_SetLinearVelocity(b, new PB.b2Vec2(vx, vy)); PB.b2Body_SetAngularVelocity(b, av); },
    step: (dt) => PB.b2World_Step(world, dt, 4),
    read: (b) => { const p = PB.b2Body_GetPosition(b), r = PB.b2Body_GetRotation(b); return { x: p.x, y: p.y, a: Math.atan2(r.s, r.c) }; },
    free: () => PB.b2DestroyWorld(world),
  };
}

export const ENGINES = {
  planck: { create: createPlanck, label: "Planck.js 1.5.0" },
  rapier: { create: createRapier, label: "Rapier 2D 0.21.0 (deterministic)" },
  matter: { create: createMatter, label: "Matter.js 0.20.0" },
  box2d3: { create: createBox2d3, label: "box2d3-wasm 5.2.0 (Box2D v3.1, deluxe: SIMD + threads)" },
  box2d3c: { create: (o) => createBox2d3(o, "compat"), label: "box2d3-wasm 5.2.0 (Box2D v3.1, compat: no SIMD)" },
  phaser: { create: createPhaser, label: "phaser-box2d 1.1.0 (Box2D v3.0 JS)" },
};
