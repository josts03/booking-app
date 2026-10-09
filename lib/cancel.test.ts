import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canCancel, cancelDeadline } from "./cancel";
import { buildFixtures } from "./fixtures";

const NOW = new Date("2026-09-16T08:00:00Z");
const booking = buildFixtures(NOW).bookings[0]; // next Monday 10:00
const HOUR = 3_600_000;
const before = (hours: number) => new Date(Date.parse(booking.starts_at) - hours * HOUR);

describe("canCancel: more than cancel_window_hours before the start", () => {
  test("well before the deadline: yes", () => assert.equal(canCancel(booking, 24, before(48)), true));
  test("one second before the deadline: yes", () =>
    assert.equal(canCancel(booking, 24, new Date(before(24).getTime() - 1000)), true));
  test("exactly cancel_window_hours before: no (the rule says MORE than)", () =>
    assert.equal(canCancel(booking, 24, before(24)), false));
  test("inside the window, at the start, after the start: no", () => {
    assert.equal(canCancel(booking, 24, before(2)), false);
    assert.equal(canCancel(booking, 24, before(0)), false);
    assert.equal(canCancel(booking, 24, before(-1)), false);
  });
  test("a window of 0 hours: until the start", () => {
    assert.equal(canCancel(booking, 0, before(0.01)), true);
    assert.equal(canCancel(booking, 0, before(0)), false);
  });
  test("only pending and confirmed bookings", () => {
    assert.equal(canCancel({ ...booking, status: "pending" }, 24, before(48)), true);
    for (const status of ["cancelled", "no_show", "completed"] as const) {
      assert.equal(canCancel({ ...booking, status }, 24, before(48)), false, status);
    }
  });
  test("cancelDeadline is the start minus the window", () =>
    assert.equal(cancelDeadline(booking.starts_at, 24).toISOString(), before(24).toISOString()));
});
