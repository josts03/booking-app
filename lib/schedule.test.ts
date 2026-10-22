import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildFixtures, FIXTURE_TIMEZONE } from "./fixtures";
import { absenceRange, checkWeek, weekFromHours } from "./schedule";

const TZ = FIXTURE_TIMEZONE;
const f = buildFixtures(new Date("2026-09-16T08:00:00Z"));
const MAJA = f.staff[0].id;

describe("checkWeek: a staff member's weekly hours", () => {
  test("Mon-Fri 9-17 and a split Saturday become rows with local times", () => {
    const result = checkWeek({
      1: [{ start: "09:00", end: "17:00" }],
      6: [
        { start: "13:00", end: "16:00" },
        { start: "08:00", end: "12:00" },
      ],
    });
    assert.deepEqual(result, {
      ok: true,
      rows: [
        { weekday: 1, start_time: "09:00:00", end_time: "17:00:00" },
        { weekday: 6, start_time: "08:00:00", end_time: "12:00:00" },
        { weekday: 6, start_time: "13:00:00", end_time: "16:00:00" },
      ],
    });
  });

  test("a week without windows is valid: every day off", () => {
    assert.deepEqual(checkWeek({}), { ok: true, rows: [] });
  });

  test("touching windows are fine, overlapping ones are not", () => {
    assert.equal(checkWeek({ 2: [{ start: "09:00", end: "12:00" }, { start: "12:00", end: "17:00" }] }).ok, true);
    assert.deepEqual(checkWeek({ 2: [{ start: "09:00", end: "13:00" }, { start: "12:00", end: "17:00" }] }), {
      ok: false,
      errors: { 2: "Delovna okna se prekrivajo." },
    });
  });

  test("end before start, bad times, too many windows: an error per day", () => {
    const result = checkWeek({
      1: [{ start: "17:00", end: "09:00" }],
      3: [{ start: "9", end: "17:00" }],
      5: [
        { start: "08:00", end: "09:00" },
        { start: "10:00", end: "11:00" },
        { start: "12:00", end: "13:00" },
        { start: "14:00", end: "15:00" },
      ],
    });
    assert.deepEqual(result, {
      ok: false,
      errors: {
        1: "Konec mora biti za začetkom.",
        3: "Vpišite uri, npr. 09:00 in 17:00.",
        5: "Največ 3 okna na dan.",
      },
    });
  });
});

test("weekFromHours: the fixtures' Mon-Fri 9-17 back as editor values", () => {
  const week = weekFromHours(f.staffHours.filter((h) => h.staff_id === MAJA));
  assert.deepEqual(week[1], [{ start: "09:00", end: "17:00" }]);
  assert.deepEqual(week[6], []);
  assert.deepEqual(week[0], []);
  assert.deepEqual(weekFromHours([{ weekday: 2, start_time: "20:00:00", end_time: "24:00:00" }])[2], [{ start: "20:00", end: "23:59" }]);
});

describe("absenceRange: days or hours, in the salon's time zone", () => {
  test("whole days: from local midnight to the midnight after the last day", () => {
    assert.deepEqual(absenceRange({ firstDay: "2026-09-21", lastDay: "2026-09-25" }, TZ), {
      ok: true,
      starts_at: "2026-09-20T22:00:00.000Z", // 00:00 summer time
      ends_at: "2026-09-25T22:00:00.000Z",
    });
  });

  test("over the change to winter time the local days stay whole", () => {
    assert.deepEqual(absenceRange({ firstDay: "2026-10-24", lastDay: "2026-10-26" }, TZ), {
      ok: true,
      starts_at: "2026-10-23T22:00:00.000Z",
      ends_at: "2026-10-26T23:00:00.000Z", // 27. 10. 00:00 winter time
    });
  });

  test("part of one day", () => {
    assert.deepEqual(absenceRange({ firstDay: "2026-09-22", lastDay: "2026-09-22", from: "10:00", to: "11:30" }, TZ), {
      ok: true,
      starts_at: "2026-09-22T08:00:00.000Z",
      ends_at: "2026-09-22T09:30:00.000Z",
    });
  });

  test("refused: last day first, hours over several days, end before start, bad dates, over a year", () => {
    const err = (input: Parameters<typeof absenceRange>[0]) => {
      const result = absenceRange(input, TZ);
      return result.ok ? "ok" : result.error;
    };
    assert.equal(err({ firstDay: "2026-09-25", lastDay: "2026-09-21" }), "Zadnji dan ne more biti pred prvim.");
    assert.equal(err({ firstDay: "2026-09-21", lastDay: "2026-09-22", from: "10:00", to: "12:00" }), "Ure lahko vpišete samo za en dan.");
    assert.equal(err({ firstDay: "2026-09-22", lastDay: "2026-09-22", from: "12:00", to: "10:00" }), "Konec mora biti za začetkom.");
    assert.equal(err({ firstDay: "2026-09-22", lastDay: "2026-09-22", from: "10:00" }), "Vpišite uri, npr. 10:00 in 12:00.");
    assert.equal(err({ firstDay: "2026-02-31", lastDay: "2026-03-01" }), "Izberite dan.");
    assert.equal(err({ firstDay: "2026-01-01", lastDay: "2027-06-01" }), "Odsotnost je lahko dolga največ eno leto.");
  });
});
