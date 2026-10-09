/**
 * Predictle shared leaderboard: Cloudflare Worker + D1 (same pattern as Yogle and ridd-le).
 *
 * Server-authoritative scoring: the browser sends a name and its raw guesses; this worker
 * fetches the day's published puzzle file (PUZZLE_BASE + YYYY-MM-DD.prd), reads the true
 * outcomes from its header and scores the guesses with the same code the game uses
 * (../../public/js/shared/scoring.js). It also:
 *   - issues player ids + tokens (/api/session); a submission must present the token,
 *   - refuses future days; "late" = a past day replayed from the archive (separate board),
 *   - allows one result per player per day per board (insert-only).
 */
import { readDayHeader } from '../../public/js/shared/codec.js';
import { scorePuzzle } from '../../public/js/shared/scoring.js';

const MAX_NAME = 20;
const BOARD_SIZE = 20;

export const todayKey = (now = new Date()) => now.toISOString().slice(0, 10);

function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

function validateName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || [...name].length > MAX_NAME) return null;
  return name;
}

// Only the fields a format uses, as plain numbers: nothing else from the client is stored.
function cleanGuess(format, g) {
  if (!g || typeof g !== 'object') return null;
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
  switch (format) {
    case 'stop': case 'freeze': return n(g.x) === null || n(g.y) === null ? null : { x: n(g.x), y: n(g.y) };
    case 'height': return n(g.y) === null ? null : { y: n(g.y) };
    case 'time': return n(g.t) === null ? null : { t: n(g.t) };
    case 'dominoes': return Number.isInteger(g.n) && g.n >= 0 && g.n <= 50 ? { n: g.n } : null;
    case 'place': return Number.isInteger(g.choice) && g.choice >= 0 && g.choice < 16 ? { choice: g.choice } : null;
    default: return null;
  }
}

// Day headers, cached per isolate (a day's file never changes once published).
const headers = new Map();
async function dayHeader(env, day) {
  if (headers.has(day)) return headers.get(day);
  const res = await fetch(`${env.PUZZLE_BASE}${day}.prd`, { cf: { cacheTtl: 3600 } });
  if (!res.ok) return null;
  const raw = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const { header } = readDayHeader(new Uint8Array(raw));
  headers.set(day, header);
  return header;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- HTTP plumbing ---

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return '*';
  return allowed.includes(origin) ? origin : allowed[0];
}

const cors = (request, env) => ({
  'Access-Control-Allow-Origin': allowedOrigin(request, env),
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});
const json = (request, env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(request, env) } });
const fail = (request, env, code, message, status) => json(request, env, { error: code, message }, status);

// in-memory, per isolate: enough to blunt a burst
const hits = new Map();
function rateLimited(ip, bucket, limit) {
  const now = Date.now(), key = `${bucket}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3600_000);
  const over = recent.length >= limit;
  if (!over) recent.push(now);
  hits.set(key, recent);
  return over;
}

// --- routes ---

async function handleSession(request, env, ip) {
  if (rateLimited(ip, 'session', 30)) return fail(request, env, 'rate_limited', 'Too many new sessions from here.', 429);
  const playerId = crypto.randomUUID(), token = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO players (id, token_hash, created_at) VALUES (?, ?, ?)')
    .bind(playerId, await sha256Hex(token), new Date().toISOString()).run();
  return json(request, env, { playerId, token });
}

async function verifyPlayer(env, playerId, token) {
  if (typeof playerId !== 'string' || typeof token !== 'string' || !playerId || !token) return false;
  const row = await env.DB.prepare('SELECT token_hash FROM players WHERE id = ?').bind(playerId).first();
  return !!row && row.token_hash === (await sha256Hex(token));
}

export async function fetchBoard(env, day, late, playerId) {
  const { results } = await env.DB.prepare(
    `SELECT player_id, display_name, total, scores, submitted_at FROM results
      WHERE day_key = ? AND is_late = ? ORDER BY total DESC, submitted_at ASC, id ASC`,
  ).bind(day, late ? 1 : 0).all();
  const rows = results ?? [];
  const view = (r, i) => ({ rank: i + 1, name: r.display_name, total: r.total, scores: JSON.parse(r.scores), you: r.player_id === playerId });
  const yi = playerId ? rows.findIndex((r) => r.player_id === playerId) : -1;
  return { day, late: !!late, players: rows.length, top: rows.slice(0, BOARD_SIZE).map(view), you: yi >= BOARD_SIZE ? view(rows[yi], yi) : null };
}

async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const day = url.searchParams.get('day') || todayKey();
  if (!validDay(day)) return fail(request, env, 'bad_day', 'Invalid day.', 400);
  const late = url.searchParams.get('late') === '1';
  return json(request, env, await fetchBoard(env, day, late, url.searchParams.get('playerId')));
}

async function handleSubmit(request, env, ip) {
  if (rateLimited(ip, 'submit', 60)) return fail(request, env, 'rate_limited', 'Too many submissions from here. Try again later.', 429);
  let body;
  try { body = await request.json(); } catch { return fail(request, env, 'bad_request', 'Invalid JSON.', 400); }
  const { playerId, token, day } = body ?? {};
  if (!(await verifyPlayer(env, playerId, token))) return fail(request, env, 'bad_session', 'Invalid or missing session. Reload the page.', 401);
  if (!validDay(day)) return fail(request, env, 'bad_day', 'Invalid day.', 400);
  const today = todayKey();
  if (day > today) return fail(request, env, 'bad_day', "That day hasn't happened yet.", 400);
  const name = validateName(body.name);
  if (!name) return fail(request, env, 'bad_name', `Name must be 1-${MAX_NAME} characters.`, 400);
  const header = await dayHeader(env, day);
  if (!header) return fail(request, env, 'no_puzzle', 'No puzzles for that day.', 404);
  if (!Array.isArray(body.guesses) || body.guesses.length !== header.puzzles.length) return fail(request, env, 'bad_guesses', 'One guess per puzzle, please.', 400);
  const guesses = header.puzzles.map((p, i) => cleanGuess(p.format, body.guesses[i]));
  const scores = header.puzzles.map((p, i) => Math.round(scorePuzzle(p, guesses[i]) * 100) / 100);
  const total = Math.round(scores.reduce((s, x) => s + x, 0) * 100) / 100;
  const late = day !== today ? 1 : 0;
  try {
    await env.DB.prepare(
      `INSERT INTO results (id, player_id, day_key, display_name, total, scores, guesses, submitted_at, is_late)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), playerId, day, name, total, JSON.stringify(scores), JSON.stringify(guesses), new Date().toISOString(), late).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(request, env, 'already', "You've already submitted for this day.", 409);
    throw e;
  }
  return json(request, env, { ok: true, late: !!late, scores, total, board: await fetchBoard(env, day, late, playerId) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(request, env) });
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    try {
      if (url.pathname === '/api/session' && request.method === 'POST') return await handleSession(request, env, ip);
      if (url.pathname === '/api/leaderboard' && request.method === 'GET') return await handleLeaderboard(request, env);
      if (url.pathname === '/api/submit' && request.method === 'POST') return await handleSubmit(request, env, ip);
      return fail(request, env, 'not_found', 'No such endpoint.', 404);
    } catch (err) {
      console.error(err);
      return fail(request, env, 'server_error', 'Something broke. Try again.', 500);
    }
  },
};
