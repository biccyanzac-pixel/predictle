// Client for the leaderboard worker (worker/). Sends a name and the guesses; the
// worker recomputes the scores itself from the day's puzzle file.
// Fails soft: with no URL configured, or the worker down, the game still works.
let base;
let cfgPromise;

async function url() {
  if (base !== undefined) return base;
  const override = new URLSearchParams(location.search).get("api");
  cfgPromise ??= fetch("./config.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const cfg = await cfgPromise;
  // On localhost, default to the local worker (cd worker && npm run dev:local).
  const local = ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://127.0.0.1:8798" : "";
  base = (override || (local || cfg.leaderboardUrl) || "").replace(/\/+$/, "") || null;
  return base;
}

export function configured() { return base !== null; }
export const ready = url();

async function call(path, init) {
  const b = await url();
  if (!b) throw new Error("No leaderboard configured.");
  const res = await fetch(b + path, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Leaderboard error ${res.status}`);
  return body;
}

function session() {
  try { return JSON.parse(localStorage.getItem("predictle:session") || "null"); } catch { return null; }
}

async function ensureSession() {
  let s = session();
  if (s) return s;
  s = await call("/api/session", { method: "POST", body: "{}" });
  try { localStorage.setItem("predictle:session", JSON.stringify(s)); } catch { /* still works this visit */ }
  return s;
}

export async function submit(day, name, guesses) {
  const s = await ensureSession();
  return call("/api/submit", { method: "POST", body: JSON.stringify({ ...s, day, name, guesses }) });
}

export async function board(day) {
  const s = session();
  return call(`/api/leaderboard?day=${day}${s ? `&playerId=${encodeURIComponent(s.playerId)}` : ""}`);
}
