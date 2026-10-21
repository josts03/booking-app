import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canChangeStatus, needsConfirmation, statusActionLabel, statusChanges } from "./booking-status";
import { buildFixtures } from "./fixtures";
import type { BookingStatus } from "./types";

const NOW = new Date("2026-09-16T08:00:00Z");
const base = buildFixtures(NOW).bookings[0]; // next Monday 10:00
const HOUR = 3_600_000;
const at = (status: BookingStatus) => ({ ...base, status });
const beforeStart = new Date(Date.parse(base.starts_at) - HOUR);
const afterStart = new Date(Date.parse(base.starts_at) + 10 * 60_000);

describe("statusChanges: what the admin may do with a booking", () => {
  test("a pending booking: confirm or cancel", () => {
    assert.deepEqual(statusChanges(at("pending"), beforeStart), ["confirmed", "cancelled"]);
  });

  test("a confirmed booking before its start: only cancel", () => {
    assert.deepEqual(statusChanges(at("confirmed"), beforeStart), ["cancelled"]);
  });

  test("a confirmed booking once it has started: completed, no-show or cancel", () => {
    assert.deepEqual(statusChanges(at("confirmed"), afterStart), ["completed", "no_show", "cancelled"]);
    assert.deepEqual(statusChanges(at("confirmed"), new Date(base.starts_at)), ["completed", "no_show", "cancelled"]);
  });

  test("completed and no-show can go back to confirmed (a mistapped button)", () => {
    assert.deepEqual(statusChanges(at("completed"), afterStart), ["confirmed"]);
    assert.deepEqual(statusChanges(at("no_show"), afterStart), ["confirmed"]);
  });

  test("cancelled is final", () => {
    assert.deepEqual(statusChanges(at("cancelled"), afterStart), []);
    for (const to of ["pending", "confirmed", "completed", "no_show"] as const) {
      assert.equal(canChangeStatus(at("cancelled"), to, afterStart), false, to);
    }
  });

  test("never no-show or completed before the start, never straight from pending", () => {
    assert.equal(canChangeStatus(at("confirmed"), "no_show", beforeStart), false);
    assert.equal(canChangeStatus(at("confirmed"), "completed", beforeStart), false);
    assert.equal(canChangeStatus(at("pending"), "completed", afterStart), false);
    assert.equal(canChangeStatus(at("pending"), "no_show", afterStart), false);
    assert.equal(canChangeStatus(at("confirmed"), "pending", afterStart), false);
    assert.equal(canChangeStatus(at("confirmed"), "confirmed", afterStart), false);
  });
});

test("button labels in Slovenian", () => {
  assert.equal(statusActionLabel("pending", "confirmed"), "Potrdi");
  assert.equal(statusActionLabel("no_show", "confirmed"), "Vrni na potrjeno");
  assert.equal(statusActionLabel("confirmed", "completed"), "Opravljeno");
  assert.equal(statusActionLabel("confirmed", "no_show"), "Ni prišel");
  assert.equal(statusActionLabel("confirmed", "cancelled"), "Odpovej");
});

test("cancel and no-show ask first", () => {
  assert.equal(needsConfirmation("cancelled"), true);
  assert.equal(needsConfirmation("no_show"), true);
  assert.equal(needsConfirmation("completed"), false);
  assert.equal(needsConfirmation("confirmed"), false);
});
