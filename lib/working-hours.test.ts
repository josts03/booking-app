import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fromZonedTime } from "date-fns-tz";
import { buildFixtures, FIXTURE_TIMEZONE } from "./fixtures";
import { workingHoursProblem, type HoursCheck } from "./working-hours";

// Wednesday 16. 9. 2026. Maja and Luka work Mon-Fri 9-17; Luka is off on Friday 25. 9.
const f = buildFixtures(new Date("2026-09-16T08:00:00Z"));
const TZ = FIXTURE_TIMEZONE;
const MAJA = f.staff[0].id;
const LUKA = f.staff[1].id;
const local = (day: string, hhmm: string) => fromZonedTime(`${day}T${hhmm}:00`, TZ);

function check(staffId: string, day: string, from: string, to: string, extra: Partial<HoursCheck> = {}) {
  return workingHoursProblem({
    staffId,
    start: local(day, from),
    busyEnd: local(day, to),
    hours: f.staffHours,
    timeOff: f.timeOff,
    timeZone: TZ,
    ...extra,
  });
}

describe("workingHoursProblem: a booking entered by hand", () => {
  test("inside the working hours: fine", () => {
    assert.equal(check(MAJA, "2026-09-21", "10:00", "10:50"), null);
    assert.equal(check(MAJA, "2026-09-21", "09:00", "17:00"), null); // the whole day, edges included
  });

  test("before opening, after closing, or the buffer past closing: not working", () => {
    assert.equal(check(MAJA, "2026-09-21", "08:30", "09:15"), "not-working");
    assert.equal(check(MAJA, "2026-09-21", "17:00", "17:30"), "not-working");
    // 16:30-17:00 plus 5 min cleaning: the engine would not offer it either (slots.md rule 6)
    assert.equal(check(MAJA, "2026-09-21", "16:30", "17:05"), "not-working");
  });

  test("a day without working hours: not working", () => {
    assert.equal(check(MAJA, "2026-09-26", "10:00", "10:30"), "not-working"); // Saturday
  });

  test("the staff member's own absence, or the whole salon closed: absent", () => {
    assert.equal(check(LUKA, "2026-09-25", "10:00", "10:30"), "absent");
    assert.equal(check(MAJA, "2026-09-25", "10:00", "10:30"), null); // Luka's absence is not Maja's
    const salonClosed = [{ staff_id: null, starts_at: local("2026-09-22", "12:00").toISOString(), ends_at: local("2026-09-22", "13:00").toISOString() }];
    assert.equal(check(MAJA, "2026-09-22", "11:45", "12:15", { timeOff: salonClosed }), "absent");
    assert.equal(check(MAJA, "2026-09-22", "13:00", "13:30", { timeOff: salonClosed }), null); // right after
  });

  test("a split day (9-12 and 13-17): a booking over the lunch break does not fit", () => {
    const split = [
      { staff_id: MAJA, weekday: 2, start_time: "09:00:00", end_time: "12:00:00" },
      { staff_id: MAJA, weekday: 2, start_time: "13:00:00", end_time: "17:00:00" },
    ];
    assert.equal(check(MAJA, "2026-09-22", "11:30", "12:00", { hours: split }), null);
    assert.equal(check(MAJA, "2026-09-22", "11:45", "12:15", { hours: split }), "not-working");
    assert.equal(check(MAJA, "2026-09-22", "13:00", "13:45", { hours: split }), null);
  });

  test("working hours that end at 24:00 (valid in Postgres)", () => {
    const night = [{ staff_id: MAJA, weekday: 2, start_time: "20:00:00", end_time: "24:00:00" }];
    assert.equal(check(MAJA, "2026-09-22", "23:00", "23:55", { hours: night }), null);
  });

  test("the day the clocks go back (25. 10. 2026): local times stay right", () => {
    const sunday = [{ staff_id: MAJA, weekday: 0, start_time: "09:00:00", end_time: "17:00:00" }];
    assert.equal(check(MAJA, "2026-10-25", "09:00", "09:30", { hours: sunday }), null);
    assert.equal(check(MAJA, "2026-10-25", "16:45", "17:00", { hours: sunday }), null);
    assert.equal(check(MAJA, "2026-10-25", "08:45", "09:15", { hours: sunday }), "not-working");
  });
});
