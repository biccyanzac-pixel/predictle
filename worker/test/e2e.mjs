// End-to-end test against a running worker: node test/e2e.mjs http://127.0.0.1:8798
// Needs the dev site serving the puzzle files (node tools/serve.mjs) for PUZZLE_BASE.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readDayHeader } from '../../public/js/shared/codec.js';
import { scorePuzzle } from '../../public/js/shared/scoring.js';

const base = process.argv[2] || 'http://127.0.0.1:8798';
const origin = 'http://localhost:8090';
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const call = async (path, body) => {
  const res = await fetch(base + path, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Origin: origin } } : { headers: { Origin: origin } });
  return { status: res.status, body: await res.json(), cors: res.headers.get('access-control-allow-origin') };
};

const day = new Date().toISOString().slice(0, 10);
const { header } = readDayHeader(new Uint8Array(gunzipSync(readFileSync(new URL(`../../public/puzzles/${day}.prd`, import.meta.url)))));
// a guess per puzzle: the exact answer for the first, rough ones for the rest
const guesses = header.puzzles.map((p, i) => {
  const a = p.answer;
  switch (p.format) {
    case 'stop': case 'freeze': return i === 0 ? { ...a.final } : { x: a.final.x + 1, y: a.final.y };
    case 'height': return { y: a.peak + (i === 0 ? 0 : 0.8) };
    case 'time': return { t: a.seconds + (i === 0 ? 0 : 0.5) };
    case 'dominoes': return { n: a.fallen + (i === 0 ? 0 : 1) };
    case 'place': return { choice: i === 0 ? a.solution : (a.solution + 1) % p.candidates.length };
  }
});
const expected = header.puzzles.map((p, i) => Math.round(scorePuzzle(p, guesses[i]) * 100) / 100);

const s = await call('/api/session', {});
check(s.status === 200 && s.body.playerId && s.body.token, 'session issued');
check(s.cors === origin, 'CORS echoes the allowed origin');
const bad = await call('/api/submit', { ...s.body, token: 'nope', day, name: 'X', guesses });
check(bad.status === 401, 'wrong token rejected');
const future = await call('/api/submit', { ...s.body, day: '2999-01-01', name: 'X', guesses });
check(future.status === 400, 'future day rejected');
const wrongCount = await call('/api/submit', { ...s.body, day, name: 'X', guesses: guesses.slice(1) });
check(wrongCount.status === 400, 'wrong number of guesses rejected');
const sub = await call('/api/submit', { ...s.body, day, name: '  Tester  ', guesses, scores: [100, 100, 100] });
check(sub.status === 200, `submitted (${sub.status} ${sub.body.message ?? ''})`);
check(JSON.stringify(sub.body.scores) === JSON.stringify(expected), `server scored the guesses itself: ${sub.body.scores} vs expected ${expected}`);
check(sub.body.scores[0] === 100, 'exact answer scores 100');
check(sub.body.board?.top?.some((r) => r.you && r.name === 'Tester'), 'board shows you with a trimmed name');
const again = await call('/api/submit', { ...s.body, day, name: 'Tester', guesses });
check(again.status === 409, 'second submission for the day rejected');
const board = await call(`/api/leaderboard?day=${day}&playerId=${s.body.playerId}`);
check(board.status === 200 && board.body.players >= 1, 'leaderboard readable');
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
