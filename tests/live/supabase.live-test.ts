/**
 * Tests against the REAL Supabase project in .env.local (not part of `npm test`).
 *
 *   npm run test:live
 *
 * They check what only the live project can show: the Data API really refuses
 * what 003_rls.sql forbids, lib/data.ts works against PostgREST, and two
 * simultaneous bookings of one time end with exactly one booking
 * (specs/slots.md, test 11). Everything they create is removed at the end:
 * a temporary second salon, and test customers with phones +38640999xxx.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { addDays, format, getDay, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  BOOKING_MESSAGES,
  createBooking,
  getBookings,
  getCustomers,
  getFreeSlots,
  getSalon,
  getServices,
  getStaff,
  updateService,
} from "../../lib/data";
import { FIXTURE_SALON_ID, FIXTURE_TIMEZONE, buildFixtures } from "../../lib/fixtures";
import { adminDb } from "../../lib/supabase/admin";
import { publicDb } from "../../lib/supabase/public";
import type { NewBooking } from "../../lib/types";

const TZ = FIXTURE_TIMEZONE;
const SALON = FIXTURE_SALON_ID;
const f = buildFixtures(new Date());
const MAJA = f.staff[0].id;
const LUKA = f.staff[1].id;
const MENS_CUT = f.services[0]; // 30 min, no buffer
const WOMENS_CUT = f.services[1]; // 45 min + 5 min buffer
const COLORING = f.services[3]; // Luka does not do coloring

const TEST_PHONE_PREFIX = "+38640999";
const run = Math.floor(Math.random() * 900 + 100); // phones +38640999<run><n> stay unique per run
const phone = (n: number) => `${TEST_PHONE_PREFIX}${run}${n}`.slice(0, 13);

const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
/** A local date `days` after today, moved forward to the given weekday (0 = Sunday). */
function dayAhead(days: number, weekday: number): string {
  let date = addDays(parseISO(today), days);
  while (getDay(date) !== weekday) date = addDays(date, 1);
  return format(date, "yyyy-MM-dd");
}
const TEST_DAY = dayAhead(21, 2); // a Tuesday about three weeks ahead: no seed bookings there

const createdBookingIds: string[] = [];
const tempSalonIds: string[] = [];

function newBooking(overrides: Partial<NewBooking>): NewBooking {
  return {
    salon_id: SALON,
    service_id: MENS_CUT.id,
    staff_id: MAJA,
    starts_at: "",
    first_name: "Test",
    last_name: "Live",
    phone: phone(1),
    email: "live-test@example.com",
    customer_note: "live-test",
    marketing_consent: false,
    ...overrides,
  };
}

async function remember(result: Awaited<ReturnType<typeof createBooking>>) {
  if (result.ok) createdBookingIds.push(result.booking.id);
  return result;
}

before(async () => {
  assert.ok(process.env.SUPABASE_SECRET_KEY, "Run with npm run test:live (needs .env.local)");
  const salon = await getSalon("test");
  assert.ok(salon, 'The seed salon "test" is missing: run npm run seed and load supabase/seed.sql');
});

after(async () => {
  const db = adminDb();
  if (createdBookingIds.length) {
    const { error } = await db.from("bookings").delete().in("id", createdBookingIds);
    if (error) console.error("cleanup bookings:", error.message);
  }
  // Any booking of a test customer (also ones a failed assertion did not record).
  const { data: testCustomers } = await db
    .from("customers")
    .select("id")
    .eq("salon_id", SALON)
    .like("phone", `${TEST_PHONE_PREFIX}%`);
  const ids = (testCustomers ?? []).map((c) => c.id);
  if (ids.length) {
    await db.from("bookings").delete().in("customer_id", ids);
    const { error } = await db.from("customers").delete().in("id", ids);
    if (error) console.error("cleanup customers:", error.message);
  }
  if (tempSalonIds.length) {
    const { error } = await db.from("salons").delete().in("id", tempSalonIds);
    if (error) console.error("cleanup temp salons:", error.message);
  }
});

describe("the live Data API refuses what 003_rls.sql forbids (publishable key)", () => {
  const DENIED = "42501";

  test("no private table can be read", async () => {
    for (const table of [
      "customers",
      "bookings",
      "booking_notifications",
      "payments",
      "audit_log",
      "rate_limits",
      "salon_users",
    ]) {
      const { error } = await publicDb().from(table).select("id").limit(1);
      assert.equal(error?.code, DENIED, table);
    }
  });

  test("customers and bookings cannot be written", async () => {
    const customer = await publicDb()
      .from("customers")
      .insert({ salon_id: SALON, first_name: "X", phone: phone(9) });
    assert.equal(customer.error?.code, DENIED);
    const booking = await publicDb().from("bookings").insert({ salon_id: SALON });
    assert.equal(booking.error?.code, DENIED);
  });

  test("staff contact data and absence reasons are not readable", async () => {
    assert.equal((await publicDb().from("staff").select("*").limit(1)).error?.code, DENIED);
    assert.equal((await publicDb().from("staff").select("email").limit(1)).error?.code, DENIED);
    assert.equal((await publicDb().from("staff").select("phone").limit(1)).error?.code, DENIED);
    assert.equal((await publicDb().from("time_off").select("reason").limit(1)).error?.code, DENIED);
    const names = await publicDb().from("staff").select("name").eq("salon_id", SALON);
    assert.equal(names.error, null);
    assert.equal(names.data?.length, 2);
  });

  test("helper functions are not callable through the API", async () => {
    const { error } = await publicDb().rpc("user_salon_ids");
    assert.ok(error, "user_salon_ids must not be callable");
  });
});

describe("lib/data.ts against the live database", () => {
  test("getSalon: finds the test salon, nothing for unknown or malformed slugs", async () => {
    assert.equal((await getSalon("test"))?.id, SALON);
    assert.equal(await getSalon("ta-salon-ne-obstaja"), null);
    assert.equal(await getSalon("Not A Slug"), null);
  });

  test("public getServices and getStaff: active only, no staff contact data", async () => {
    assert.equal((await getServices(SALON)).length, 5);
    const staff = await getStaff(SALON);
    assert.deepEqual(
      staff.map((s) => s.name),
      ["Maja Novak", "Luka Kovač"],
    );
    assert.ok(staff.every((s) => s.email === null && s.phone === null && s.user_id === null));
    assert.deepEqual(
      (await getStaff(SALON, { serviceId: COLORING.id })).map((s) => s.id),
      [MAJA],
    );
  });

  test("admin getStaff (includeInactive) has the contact data", async () => {
    const staff = await getStaff(SALON, { includeInactive: true });
    assert.ok(staff.every((s) => s.email !== null));
  });

  test("getFreeSlots: working days only, inside 9-17, never on a booking", async () => {
    const slots = await getFreeSlots({ salon_id: SALON, service_id: WOMENS_CUT.id, staff_id: null, day: TEST_DAY });
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      const start = formatInTimeZone(slot.starts_at, TZ, "HH:mm");
      const end = formatInTimeZone(slot.ends_at, TZ, "HH:mm");
      assert.ok(start >= "09:00" && end <= "17:00", `${start}-${end}`);
      assert.equal(Date.parse(slot.ends_at) - Date.parse(slot.starts_at), 45 * 60_000);
    }
    const saturday = dayAhead(21, 6);
    assert.deepEqual(await getFreeSlots({ salon_id: SALON, service_id: WOMENS_CUT.id, staff_id: null, day: saturday }), []);
  });

  test("getFreeSlots: nothing in the past, beyond the booking window, or for bad input", async () => {
    const q = { salon_id: SALON, service_id: MENS_CUT.id, staff_id: null };
    assert.deepEqual(await getFreeSlots({ ...q, day: format(addDays(parseISO(today), -7), "yyyy-MM-dd") }), []);
    assert.deepEqual(await getFreeSlots({ ...q, day: dayAhead(70, 2) }), []); // max_days_ahead is 60
    assert.deepEqual(await getFreeSlots({ ...q, day: "2026-02-31" }), []);
    assert.deepEqual(await getFreeSlots({ ...q, service_id: "ni-uuid", day: TEST_DAY }), []);
    assert.deepEqual(await getFreeSlots({ ...q, service_id: COLORING.id, staff_id: LUKA, day: TEST_DAY }), []);
  });

  test("getFreeSlots: a day far in the future gives an empty list, not an error", async () => {
    const q = { salon_id: SALON, service_id: MENS_CUT.id, staff_id: null };
    assert.deepEqual(await getFreeSlots({ ...q, day: "9999-12-31" }), []);
  });

  test("admin-only data refuses to load outside admin access (no npm run dev here)", async () => {
    assert.notEqual(process.env.NODE_ENV, "development");
    await assert.rejects(() => getCustomers(SALON), /No admin access/);
    await assert.rejects(() => getBookings(SALON, new Date(0), new Date()), /No admin access/);
    await assert.rejects(
      () => updateService(SALON, MENS_CUT.id, { name: "X", category: null, duration_min: 30, buffer_after_min: 0, price_cents: 1, is_active: true }),
      /No admin access/,
    );
    // Nothing changed.
    assert.equal((await getServices(SALON)).find((s) => s.id === MENS_CUT.id)?.price_cents, MENS_CUT.price_cents);
  });

  test("getFreeSlots: a seeded booking blocks its time including the buffer", async () => {
    // Seed booking 1: next Monday 10:00, Maja, women's cut (45 + 5 min).
    const monday = f.bookings[0];
    const day = formatInTimeZone(monday.starts_at, TZ, "yyyy-MM-dd");
    const slots = await getFreeSlots({ salon_id: SALON, service_id: MENS_CUT.id, staff_id: MAJA, day });
    const busyFrom = Date.parse(monday.starts_at);
    const busyTo = Date.parse(monday.ends_at) + monday.buffer_min * 60_000;
    for (const slot of slots) {
      const overlaps = Date.parse(slot.starts_at) < busyTo && Date.parse(slot.ends_at) > busyFrom;
      assert.ok(!overlaps, formatInTimeZone(slot.starts_at, TZ, "HH:mm"));
    }
  });
});

describe("createBooking against the live database", () => {
  async function freeStart(serviceId: string, staffId: string, index = 0): Promise<string> {
    const slots = await getFreeSlots({ salon_id: SALON, service_id: serviceId, staff_id: staffId, day: TEST_DAY });
    assert.ok(slots.length > index, "no free slot on the test day");
    return slots[index].starts_at;
  }

  test("books a free slot; price, end and buffer come from the database", async () => {
    const starts_at = await freeStart(WOMENS_CUT.id, MAJA, 0);
    const result = await remember(await createBooking(newBooking({ service_id: WOMENS_CUT.id, starts_at, phone: phone(1) })));
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal(result.booking.price_cents, WOMENS_CUT.price_cents);
    assert.equal(result.booking.buffer_min, WOMENS_CUT.buffer_after_min);
    assert.equal(Date.parse(result.booking.ends_at) - Date.parse(starts_at), 45 * 60_000);
    assert.equal(result.booking.status, "confirmed");
    // The slot is gone now.
    const again = await createBooking(newBooking({ service_id: WOMENS_CUT.id, starts_at, phone: phone(2) }));
    assert.ok(!again.ok && (again.error === BOOKING_MESSAGES.unavailable || again.error === BOOKING_MESSAGES.taken));
  });

  test("specs/slots.md test 11: two simultaneous bookings of one time -> exactly one wins", async () => {
    const starts_at = await freeStart(MENS_CUT.id, LUKA, 3);
    const results = await Promise.all([
      createBooking(newBooking({ staff_id: LUKA, starts_at, phone: phone(3) })),
      createBooking(newBooking({ staff_id: LUKA, starts_at, phone: phone(4) })),
    ]);
    results.forEach((r) => void remember(r));
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => (r.ok ? "ok" : r.error))));
    const loser = results.find((r) => !r.ok);
    assert.ok(loser && !loser.ok && (loser.error === BOOKING_MESSAGES.taken || loser.error === BOOKING_MESSAGES.unavailable));

    const { data } = await adminDb()
      .from("bookings")
      .select("id")
      .eq("staff_id", LUKA)
      .eq("starts_at", starts_at)
      .in("status", ["pending", "confirmed"]);
    assert.equal(data?.length, 1);
  });

  test("the database itself refuses two simultaneous inserts of one time (23P01)", async () => {
    const starts_at = await freeStart(MENS_CUT.id, LUKA, 6);
    const ends_at = new Date(Date.parse(starts_at) + 30 * 60_000).toISOString();
    const customer = await adminDb()
      .from("customers")
      .insert({ salon_id: SALON, first_name: "Test", phone: phone(5) })
      .select("id")
      .single();
    assert.equal(customer.error, null);
    const insert = () =>
      adminDb()
        .from("bookings")
        .insert({ salon_id: SALON, staff_id: LUKA, service_id: MENS_CUT.id, customer_id: customer.data!.id, starts_at, ends_at, price_cents: 1800 })
        .select("id")
        .single();
    const [a, b] = await Promise.all([insert(), insert()]);
    for (const r of [a, b]) if (r.data) createdBookingIds.push(r.data.id);
    assert.equal([a, b].filter((r) => !r.error).length, 1);
    assert.equal([a, b].find((r) => r.error)?.error?.code, "23P01");
  });

  test("an existing customer's data is never changed by the public form", async () => {
    const ana = f.customers[0]; // Ana Horvat, +38640000001
    const starts_at = await freeStart(MENS_CUT.id, MAJA, 10);
    const result = await remember(
      await createBooking(newBooking({ starts_at, phone: ana.phone!, first_name: "Vsiljivec", email: "napad@example.com" })),
    );
    assert.ok(result.ok);
    assert.equal(result.booking.customer_id, ana.id);
    const { data } = await adminDb().from("customers").select("first_name, email").eq("id", ana.id).single();
    assert.deepEqual(data, { first_name: ana.first_name, email: ana.email });
  });

  test("refused: wrong time, wrong phone format, service the staff does not do", async () => {
    const night = fromZonedTime(`${TEST_DAY}T03:00:00`, TZ).toISOString();
    assert.deepEqual(await createBooking(newBooking({ starts_at: night, phone: phone(6) })), {
      ok: false,
      error: BOOKING_MESSAGES.unavailable,
    });
    const starts_at = await freeStart(MENS_CUT.id, MAJA, 12);
    assert.deepEqual(await createBooking(newBooking({ starts_at, phone: "040 999 123" })), {
      ok: false,
      error: BOOKING_MESSAGES.invalid,
    });
    assert.deepEqual(
      await createBooking(newBooking({ service_id: COLORING.id, staff_id: LUKA, starts_at, phone: phone(6) })),
      { ok: false, error: BOOKING_MESSAGES.invalid },
    );
  });

  test("working hours that end at 24:00 (valid in Postgres) still give slots", async () => {
    const db = adminDb();
    const salon = await db.from("salons").insert({ slug: `live-night-${run}`, name: "Nocni salon" }).select("id").single();
    assert.equal(salon.error, null);
    const nightSalon: string = salon.data!.id;
    tempSalonIds.push(nightSalon);
    const service = await db.from("services").insert({ salon_id: nightSalon, name: "Nocna", duration_min: 60 }).select("id").single();
    const member = await db.from("staff").insert({ salon_id: nightSalon, name: "Nocni" }).select("id").single();
    await db.from("staff_services").insert({ salon_id: nightSalon, staff_id: member.data!.id, service_id: service.data!.id });
    const hours = await db
      .from("staff_hours")
      .insert({ salon_id: nightSalon, staff_id: member.data!.id, weekday: getDay(parseISO(TEST_DAY)), start_time: "20:00", end_time: "24:00" });
    assert.equal(hours.error, null);

    const slots = await getFreeSlots({ salon_id: nightSalon, service_id: service.data!.id, staff_id: null, day: TEST_DAY });
    const starts = slots.map((s) => formatInTimeZone(s.starts_at, TZ, "HH:mm"));
    assert.equal(starts[0], "20:00");
    assert.equal(starts.at(-1), "22:45"); // 22:45 + 60 min still ends before 23:59:59
  });

  test("refused: a service or staff member of another salon, and a suspended salon", async () => {
    const db = adminDb();
    const slug = `live-test-${run}`;
    const salon = await db.from("salons").insert({ slug, name: "Live test salon" }).select("id").single();
    assert.equal(salon.error, null);
    const otherSalon: string = salon.data!.id;
    tempSalonIds.push(otherSalon); // for the cleanup in after()
    const service = await db
      .from("services")
      .insert({ salon_id: otherSalon, name: "Tuja storitev", duration_min: 30 })
      .select("id")
      .single();
    const member = await db.from("staff").insert({ salon_id: otherSalon, name: "Tuj zaposleni" }).select("id").single();
    await db.from("staff_services").insert({ salon_id: otherSalon, staff_id: member.data!.id, service_id: service.data!.id });
    for (let weekday = 0; weekday < 7; weekday++) {
      await db.from("staff_hours").insert({ salon_id: otherSalon, staff_id: member.data!.id, weekday, start_time: "08:00", end_time: "20:00" });
    }

    const starts_at = await freeStart(MENS_CUT.id, MAJA, 14);
    // Test salon with the other salon's service, and with the other salon's staff member.
    assert.equal((await createBooking(newBooking({ service_id: service.data!.id, starts_at, phone: phone(7) }))).ok, false);
    assert.equal((await createBooking(newBooking({ staff_id: member.data!.id, starts_at, phone: phone(7) }))).ok, false);

    // The other salon's own slot works while it is on trial ...
    const own = await getFreeSlots({ salon_id: otherSalon, service_id: service.data!.id, staff_id: null, day: TEST_DAY });
    assert.ok(own.length > 0);
    // ... and gives nothing once it is suspended.
    await db.from("salons").update({ subscription_status: "suspended" }).eq("id", otherSalon);
    const suspended = await createBooking(
      newBooking({ salon_id: otherSalon, service_id: service.data!.id, staff_id: member.data!.id, starts_at: own[0].starts_at, phone: phone(8) }),
    );
    assert.deepEqual(suspended, { ok: false, error: BOOKING_MESSAGES.invalid });
    assert.deepEqual(
      await getFreeSlots({ salon_id: otherSalon, service_id: service.data!.id, staff_id: null, day: TEST_DAY }),
      [],
    );
  });
});
