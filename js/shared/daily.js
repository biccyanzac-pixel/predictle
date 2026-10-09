// Which day it is. Everyone gets the same puzzles on a UTC date, whatever their timezone.
export const todayUTC = (now = new Date()) => now.toISOString().slice(0, 10);
export const dayFile = (date) => `puzzles/${date}.prd`;
/** 0 = Monday ... 6 = Sunday (difficulty rises through the week). */
export const weekdayOf = (date) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
/** The date to play: ?date= for past days (archive) or any day on a local dev server; otherwise today. */
export function pickDate(search, { local = false, now = new Date() } = {}) {
  const q = new URLSearchParams(search).get("date");
  if (isDate(q) && (local || q <= todayUTC(now))) return q;
  return todayUTC(now);
}

/** The first day of Predictle: day #1. (Set to the real launch date when going live.) */
export const LAUNCH_DAY = "2026-10-09";
export const dayNumber = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${LAUNCH_DAY}T00:00:00Z`)) / 864e5) + 1;
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** Milliseconds until the next 00:00 UTC (when new puzzles appear). */
export const msUntilNextDay = (now = Date.now()) => Math.ceil((now + 1) / 864e5) * 864e5 - now;
