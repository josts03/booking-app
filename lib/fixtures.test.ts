import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFixtures } from "./fixtures";
import { isE164 } from "./phone";

const NOW = new Date("2026-10-08T10:00:00Z");
const f = buildFixtures(NOW);

test("same `now` gives the same data (mock and seed match)", () => {
  assert.deepEqual(buildFixtures(NOW), f);
});

test("the test salon: 2 staff, 5 services, 120 customers, Mon-Fri hours", () => {
  assert.equal(f.salons.length, 1);
  assert.equal(f.salons[0].slug, "test");
  assert.equal(f.staff.length, 2);
  assert.equal(f.services.length, 5);
  assert.equal(f.customers.length, 120);
  assert.equal(f.staffHours.length, 10);
  assert.ok(f.bookings.length > 500);
});

test("customer phones are E.164 and unique (database constraints)", () => {
  const phones = f.customers.map((c) => c.phone);
  assert.ok(phones.every((p) => p !== null && isE164(p)));
  assert.equal(new Set(phones).size, phones.length);
});

test("every booking's staff, service and customer belong to the salon, and the staff performs the service", () => {
  for (const b of f.bookings) {
    assert.ok(f.staff.some((s) => s.id === b.staff_id && s.salon_id === b.salon_id));
    assert.ok(f.services.some((s) => s.id === b.service_id && s.salon_id === b.salon_id));
    assert.ok(f.customers.some((c) => c.id === b.customer_id && c.salon_id === b.salon_id));
    assert.ok(f.staffServices.some((l) => l.staff_id === b.staff_id && l.service_id === b.service_id));
  }
});

test("no two pending/confirmed bookings of one staff member overlap, buffer included", () => {
  const active = f.bookings.filter((b) => b.status === "pending" || b.status === "confirmed");
  for (const member of f.staff) {
    const own = active
      .filter((b) => b.staff_id === member.id)
      .map((b) => ({ from: Date.parse(b.starts_at), to: Date.parse(b.ends_at) + b.buffer_min * 60_000 }))
      .sort((a, b) => a.from - b.from);
    for (let i = 1; i < own.length; i++) assert.ok(own[i].from >= own[i - 1].to);
  }
});

test("bookings in the future are never completed or no-shows", () => {
  for (const b of f.bookings) {
    if (Date.parse(b.starts_at) > NOW.getTime()) assert.ok(b.status === "confirmed" || b.status === "pending");
  }
});
