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
