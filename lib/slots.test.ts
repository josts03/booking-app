/**
 * Tests for the free-slot engine, written before lib/slots.ts (specs/slots.md).
 * Cases 1-10 are the table in the spec; the rest pin down the other rules.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { prostiTermini, type Interval, type VhodTerminov } from "./slots";

const TZ = "Europe/Ljubljana";
const DAY = "2026-09-21"; // Monday

/** Local wall-clock time on a day in TZ -> instant. */
function local(day: string, hhmm: string): Date {
  return fromZonedTime(`${day}T${hhmm}:00`, TZ);
}

/** Start times as local "HH:mm". */
function starts(slots: Interval[], tz = TZ): string[] {
  return slots.map((s) => formatInTimeZone(s.od, tz, "HH:mm"));
}

function minutes(interval: Interval): number {
  return (interval.do.getTime() - interval.od.getTime()) / 60_000;
}

/** A normal day: 9-17, 30 min, step 15, nothing booked, "now" is the day before. */
function input(overrides: Partial<VhodTerminov> = {}): VhodTerminov {
  return {
    dan: DAY,
    casovniPas: TZ,
    trajanjeMin: 30,
    cistilniCasMin: 0,
    korakMin: 15,
    najkrajsaNajavaMin: 0,
    zdaj: local("2026-09-20", "12:00"),
    urniki: [{ start: "09:00", end: "17:00" }],
    odsotnosti: [],
    zasedeno: [],
    ...overrides,
  };
}

describe("specs/slots.md, the ten cases", () => {
  test("1: no working hours -> empty list", () => {
    assert.deepEqual(prostiTermini(input({ urniki: [] })), []);
  });

  test("2: window 9-17, time off 12-17 -> nothing at or after 12:00", () => {
    const slots = prostiTermini(input({ odsotnosti: [{ od: local(DAY, "12:00"), do: local(DAY, "17:00") }] }));
    assert.ok(slots.length > 0);
    for (const slot of slots) assert.ok(slot.do <= local(DAY, "12:00"), starts([slot])[0]);
    assert.equal(starts(slots).at(-1), "11:30");
  });

  test("3: window 9-10, duration 90 -> empty list", () => {
    assert.deepEqual(prostiTermini(input({ urniki: [{ start: "09:00", end: "10:00" }], trajanjeMin: 90 })), []);
  });

  test("4: window 9-10, duration 60, step 15 -> exactly one slot, 9:00", () => {
    const slots = prostiTermini(input({ urniki: [{ start: "09:00", end: "10:00" }], trajanjeMin: 60 }));
    assert.deepEqual(slots, [{ od: local(DAY, "09:00"), do: local(DAY, "10:00") }]);
  });

  const busy = [
    { od: local(DAY, "09:00"), do: local(DAY, "10:00") },
    { od: local(DAY, "10:30"), do: local(DAY, "12:00") },
  ];

  test("5: booked 9-10 and 10:30-12, duration 30 -> 10:00 exists", () => {
    assert.ok(starts(prostiTermini(input({ zasedeno: busy }))).includes("10:00"));
  });

  test("6: same as 5 with a 10 min buffer -> no 10:00", () => {
    assert.ok(!starts(prostiTermini(input({ zasedeno: busy, cistilniCasMin: 10 }))).includes("10:00"));
  });

  test("7: now 8:30, minimum notice 120 min, window 9-17 -> first slot not before 10:30", () => {
    const slots = prostiTermini(input({ zdaj: local(DAY, "08:30"), najkrajsaNajavaMin: 120 }));
    assert.equal(starts(slots)[0], "10:30");
    for (const slot of slots) assert.ok(slot.od >= local(DAY, "10:30"));
  });

  // 8 and 9: a full day 9-17 at 30 min every 15 min is 31 slots: 9:00 ... 16:30.
  const fullDay = Array.from({ length: 31 }, (_, i) => {
    const m = 9 * 60 + i * 15;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });

  test("8: day clocks go forward (29. 3. 2026), window 9-17 -> every slot once, in local time", () => {
    const slots = prostiTermini(input({ dan: "2026-03-29", zdaj: local("2026-03-28", "12:00") }));
    assert.deepEqual(starts(slots), fullDay);
    assert.ok(slots.every((s) => minutes(s) === 30));
    assert.equal(slots[0].od.toISOString(), "2026-03-29T07:00:00.000Z"); // 9:00 summer time = UTC+2
  });

  test("9: day clocks go back (25. 10. 2026), window 9-17 -> every slot once, in local time", () => {
    const slots = prostiTermini(input({ dan: "2026-10-25", zdaj: local("2026-10-24", "12:00") }));
    assert.deepEqual(starts(slots), fullDay);
    assert.ok(slots.every((s) => minutes(s) === 30));
    assert.equal(slots[0].od.toISOString(), "2026-10-25T08:00:00.000Z"); // 9:00 winter time = UTC+1
  });

  test("10: a booking covers the whole window -> empty list", () => {
    const zasedeno = [{ od: local(DAY, "08:00"), do: local(DAY, "18:00") }];
    assert.deepEqual(prostiTermini(input({ zasedeno })), []);
  });
});

describe("the other rules", () => {
  test("rule 2: the window is in the salon's time zone, not the server's", () => {
    const slots = prostiTermini(input({ casovniPas: "America/New_York", zdaj: new Date("2026-09-20T00:00:00Z") }));
    assert.equal(slots[0].od.toISOString(), "2026-09-21T13:00:00.000Z"); // 9:00 EDT
    assert.equal(starts(slots, "America/New_York")[0], "09:00");
  });

  test("rule 6 and 8: the buffer must fit in the window, the returned end has no buffer", () => {
    const slots = prostiTermini(input({ trajanjeMin: 45, cistilniCasMin: 5 }));
    assert.ok(slots.every((s) => minutes(s) === 45));
    assert.equal(starts(slots).at(-1), "16:00"); // 16:00 + 45 + 5 = 16:50; 16:15 would end 17:05
  });

  test("rule 5: slots stay on the quarter-hour grid, also right after a booking", () => {
    // A 45 + 5 min booking 9:00-9:50 leaves 9:50-17:00 free: next slot 10:00, not 9:50.
    const slots = prostiTermini(input({ zasedeno: [{ od: local(DAY, "09:00"), do: local(DAY, "09:50") }] }));
    assert.deepEqual(starts(slots).slice(0, 3), ["10:00", "10:15", "10:30"]);
    assert.ok(starts(prostiTermini(input())).every((t) => ["00", "15", "30", "45"].includes(t.slice(3))));
  });

  test("rule 5: a window that starts off the grid starts at the next grid time", () => {
    const slots = prostiTermini(input({ urniki: [{ start: "09:10", end: "11:00" }] }));
    assert.equal(starts(slots)[0], "09:15");
  });

  test("rule 9: sorted by start, also with several windows given out of order", () => {
    const urniki = [
      { start: "14:00", end: "16:00" },
      { start: "09:00", end: "11:00" },
    ];
    const slots = prostiTermini(input({ urniki }));
    const times = slots.map((s) => s.od.getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    assert.equal(starts(slots)[0], "09:00");
    assert.ok(starts(slots).includes("14:00"));
    assert.ok(!starts(slots).includes("11:00"));
  });

  test("no slot overlaps time off or a booking, also when they overlap each other", () => {
    const odsotnosti = [{ od: local(DAY, "13:00"), do: local(DAY, "14:00") }];
    const zasedeno = [
      { od: local(DAY, "10:00"), do: local(DAY, "11:00") },
      { od: local(DAY, "10:30"), do: local(DAY, "11:20") },
      { od: local(DAY, "13:30"), do: local(DAY, "14:10") },
    ];
    const blocked = [...odsotnosti, ...zasedeno];
    const slots = prostiTermini(input({ odsotnosti, zasedeno }));
    for (const slot of slots) {
      for (const b of blocked) assert.ok(slot.do <= b.od || slot.od >= b.do, starts([slot])[0]);
    }
    assert.ok(starts(slots).includes("11:30")); // first grid time after 11:20
    assert.ok(starts(slots).includes("14:15")); // first grid time after 14:10
  });

  test("time off that starts the day before and ends the day after blocks the whole day", () => {
    const odsotnosti = [{ od: local("2026-09-20", "00:00"), do: local("2026-09-23", "00:00") }];
    assert.deepEqual(prostiTermini(input({ odsotnosti })), []);
  });

  test("seconds in staff_hours (\"09:00:00\", as Postgres returns them) work too", () => {
    const slots = prostiTermini(input({ urniki: [{ start: "09:00:00", end: "10:00:00" }], trajanjeMin: 60 }));
    assert.equal(slots.length, 1);
  });

  test("a pure function: never reads the clock, same input -> same output", (t) => {
    t.mock.method(Date, "now", () => {
      throw new Error("lib/slots.ts must not call Date.now()");
    });
    const v = input({ zdaj: local(DAY, "08:30"), najkrajsaNajavaMin: 120 });
    assert.deepEqual(prostiTermini(v), prostiTermini(v));
  });

  test("does not change its input", () => {
    const v = input({ zasedeno: oneBooking() });
    const before = structuredClone(v);
    prostiTermini(v);
    assert.deepEqual(v, before);
  });

  test("overlapping working windows do not give the same slot twice", () => {
    const urniki = [
      { start: "09:00", end: "12:00" },
      { start: "11:00", end: "13:00" },
    ];
    const times = starts(prostiTermini(input({ urniki })));
    assert.equal(new Set(times).size, times.length);
    assert.equal(times[0], "09:00");
    assert.equal(times.at(-1), "12:30");
  });

  test("impossible input is refused instead of looping or guessing", () => {
    assert.throws(() => prostiTermini(input({ urniki: [{ start: "17:00", end: "09:00" }] })), RangeError);
    assert.throws(() => prostiTermini(input({ casovniPas: "Evropa/Ljubljana" })), RangeError);
    assert.throws(() => prostiTermini(input({ korakMin: 0 })), RangeError);
    assert.throws(() => prostiTermini(input({ trajanjeMin: 0 })), RangeError);
    assert.throws(() => prostiTermini(input({ cistilniCasMin: -5 })), RangeError);
    assert.throws(() => prostiTermini(input({ dan: "21. 9. 2026" })), RangeError);
    assert.throws(() => prostiTermini(input({ urniki: [{ start: "9h", end: "17:00" }] })), RangeError);
  });
});

function oneBooking(): Interval[] {
  return [{ od: local(DAY, "09:00"), do: local(DAY, "10:00") }];
}
