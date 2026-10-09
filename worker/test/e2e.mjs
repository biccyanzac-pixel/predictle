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
// main board: the exact answer for round 1, a rough one for round 2; bonus: a near miss
const main = header.puzzles.filter((p) => p.slot !== 'bonus'), bonus = header.puzzles.find((p) => p.slot === 'bonus');
const guesses = main.map((p, i) => (i === 0 ? { ...p.answer.final } : { x: p.answer.final.x + 1, y: p.answer.final.y }));
const expected = main.map((p, i) => Math.round(scorePuzzle(p, guesses[i]) * 100) / 100);
const bonusGuess = [{ x: bonus.answer.hit.x, y: bonus.answer.hit.y }];
const s = await call('/api/session', {});
check(s.status === 200 && s.body.playerId && s.body.token, 'session issued');
check(s.cors === origin, 'CORS echoes the allowed origin');
const bad = await call('/api/submit', { ...s.body, token: 'nope', day, board: 'main', name: 'X', guesses });
check(bad.status === 401, 'wrong token rejected');
const future = await call('/api/submit', { ...s.body, day: '2999-01-01', board: 'main', name: 'X', guesses });
check(future.status === 400, 'future day rejected');
const wrongCount = await call('/api/submit', { ...s.body, day, board: 'main', name: 'X', guesses: guesses.slice(1) });
check(wrongCount.status === 400, 'wrong number of guesses rejected');
const sub = await call('/api/submit', { ...s.body, day, board: 'main', name: '  Tester  ', guesses, scores: [100, 100] });
check(sub.status === 200, `submitted (${sub.status} ${sub.body.message ?? ''})`);
check(JSON.stringify(sub.body.scores) === JSON.stringify(expected), `server scored the guesses itself: ${sub.body.scores} vs expected ${expected}`);
check(sub.body.scores[0] === 100, 'exact answer scores 100');
check(sub.body.board?.top?.some((r) => r.you && r.name === 'Tester'), 'board shows you with a trimmed name');
const again = await call('/api/submit', { ...s.body, day, board: 'main', name: 'Tester', guesses });
const bon = await call('/api/submit', { ...s.body, day, board: 'bonus', name: 'Tester', guesses: bonusGuess });
check(bon.status === 200 && bon.body.scores[0] === 100, 'bonus board: exact wall hit scores 100, on its own board');
const badBoard = await call('/api/submit', { ...s.body, day, board: 'nope', name: 'Tester', guesses });
check(badBoard.status === 400, 'unknown board rejected');
check(again.status === 409, 'second submission for the day rejected');
const board = await call(`/api/leaderboard?day=${day}&board=bonus&playerId=${s.body.playerId}`);
check(board.status === 200 && board.body.players >= 1, 'leaderboard readable');
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
