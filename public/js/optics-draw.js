// Drawing the aim-the-laser round (world metres, y up; called from the Renderer overlay).
import { TARGET_R, SWEEP_N, sweepAngle } from "./shared/optics.js";

const SILVER = "#c9d2dc", EDGE = "#56606d", BEAM = "#ff2d55", WALL = "#2b3140";

function polyPath(ctx, pts) { ctx.beginPath(); ctx.moveTo(...pts[0]); for (const q of pts.slice(1)) ctx.lineTo(...q); ctx.closePath(); }
function label(ctx, x, y, text, colour, size = 0.22) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1, -1);
  ctx.fillStyle = colour; ctx.font = `700 ${size}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0); ctx.restore();
}

function piece(ctx, m, px) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (m.t === "wallMirror") {
    for (const [x1, y1, x2, y2] of m.segs) {
      // drawn just inside the wall so the whole strip is visible
      const ix = x1 === x2 ? (x1 === 0 ? 0.08 : -0.08) : 0, iy = y1 === y2 ? (y1 === 0 ? 0.08 : -0.08) : 0;
      ctx.beginPath(); ctx.moveTo(x1 + ix, y1 + iy); ctx.lineTo(x2 + ix, y2 + iy);
      ctx.strokeStyle = SILVER; ctx.lineWidth = 0.16; ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2 * px; ctx.stroke();
    }
    return;
  }
  if (m.t === "block") { polyPath(ctx, m.pts); ctx.fillStyle = WALL; ctx.fill(); ctx.strokeStyle = "#11151f"; ctx.lineWidth = 2 * px; ctx.stroke(); return; }
  if (m.t === "glass" || m.t === "lens") {
    ctx.beginPath();
    if (m.t === "lens") ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); else polyPath(ctx, m.pts);
    ctx.fillStyle = "rgba(120, 200, 255, 0.28)"; ctx.fill();
    ctx.strokeStyle = "rgba(40, 140, 210, 0.8)"; ctx.lineWidth = 2 * px; ctx.stroke();
    const cx = m.t === "lens" ? m.x : m.pts.reduce((s, p) => s + p[0], 0) / m.pts.length;
    const cy = m.t === "lens" ? m.y : m.pts.reduce((s, p) => s + p[1], 0) / m.pts.length;
    label(ctx, cx, cy, `n=${m.n}`, "rgba(20, 90, 150, 0.95)", 0.2);
    return;
  }
  if (m.t === "mirror" && !m.pts) {
    for (const [x1, y1, x2, y2] of m.segs) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = EDGE; ctx.lineWidth = 0.13; ctx.stroke();
      ctx.strokeStyle = SILVER; ctx.lineWidth = 0.08; ctx.stroke();
    }
    return;
  }
  if (m.t === "arc") {
    ctx.beginPath(); ctx.moveTo(...m.pts[0]); for (const q of m.pts.slice(1)) ctx.lineTo(...q);
    ctx.strokeStyle = EDGE; ctx.lineWidth = 0.13; ctx.stroke(); ctx.strokeStyle = SILVER; ctx.lineWidth = 0.08; ctx.stroke();
    return;
  }
  ctx.beginPath();
  if (m.t === "ball") ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); else polyPath(ctx, m.pts);
  ctx.fillStyle = SILVER; ctx.fill(); ctx.strokeStyle = EDGE; ctx.lineWidth = 3 * px; ctx.stroke();
  if (m.t === "ball") { ctx.beginPath(); ctx.arc(m.x - m.r * 0.35, m.y + m.r * 0.35, m.r * 0.25, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fill(); }
}

export function beam(ctx, path, upTo, px, colour = BEAM) {
  ctx.save();
  ctx.beginPath(); ctx.moveTo(...path[0]);
  let left = upTo;
  for (let i = 1; i < path.length && left > 0; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], L = Math.hypot(bx - ax, by - ay), u = Math.min(1, left / L);
    ctx.lineTo(ax + (bx - ax) * u, ay + (by - ay) * u);
    left -= L;
  }
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = colour === BEAM ? "rgba(255,45,85,0.25)" : "rgba(0,0,0,0.12)"; ctx.lineWidth = 0.16; ctx.stroke();
  ctx.strokeStyle = colour; ctx.lineWidth = 0.05; ctx.stroke();
  ctx.restore();
}

/** Ring of every possible aim around the emitter: green where the beam hits the target. */
function ring(ctx, p, px) {
  const R = 0.85, e = p.emitter;
  ctx.save();
  ctx.lineWidth = 0.22;
  let start = 0;
  const hit = (k) => p.sweep[k % SWEEP_N] <= Math.round(TARGET_R * 100);
  for (let k = 1; k <= SWEEP_N; k++) {
    if (k === SWEEP_N || hit(k) !== hit(start)) {
      ctx.beginPath();
      ctx.arc(e.x, e.y, R, sweepAngle(start), sweepAngle(k) + (hit(start) ? 0.004 : 0));
      ctx.strokeStyle = hit(start) ? "rgba(26, 160, 70, 0.95)" : "rgba(220, 50, 60, 0.28)";
      ctx.stroke();
      start = k;
    }
  }
  ctx.restore();
  void px;
}

export function drawAim(ctx, p, { px, aim, path, shown, time, showRing, guessPath, closestAt, done }) {
  const W = p.world.width, H = p.world.height;
  ctx.strokeStyle = WALL; ctx.lineWidth = 0.14; ctx.strokeRect(0.07, 0.07, W - 0.14, H - 0.14);
  for (const m of p.pieces) piece(ctx, m, px);
  // target: a bullseye, gently pulsing
  const t = p.target, pulse = 1 + 0.06 * Math.sin(time * 4);
  for (const [rr, c] of [[TARGET_R * pulse, "#e03131"], [TARGET_R * 0.66, "#fff"], [TARGET_R * 0.33, "#e03131"]]) {
    ctx.beginPath(); ctx.arc(t.x, t.y, rr, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
  }
  if (showRing) ring(ctx, p, px);
  if (guessPath) beam(ctx, guessPath, Infinity, px, "rgba(255,150,40,0.85)");
  if (path) beam(ctx, path, shown, px);
  if (done && closestAt) {
    ctx.setLineDash([4 * px, 4 * px]); ctx.strokeStyle = "#ffb000"; ctx.lineWidth = 2.5 * px;
    ctx.beginPath(); ctx.moveTo(closestAt.x, closestAt.y); ctx.lineTo(t.x, t.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(closestAt.x, closestAt.y, 0.09, 0, Math.PI * 2); ctx.fillStyle = "#ffb000"; ctx.fill();
  }
  // emitter, pointing where you aim
  const e = p.emitter;
  ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(aim);
  ctx.fillStyle = WALL; ctx.fillRect(-0.34, -0.15, 0.46, 0.3);
  ctx.fillStyle = BEAM; ctx.beginPath(); ctx.arc(0.12, 0, 0.07 + 0.015 * Math.sin(time * 6), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
