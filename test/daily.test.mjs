import { test } from "node:test";
import assert from "node:assert/strict";
import { todayUTC, pickDate, weekdayOf, dayFile, isDate } from "../public/js/shared/daily.js";

test("the day is the UTC date, whatever the local timezone", () => {
  // 23:30 in New York on the 9th is already the 10th in UTC; 00:30 in Tokyo on the 10th is still the 9th.
  assert.equal(todayUTC(new Date("2026-10-09T23:30:00-04:00")), "2026-10-10");
  assert.equal(todayUTC(new Date("2026-10-10T00:30:00+09:00")), "2026-10-09");
  assert.equal(todayUTC(new Date("2026-10-09T23:59:59.999Z")), "2026-10-09");
  assert.equal(todayUTC(new Date("2026-10-10T00:00:00.000Z")), "2026-10-10");
  assert.equal(dayFile("2026-10-10"), "puzzles/2026-10-10.prd");
});

test("?date= : past days allowed, future days only locally, junk ignored", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  assert.equal(pickDate("?date=2026-10-01", { now }), "2026-10-01");
  assert.equal(pickDate("?date=2026-10-11", { now }), "2026-10-10");
  assert.equal(pickDate("?date=2026-10-11", { now, local: true }), "2026-10-11");
  assert.equal(pickDate("?date=2026-02-30", { now }), "2026-10-10");
  assert.equal(pickDate("?date=../../etc", { now }), "2026-10-10");
  assert.equal(pickDate("", { now }), "2026-10-10");
  assert.ok(!isDate("2026-13-01"));
});

test("weekday: Monday = 0 ... Sunday = 6", () => {
  assert.equal(weekdayOf("2026-10-12"), 0);
  assert.equal(weekdayOf("2026-10-18"), 6);
});
