// Canvas renderer for a recorded puzzle. Draws the static scene, decorations and
// the dynamic bodies at a (fractional) frame. No physics happens here.
import { MATERIALS, MATERIAL_BY_ID } from "./shared/materials.js";
import { poseAt } from "./shared/codec.js";

const patternCache = new Map();

// Each material: a fill colour plus a pattern, so they differ without colour vision.
function materialPattern(ctx, name, px) {
  const key = `${name}@${px}`;
  if (patternCache.has(key)) return patternCache.get(key);
  const m = MATERIALS[name];
  const s = Math.max(8, Math.round(px)); // tile size in device pixels
  const c = new OffscreenCanvas(s, s), g = c.getContext("2d");
  g.fillStyle = m.colour;
  g.fillRect(0, 0, s, s);
  g.strokeStyle = m.ink;
  g.fillStyle = m.ink;
  g.lineWidth = Math.max(1, s / 12);
  if (m.pattern === "grain") {
    for (const y of [0.3, 0.75]) {
      g.beginPath();
      g.moveTo(0, y * s);
      g.bezierCurveTo(s * 0.3, y * s - s * 0.12, s * 0.6, y * s + s * 0.12, s, y * s);
      g.stroke();
    }
  } else if (m.pattern === "dots") {
    for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) { g.beginPath(); g.arc(x * s, y * s, s * 0.11, 0, 7); g.fill(); }
  } else if (m.pattern === "hatch") {
    g.beginPath();
    g.moveTo(0, s); g.lineTo(s, 0);
    g.moveTo(-s / 2, s / 2); g.lineTo(s / 2, -s / 2);
    g.moveTo(s / 2, s * 1.5); g.lineTo(s * 1.5, s / 2);
    g.stroke();
  } else if (m.pattern === "speckle") {
    for (const [x, y] of [[0.2, 0.3], [0.65, 0.15], [0.45, 0.6], [0.85, 0.7], [0.15, 0.85]]) { g.fillRect(x * s, y * s, s / 10, s / 10); }
  } else if (m.pattern === "rivets") {
    g.globalAlpha = 0.55;
    g.strokeRect(0, 0, s, s);
    g.globalAlpha = 1;
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.09, 0, 7); g.fill();
  }
  const p = ctx.createPattern(c, "repeat");
  patternCache.set(key, p);
  return p;
}

export class Renderer {
  constructor(canvas, meta, motion) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.meta = meta;
    this.motion = motion;
    this.markers = []; // { x, y, colour, label } world-space guess markers
  }

  // Fit the 3:4 world into the canvas's CSS box, letterboxed, at device resolution.
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    const { width: W, height: H } = this.meta.world;
    this.scale = Math.min(this.canvas.width / W, this.canvas.height / H);
    this.ox = (this.canvas.width - W * this.scale) / 2;
    this.oy = (this.canvas.height - H * this.scale) / 2;
    this.tile = this.scale * 0.18;
  }

  // world metres -> canvas transform (y up -> y down)
  enterWorld() {
    const { ctx } = this;
    ctx.setTransform(this.scale, 0, 0, -this.scale, this.ox, this.oy + this.meta.world.height * this.scale);
  }

  fill(name) {
    // Patterns are in device pixels; undo the world scale so they tile at a fixed screen size.
    const p = materialPattern(this.ctx, name, this.tile);
    p.setTransform(new DOMMatrix().scale(1 / this.scale, -1 / this.scale));
    return p;
  }

  drawShape(s, material) {
    const { ctx } = this, m = MATERIALS[s.m ?? material];
    ctx.lineWidth = 1.5 / this.scale;
    ctx.strokeStyle = m.ink;
    ctx.fillStyle = this.fill(s.m ?? material);
    ctx.beginPath();
    if (s.t === "circle") {
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    } else if (s.t === "box") {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.a ?? 0);
      ctx.rect(-s.hw, -s.hh, s.hw * 2, s.hh * 2);
      ctx.restore();
    } else if (s.t === "path") {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = s.thick + 3 / this.scale;
      ctx.strokeStyle = m.ink;
      ctx.moveTo(...s.pts[0]);
      for (const p of s.pts.slice(1)) ctx.lineTo(...p);
      ctx.stroke();
      ctx.lineWidth = s.thick;
      ctx.strokeStyle = this.fill(s.m);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.fill();
    ctx.stroke();
  }

  drawDecor(d, time) {
    const { ctx } = this, px = 1 / this.scale;
    ctx.save();
    if (d.t === "fan") {
      ctx.fillStyle = "rgba(120, 170, 255, 0.10)";
      ctx.strokeStyle = "rgba(70, 120, 220, 0.55)";
      ctx.setLineDash([6 * px, 5 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.fillRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
      ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
      ctx.setLineDash([]);
      // moving arrows show the push direction
      const len = Math.hypot(d.ax, d.ay), ux = d.ax / len, uy = d.ay / len;
      const phase = (time * 0.8) % 1;
      ctx.strokeStyle = "rgba(50, 100, 210, 0.75)";
      ctx.lineWidth = 2.5 * px;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
        const cx = d.x1 + ((i + 0.5) / 3) * (d.x2 - d.x1) + ux * (phase - 0.5) * 0.4;
        const cy = d.y1 + ((j + 0.5) / 4) * (d.y2 - d.y1) + uy * (phase - 0.5) * 0.4;
        const a = 0.18;
        ctx.beginPath();
        ctx.moveTo(cx - ux * a, cy - uy * a);
        ctx.lineTo(cx + ux * a, cy + uy * a);
        ctx.lineTo(cx + ux * a - (ux + uy) * 0.08, cy + uy * a - (uy - ux) * 0.08);
        ctx.moveTo(cx + ux * a, cy + uy * a);
        ctx.lineTo(cx + ux * a - (ux - uy) * 0.08, cy + uy * a - (uy + ux) * 0.08);
        ctx.stroke();
      }
    } else if (d.t === "conveyor") {
      // chevrons sliding along the belt at its speed
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2 * px;
      const dir = Math.sign(d.speed) || 1, step = 0.3;
      const off = ((time * Math.abs(d.speed)) % step) * dir;
      ctx.beginPath();
      ctx.rect(d.x1, d.y - d.h / 2, d.x2 - d.x1, d.h);
      ctx.clip();
      for (let x = d.x1 - step; x < d.x2 + step; x += step) {
        const cx = x + off;
        ctx.moveTo(cx - 0.05 * dir, d.y + d.h * 0.3);
        ctx.lineTo(cx + 0.05 * dir, d.y);
        ctx.lineTo(cx - 0.05 * dir, d.y - d.h * 0.3);
      }
      ctx.stroke();
    } else if (d.t === "fulcrum") {
      ctx.fillStyle = "#5b6475";
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 0.22, d.y - 0.45);
      ctx.lineTo(d.x + 0.22, d.y - 0.45);
      ctx.closePath();
      ctx.fill();
    } else if (d.t === "pivot") {
      ctx.fillStyle = "#2b3140";
      ctx.beginPath();
      ctx.arc(d.x, d.y, 0.07, 0, 7);
      ctx.fill();
    } else if (d.t === "chute") {
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
    } else if (d.t === "buckets") {
      ctx.fillStyle = "rgba(20, 33, 61, 0.55)";
      ctx.font = `${0.32}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      const w = (d.x2 - d.x1) / d.n;
      for (let k = 0; k < d.n; k++) {
        ctx.save();
        ctx.translate(d.x1 + (k + 0.5) * w, d.y + d.h * 0.45);
        ctx.scale(1, -1);
        ctx.fillText(String(k + 1), 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // The spring coil depends on where the plate is now.
  drawSpringCoil(d, plateY) {
    const { ctx } = this, n = 7, top = plateY - 0.06, bottom = d.base;
    ctx.save();
    ctx.strokeStyle = "#3a4049";
    ctx.lineWidth = 3 / this.scale;
    ctx.beginPath();
    ctx.moveTo(d.x, bottom);
    for (let i = 1; i <= n; i++) ctx.lineTo(d.x + (i % 2 ? 0.22 : -0.22) * (i === n ? 0 : 1), bottom + ((top - bottom) * i) / n);
    ctx.stroke();
    ctx.restore();
  }

  draw(frame, time) {
    if (!this.scale) this.resize();
    const { ctx, meta, motion } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(this.canvas).getPropertyValue("--letterbox") || "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.enterWorld();
    ctx.fillStyle = getComputedStyle(this.canvas).getPropertyValue("--sky") || "#fff";
    ctx.fillRect(0, 0, meta.world.width, meta.world.height);

    for (const d of meta.decor) if (d.t === "fan" || d.t === "chute") this.drawDecor(d, time);
    for (const d of meta.decor) if (d.t === "spring") {
      const k = meta.bodies.findIndex((b) => b.comp === d.comp);
      this.drawSpringCoil(d, poseAt(motion.bodies[k], frame).y);
    }
    for (const s of meta.statics) this.drawShape(s);
    for (const d of meta.decor) if (d.t !== "fan" && d.t !== "chute") this.drawDecor(d, time);

    meta.bodies.forEach((b, k) => {
      const p = poseAt(motion.bodies[k], frame);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      for (const s of b.shapes) this.drawShape(s, b.m);
      if (b.kind === "ball") {
        // a spoke so rolling is visible
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 2 / this.scale;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(b.shapes[0].r * 0.8, 0); ctx.stroke();
      }
      ctx.restore();
      if (b.label) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(1, -1);
        ctx.fillStyle = "#fff";
        const s0 = b.shapes[0], size = s0.t === "circle" ? s0.r * 1.1 : Math.min(s0.hw, s0.hh) * 1.5;
        ctx.font = `bold ${size}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(b.label, 0, 0);
        ctx.restore();
      }
    });

    // caller-supplied overlay (guess markers, answer, highlights), in world coordinates
    if (this.overlay) { ctx.save(); this.overlay(ctx, frame, time); ctx.restore(); }

    for (const m of this.markers) {
      ctx.save();
      ctx.strokeStyle = m.colour;
      ctx.lineWidth = 3 / this.scale;
      ctx.beginPath();
      ctx.moveTo(m.x - 0.18, m.y - 0.18); ctx.lineTo(m.x + 0.18, m.y + 0.18);
      ctx.moveTo(m.x - 0.18, m.y + 0.18); ctx.lineTo(m.x + 0.18, m.y - 0.18);
      ctx.stroke();
      ctx.restore();
    }

    // Magnifier: while placing a guess with a finger, show the area under it, enlarged, above it.
    if (this.loupe) {
      const { x, y } = this.loupe, R = Math.round(Math.min(this.canvas.width, this.canvas.height) * 0.16), zoom = 2.2;
      const cx = x, cy = Math.max(R + 4, y - R * 1.6);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(this.canvas, x - R / zoom, y - R / zoom, (2 * R) / zoom, (2 * R) / zoom, cx - R, cy - R, 2 * R, 2 * R);
      ctx.restore();
      ctx.lineWidth = Math.max(2, R / 30);
      ctx.strokeStyle = "#14213d";
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8); ctx.stroke();
    }
  }

  /** Canvas client (CSS px) coordinates -> world metres. */
  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(), k = this.canvas.width / r.width;
    const px = (clientX - r.left) * k, py = (clientY - r.top) * k;
    return { x: (px - this.ox) / this.scale, y: this.meta.world.height - (py - this.oy) / this.scale, px, py };
  }
}

export { MATERIAL_BY_ID };
