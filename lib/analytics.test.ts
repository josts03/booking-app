import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fromZonedTime } from "date-fns-tz";
import { computeAnalytics, type AnalyticsInput } from "./analytics";
import { buildFixtures, FIXTURE_TIMEZONE, fixtureUuid } from "./fixtures";
import type { Booking, TimeOff } from "./types";

// Wednesday 16. 9. 2026, 10:00 in Ljubljana. Two weeks: from Monday 7. 9. until now.
const NOW = new Date("2026-09-16T08:00:00Z");
const f = buildFixtures(NOW);
const [maja, luka] = f.staff;
// Mon-Fri 9-17: 7 full days (7.-11. 9., 14.-15. 9.) and 9:00-10:00 today.
const WORK_MINUTES = 7 * 480 + 60;

let n = 0;
/** A fixture booking moved to a local time ("2026-09-08 10:00"), with its own length, status and staff. */
function booking(local: string, minutes: number, status: Booking["status"], staffId = maja.id, price = 2500): Booking {
  const start = fromZonedTime(local.replace(" ", "T") + ":00", FIXTURE_TIMEZONE);
  return {
    ...f.bookings[0],
    id: fixtureUuid(99, ++n),
    staff_id: staffId,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
    status,
    price_cents: price,
  };
}

function analytics(bookings: Booking[], extra: Partial<AnalyticsInput> = {}) {
  return computeAnalytics({
    bookings,
    staffHours: f.staffHours,
    timeOff: [],
    timezone: FIXTURE_TIMEZONE,
    weeks: 2,
    now: NOW,
    ...extra,
  });
}

describe("computeAnalytics", () => {
  test("totals, weeks and the comparison of staff follow the same rules", () => {
    const result = analytics([
      booking("2026-09-08 10:00", 60, "completed", maja.id, 3000),
      booking("2026-09-14 09:00", 30, "no_show", maja.id),
      booking("2026-09-15 11:00", 45, "cancelled", maja.id), // never counted
      booking("2026-09-15 12:00", 30, "completed", luka.id, 2000),
    ]);

    assert.equal(result.bookings, 3);
    assert.equal(result.revenue_cents, 5000);
    assert.equal(result.completed, 2);
    assert.equal(result.no_shows, 1);
    assert.equal(result.no_show_rate, 1 / 3);
    assert.equal(result.occupancy, 120 / (2 * WORK_MINUTES));
    assert.deepEqual(result.weeks, [
      { week_start: "2026-09-07", bookings: 1, revenue_cents: 3000 },
      { week_start: "2026-09-14", bookings: 2, revenue_cents: 2000 },
    ]);

    const byId = new Map(result.staff.map((s) => [s.staff_id, s]));
    assert.deepEqual(byId.get(maja.id), {
      staff_id: maja.id,
      bookings: 2,
      revenue_cents: 3000,
      occupancy: 90 / WORK_MINUTES,
      no_show_rate: 0.5,
      completed: 1,
      no_shows: 1,
    });
    assert.deepEqual(byId.get(luka.id), {
      staff_id: luka.id,
      bookings: 1,
      revenue_cents: 2000,
      occupancy: 30 / WORK_MINUTES,
      no_show_rate: 0,
      completed: 1,
      no_shows: 0,
    });
    // The staff numbers add up to the totals.
    assert.equal(result.staff.reduce((sum, s) => sum + s.bookings, 0), result.bookings);
    assert.equal(result.staff.reduce((sum, s) => sum + s.revenue_cents, 0), result.revenue_cents);
  });

  test("only bookings that already started inside the period count", () => {
    const result = analytics([
      booking("2026-09-04 10:00", 30, "completed"), // before Monday 7. 9.
      booking("2026-09-16 11:00", 30, "confirmed"), // later today
      booking("2026-09-21 10:00", 30, "confirmed"), // next week
    ]);
    assert.equal(result.bookings, 0);
    assert.equal(result.revenue_cents, 0);
    assert.equal(result.occupancy, 0);
    assert.equal(result.no_show_rate, null);
    // Staff with working hours are listed even without bookings.
    assert.deepEqual(result.staff.map((s) => [s.staff_id, s.bookings, s.occupancy]), [
      [maja.id, 0, 0],
      [luka.id, 0, 0],
    ]);
  });

  test("time off removes working minutes; without working hours occupancy is unknown", () => {
    const closed: TimeOff = {
      id: fixtureUuid(98, 1),
      salon_id: maja.salon_id,
      staff_id: null, // the whole salon
      starts_at: fromZonedTime("2026-09-08T00:00:00", FIXTURE_TIMEZONE).toISOString(),
      ends_at: fromZonedTime("2026-09-09T00:00:00", FIXTURE_TIMEZONE).toISOString(),
      reason: null,
    };
    const lukaAway: TimeOff = { ...closed, id: fixtureUuid(98, 2), staff_id: luka.id, starts_at: "2026-09-14T07:00:00Z", ends_at: "2026-09-14T11:00:00Z" };
    const former = fixtureUuid(2, 99); // e.g. an inactive staff member: bookings, no hours
    const result = analytics(
      [booking("2026-09-10 10:00", 60, "completed", maja.id), booking("2026-09-10 10:00", 60, "completed", former)],
      { timeOff: [closed, lukaAway] },
    );
    const byId = new Map(result.staff.map((s) => [s.staff_id, s]));
    assert.equal(byId.get(maja.id)!.occupancy, 60 / (WORK_MINUTES - 480));
    assert.equal(byId.get(luka.id)!.occupancy, 0);
    assert.equal(byId.get(former)!.occupancy, null);
    assert.equal(byId.get(former)!.bookings, 1);
    // Totals: both bookings, Maja's and Luka's working time only.
    assert.equal(result.occupancy, 120 / (2 * (WORK_MINUTES - 480) - 240));
  });

  test("weeks are the salon's local Monday to Sunday", () => {
    const result = analytics([
      booking("2026-09-13 23:30", 30, "completed"), // Sunday night: still the first week (21:30 UTC)
      booking("2026-09-14 00:30", 30, "completed"), // Monday just after midnight: 13. 9. 22:30 UTC
    ]);
    assert.deepEqual(result.weeks.map((w) => [w.week_start, w.bookings]), [
      ["2026-09-07", 1],
      ["2026-09-14", 1],
    ]);
  });
});
