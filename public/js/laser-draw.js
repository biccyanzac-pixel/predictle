// Drawing the laser bonus: walls, mirrors, emitter, the beam (up to a length), guess and answer.
// Called from the Renderer overlay, so coordinates are world metres (y up).

export function beamLength(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return L;
}

const SILVER = "#c9d2dc", EDGE = "#56606d", BEAM = "#ff2d55";

function mirror(ctx, m, px) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (m.t === "flat" || m.t === "arc") {
    const pts = m.t === "flat" ? [[m.x1, m.y1], [m.x2, m.y2]] : m.pts;
    ctx.beginPath(); ctx.moveTo(...pts[0]); for (const q of pts.slice(1)) ctx.lineTo(...q);
    ctx.strokeStyle = EDGE; ctx.lineWidth = 0.13; ctx.stroke();
    ctx.strokeStyle = SILVER; ctx.lineWidth = 0.08; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2 * px; ctx.stroke();
    return;
  }
  ctx.beginPath();
  if (m.t === "round") ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
  else { ctx.moveTo(...m.pts[0]); ctx.lineTo(...m.pts[1]); ctx.lineTo(...m.pts[2]); ctx.closePath(); }
  ctx.fillStyle = SILVER; ctx.fill();
  ctx.strokeStyle = EDGE; ctx.lineWidth = 3 * px; ctx.stroke();
  // a little shine
  if (m.t === "round") { ctx.beginPath(); ctx.arc(m.x - m.r * 0.35, m.y + m.r * 0.35, m.r * 0.25, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fill(); }
}

function beam(ctx, path, upTo, px) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...path[0]);
  let left = upTo;
  for (let i = 1; i < path.length && left > 0; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], L = Math.hypot(bx - ax, by - ay);
    const u = Math.min(1, left / L);
    ctx.lineTo(ax + (bx - ax) * u, ay + (by - ay) * u);
    left -= L;
  }
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,45,85,0.25)"; ctx.lineWidth = 0.16; ctx.stroke();
  ctx.strokeStyle = BEAM; ctx.lineWidth = 0.05; ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.5 * px; ctx.stroke();
  ctx.restore();
}

function wallMark(ctx, p, colour, px, R = 0.22) {
  ctx.fillStyle = colour; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * px;
  ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

export function drawLaser(ctx, p, { px, shown, guess, answer, time }) {
  const W = p.world.width, H = p.world.height;
  // walls: a thick frame the beam ends on
  ctx.strokeStyle = "#2b3140"; ctx.lineWidth = 0.14;
  ctx.strokeRect(0.07, 0.07, W - 0.14, H - 0.14);
  for (const m of p.mirrors) mirror(ctx, m, px);
  // the beam, then the emitter on top
  beam(ctx, p.answer.path, shown, px);
  const e = p.emitter, ang = Math.atan2(e.dy, e.dx);
  ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(ang);
  ctx.fillStyle = "#2b3140"; ctx.fillRect(-0.32, -0.14, 0.42, 0.28);
  ctx.fillStyle = BEAM; ctx.beginPath(); ctx.arc(0.1, 0, 0.07 + 0.015 * Math.sin(time * 6), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (guess) wallMark(ctx, guess, "#d9480f", px);
  if (answer) wallMark(ctx, answer, "#1a7f37", px, 0.26);
}
