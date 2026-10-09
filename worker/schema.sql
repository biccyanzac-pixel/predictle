-- D1 schema for Predictle's shared daily leaderboard.
--
-- Unlike Yogle and ridd-le, the browser does not send scores: it sends the
-- player's guesses, and the worker scores them itself against the day's
-- published puzzle file (the true outcomes are in it). Inflating a score would
-- mean guessing better, which is the game.

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,   -- server-generated UUID
  token_hash TEXT NOT NULL,      -- SHA-256 of a server-issued session token
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players (id),
  day_key      TEXT NOT NULL,                 -- UTC day, YYYY-MM-DD
  display_name TEXT NOT NULL,
  total        REAL NOT NULL CHECK (total >= 0 AND total <= 300),
  scores       TEXT NOT NULL,                 -- JSON array of per-puzzle scores (computed here)
  guesses      TEXT NOT NULL,                 -- JSON array of the raw guesses
  submitted_at TEXT NOT NULL,
  -- 0 = played on the day (the real board); 1 = played later from the archive. Never ranked together.
  is_late      INTEGER NOT NULL DEFAULT 0
);

-- One result per player per day per board: a prediction can't be retried once you've seen the answer.
CREATE UNIQUE INDEX IF NOT EXISTS results_player_day ON results (player_id, day_key, is_late);
CREATE INDEX IF NOT EXISTS results_board ON results (day_key, is_late, total DESC, submitted_at ASC);
