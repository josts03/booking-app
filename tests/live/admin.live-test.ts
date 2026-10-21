/**
 * Week 8 against the REAL Supabase project (npm run test:live): the salon's
 * own changes to bookings. A temporary user is a member of the test salon
 * (runAsSignedInUser stands in for the session cookie; membership is checked
 * for real). Everything created is removed at the end: bookings, test
 * customers with phones +38640998xxx, their audit_log rows, the users and a
 * temporary second salon.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { addDays, format, getDay, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { runAsSignedInUser, type SignedInUser } from "../../lib/auth";
import {
  ADMIN_BOOKING_MESSAGES as MSG,
  changeBookingStatus,
  createManualBooking,
  rescheduleBooking,
} from "../../lib/data";
import { FIXTURE_SALON_ID, FIXTURE_TIMEZONE, buildFixtures } from "../../lib/fixtures";
import { adminDb } from "../../lib/supabase/admin";
import type { AdminBookingResult, Booking, ManualBookingInput } from "../../lib/types";

const TZ = FIXTURE_TIMEZONE;
const SALON = FIXTURE_SALON_ID;
const f = buildFixtures(new Date());
const MAJA = f.staff[0].id;
const LUKA = f.staff[1].id;
const MENS_CUT = f.services[0]; // 30 min, no buffer
const WOMENS_CUT = f.services[1]; // 45 min + 5 min buffer
const COLORING = f.services[3]; // Luka does not do coloring

const run = randomUUID().slice(0, 8);
const PHONE_PREFIX = "+38640998";
const phoneRun = String(Math.floor(Math.random() * 900 + 100));
const phone = (n: number) => `${PHONE_PREFIX}${phoneRun}${n}`; // 13 characters, E.164

const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
/** A local date `days` from today (negative: in the past), moved forward to the weekday (0 = Sunday). */
function weekdayFrom(days: number, weekday: number): string {
  let date = addDays(parseISO(today), days);
  while (getDay(date) !== weekday) date = addDays(date, 1);
  return format(date, "yyyy-MM-dd");
}
const DAY = weekdayFrom(23, 4); // a Thursday about three weeks ahead (other live tests use Tue and Wed)
const PAST_DAY = weekdayFrom(-13, 4); // a Thursday one to two weeks ago
const at = (day: string, hhmm: string) => fromZonedTime(`${day}T${hhmm}:00`, TZ).toISOString();

let member: SignedInUser;
let stranger: SignedInUser; // signed in, but member of another salon only
const userIds: string[] = [];
let otherSalon = "";
let otherService = "";
const bookingIds: string[] = [];

function manual(overrides: Partial<ManualBookingInput> & { starts_at: string }): ManualBookingInput {
  return {
    service_id: MENS_CUT.id,
    staff_id: MAJA,
    customer: { first_name: "Test", last_name: "Admin", phone: phone(1), email: "admin-test@example.com" },
    customer_note: null,
    internal_note: "admin-live-test",
    ...overrides,
  };
}

const asMember = <T>(fn: () => Promise<T>) => runAsSignedInUser(member, fn);

async function made(result: AdminBookingResult): Promise<Booking> {
  assert.ok(result.ok, result.ok ? "" : result.error);
  bookingIds.push(result.booking.id);
  return result.booking;
}

async function tempUser(): Promise<SignedInUser> {
  const email = `live-test+admin-${run}-${userIds.length}@example.com`;
  const { data, error } = await adminDb().auth.admin.createUser({
    email,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
  });
  assert.equal(error, null);
  userIds.push(data.user!.id);
  return { id: data.user!.id, email };
}

before(async () => {
  assert.ok(process.env.SUPABASE_SECRET_KEY, "Run with npm run test:live (needs .env.local)");
  assert.equal(process.env.NODE_ENV, "test", "npm run test:live sets NODE_ENV=test");
  const db = adminDb();
  member = await tempUser();
  stranger = await tempUser();
  assert.equal((await db.from("salon_users").insert({ salon_id: SALON, user_id: member.id, role: "staff" })).error, null);

  const salon = await db.from("salons").insert({ slug: `live-admin-${run}`, name: "Live admin salon" }).select("id").single();
  assert.equal(salon.error, null);
  otherSalon = salon.data!.id;
  const service = await db.from("services").insert({ salon_id: otherSalon, name: "Tuja", duration_min: 30 }).select("id").single();
  otherService = service.data!.id;
  await db.from("salon_users").insert({ salon_id: otherSalon, user_id: stranger.id, role: "owner" });
});

after(async () => {
  const db = adminDb();
  const { data: customers } = await db.from("customers").select("id").eq("salon_id", SALON).like("phone", `${PHONE_PREFIX}%`);
  const customerIds = (customers ?? []).map((c) => c.id);
  const { data: bookings } = customerIds.length
    ? await db.from("bookings").select("id").in("customer_id", customerIds)
    : { data: [] };
  const ids = [...new Set([...bookingIds, ...(bookings ?? []).map((b) => b.id)])];
  if (ids.length) {
    await db.from("audit_log").delete().in("entity_id", ids);
    const { error } = await db.from("bookings").delete().in("id", ids);
    if (error) console.error("cleanup bookings:", error.message);
  }
  if (customerIds.length) await db.from("customers").delete().in("id", customerIds);
  if (otherSalon) await db.from("salons").delete().eq("id", otherSalon);
  for (const id of userIds) await db.auth.admin.deleteUser(id);
});

describe("who may change bookings", () => {
  test("nobody without a session, and nobody from another salon", async () => {
    const input = manual({ starts_at: at(DAY, "09:00") });
    await assert.rejects(() => createManualBooking(SALON, input, { allowOutsideHours: false }), /No admin access/);
    await assert.rejects(
      () => runAsSignedInUser(stranger, () => createManualBooking(SALON, input, { allowOutsideHours: false })),
      /No admin access/,
    );
    await assert.rejects(
      () => runAsSignedInUser(stranger, () => changeBookingStatus(SALON, f.bookings[0].id, "cancelled")),
      /No admin access/,
    );
  });
});

describe("a booking entered by hand", () => {
  test("may be in the past; price, end, buffer and status come from the database", async () => {
    // 07:00 is before opening, so it needs the confirmation (and no seed booking is there).
    const booking = await made(
      await asMember(() =>
        createManualBooking(SALON, manual({ starts_at: at(PAST_DAY, "07:00") }), { allowOutsideHours: true }),
      ),
    );
    assert.equal(booking.source, "admin");
    assert.equal(booking.status, "confirmed");
    assert.equal(booking.price_cents, MENS_CUT.price_cents);
    assert.equal(booking.buffer_min, 0);
    assert.equal(Date.parse(booking.ends_at) - Date.parse(booking.starts_at), 30 * 60_000);
    assert.equal(booking.contact_email, "admin-test@example.com");
    assert.equal(booking.internal_note, "admin-live-test");
  });

  test("outside working hours it asks first; after the confirmation it is saved", async () => {
    const input = manual({ starts_at: at(DAY, "07:30"), customer: { first_name: "Zgodnja", last_name: null, phone: phone(2), email: null } });
    const asked = await asMember(() => createManualBooking(SALON, input, { allowOutsideHours: false }));
    assert.deepEqual(asked, { ok: false, error: "Maja Novak: ob tem času ni delovni čas.", outsideHours: true });
    const saved = await made(await asMember(() => createManualBooking(SALON, input, { allowOutsideHours: true })));
    assert.equal(saved.contact_email, null); // no e-mail given: messages would use the customer's
  });

  test("an overlap is never skipped, and the message names the booking in the way", async () => {
    const first = await made(await asMember(() => createManualBooking(SALON, manual({ starts_at: at(DAY, "10:00") }), { allowOutsideHours: false })));
    assert.ok(first);
    const second = await asMember(() =>
      createManualBooking(SALON, manual({ starts_at: at(DAY, "10:15"), customer: { first_name: "Druga", last_name: null, phone: phone(3), email: null } }), {
        allowOutsideHours: true,
      }),
    );
    assert.deepEqual(second, {
      ok: false,
      error: "Maja Novak ima ob tem času že termin (10:00–10:30). Izberite drugo uro ali drugega zaposlenega.",
    });
    // The customer created for the refused booking was not left behind.
    const left = await adminDb().from("customers").select("id").eq("salon_id", SALON).eq("phone", phone(3));
    assert.deepEqual(left.data, []);
  });

  test("refused: another salon's service or customer, a service the staff member does not do, a bad phone", async () => {
    const otherCustomer = await adminDb()
      .from("customers")
      .insert({ salon_id: otherSalon, first_name: "Tuja", phone: phone(9) })
      .select("id")
      .single();
    const tries: [Partial<ManualBookingInput>, string][] = [
      [{ service_id: otherService }, MSG.invalid],
      [{ staff_id: LUKA, service_id: COLORING.id }, MSG.staffService],
      [{ customer: { id: otherCustomer.data!.id } }, MSG.invalid],
      [{ customer: { first_name: "X", last_name: null, phone: "040 123 456", email: null } }, MSG.invalid],
    ];
    for (const [overrides, error] of tries) {
      const result = await asMember(() =>
        createManualBooking(SALON, manual({ starts_at: at(DAY, "14:00"), ...overrides }), { allowOutsideHours: true }),
      );
      assert.deepEqual(result, { ok: false, error }, JSON.stringify(overrides));
    }
  });

  test("a known phone number books for that customer and does not change the customer", async () => {
    const one = await made(
      await asMember(() =>
        createManualBooking(SALON, manual({ starts_at: at(DAY, "11:00"), customer: { first_name: "Prvi", last_name: null, phone: phone(4), email: null } }), {
          allowOutsideHours: false,
        }),
      ),
    );
    const two = await made(
      await asMember(() =>
        createManualBooking(SALON, manual({ starts_at: at(DAY, "11:30"), customer: { first_name: "Drugi", last_name: null, phone: phone(4), email: null } }), {
          allowOutsideHours: false,
        }),
      ),
    );
    assert.equal(one.customer_id, two.customer_id);
    const customer = await adminDb().from("customers").select("first_name").eq("id", one.customer_id).single();
    assert.equal(customer.data?.first_name, "Prvi");
  });
});

describe("status changes", () => {
  test("before the start: no 'completed' or 'no-show'; cancelled is final", async () => {
    const booking = await made(await asMember(() => createManualBooking(SALON, manual({ starts_at: at(DAY, "12:00"), customer: { first_name: "S", last_name: null, phone: phone(5), email: null } }), { allowOutsideHours: false })));
    for (const to of ["completed", "no_show"] as const) {
      assert.deepEqual(await asMember(() => changeBookingStatus(SALON, booking.id, to)), { ok: false, error: MSG.notAllowed }, to);
    }
    const cancelled = await asMember(() => changeBookingStatus(SALON, booking.id, "cancelled"));
    assert.ok(cancelled.ok && cancelled.booking.status === "cancelled");
    assert.deepEqual(await asMember(() => changeBookingStatus(SALON, booking.id, "confirmed")), { ok: false, error: MSG.notAllowed });
    const audit = await adminDb().from("audit_log").select("action, actor_user_id, payload").eq("entity_id", booking.id).eq("action", "booking.status");
    assert.deepEqual(audit.data, [{ action: "booking.status", actor_user_id: member.id, payload: { from: "confirmed", to: "cancelled" } }]);
  });

  test("after the start: no-show, back to confirmed, completed; a pending booking can be confirmed", async () => {
    const booking = await made(
      await asMember(() =>
        createManualBooking(SALON, manual({ staff_id: LUKA, starts_at: at(PAST_DAY, "07:00"), customer: { first_name: "P", last_name: null, phone: phone(6), email: null } }), {
          allowOutsideHours: true,
        }),
      ),
    );
    for (const to of ["no_show", "confirmed", "completed"] as const) {
      const result = await asMember(() => changeBookingStatus(SALON, booking.id, to));
      assert.ok(result.ok && result.booking.status === to, to);
    }
    await adminDb().from("bookings").update({ status: "pending" }).eq("id", booking.id);
    const confirmed = await asMember(() => changeBookingStatus(SALON, booking.id, "confirmed"));
    assert.ok(confirmed.ok && confirmed.booking.status === "confirmed");
  });

  test("two phones at once: exactly one change wins", async () => {
    const booking = await made(
      await asMember(() =>
        createManualBooking(SALON, manual({ staff_id: LUKA, starts_at: at(PAST_DAY, "07:45"), customer: { first_name: "D", last_name: null, phone: phone(7), email: null } }), {
          allowOutsideHours: true,
        }),
      ),
    );
    const results = await asMember(() =>
      Promise.all([changeBookingStatus(SALON, booking.id, "completed"), changeBookingStatus(SALON, booking.id, "no_show")]),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.some((r) => !r.ok && (r.error === MSG.changed || r.error === MSG.notAllowed)));
  });

  test("back to confirmed is refused if the time was given away meanwhile", async () => {
    const missed = await made(
      await asMember(() =>
        createManualBooking(SALON, manual({ starts_at: at(PAST_DAY, "06:00"), customer: { first_name: "M", last_name: null, phone: phone(8), email: null } }), {
          allowOutsideHours: true,
        }),
      ),
    );
    assert.ok((await asMember(() => changeBookingStatus(SALON, missed.id, "no_show"))).ok);
    // A no-show does not block its time, so the salon can give it to someone else ...
    await made(await asMember(() => createManualBooking(SALON, manual({ starts_at: at(PAST_DAY, "06:00") }), { allowOutsideHours: true })));
    // ... and then the no-show cannot come back.
    assert.deepEqual(await asMember(() => changeBookingStatus(SALON, missed.id, "confirmed")), {
      ok: false,
      error: "Maja Novak ima ob tem času že termin (06:00–06:30). Izberite drugo uro ali drugega zaposlenega.",
    });
  });
});

describe("moving a booking", () => {
  test("to a free time and another staff member; duration, buffer and price stay; the old reminder is forgotten", async () => {
    const booking = await made(
      await asMember(() =>
        createManualBooking(SALON, manual({ service_id: WOMENS_CUT.id, starts_at: at(DAY, "13:00"), customer: { first_name: "Pre", last_name: null, phone: phone(0), email: null } }), {
          allowOutsideHours: false,
        }),
      ),
    );
    await adminDb().from("booking_notifications").insert({ salon_id: SALON, booking_id: booking.id, kind: "reminder", status: "sent" });

    const moved = await asMember(() => rescheduleBooking(SALON, booking.id, { starts_at: at(DAY, "15:00"), staff_id: LUKA }, { allowOutsideHours: false }));
    assert.ok(moved.ok, moved.ok ? "" : moved.error);
    assert.equal(moved.booking.staff_id, LUKA);
    assert.equal(moved.booking.starts_at.slice(0, 16), new Date(at(DAY, "15:00")).toISOString().slice(0, 16));
    assert.equal(Date.parse(moved.booking.ends_at) - Date.parse(moved.booking.starts_at), 45 * 60_000);
    assert.equal(moved.booking.buffer_min, 5);
    assert.equal(moved.booking.price_cents, booking.price_cents);
    const reminders = await adminDb().from("booking_notifications").select("id").eq("booking_id", booking.id).eq("kind", "reminder");
    assert.deepEqual(reminders.data, []);
    const audit = await adminDb().from("audit_log").select("action").eq("entity_id", booking.id).eq("action", "booking.move");
    assert.equal(audit.data?.length, 1);

    // Onto its own old time is fine (it does not collide with itself); onto another booking is not.
    const back = await asMember(() => rescheduleBooking(SALON, booking.id, { starts_at: at(DAY, "15:15"), staff_id: LUKA }, { allowOutsideHours: false }));
    assert.ok(back.ok, back.ok ? "" : back.error);
  });

  test("refused: onto another booking, to a staff member without the service, the same place, a cancelled booking", async () => {
    const a = await made(await asMember(() => createManualBooking(SALON, manual({ starts_at: at(DAY, "09:00"), customer: { first_name: "A", last_name: null, phone: phone(1), email: null } }), { allowOutsideHours: false })));
    const b = await made(
      await asMember(() =>
        createManualBooking(SALON, manual({ service_id: COLORING.id, starts_at: at(DAY, "14:30"), customer: { first_name: "B", last_name: null, phone: phone(2), email: null } }), {
          allowOutsideHours: false,
        }),
      ),
    );
    assert.deepEqual(await asMember(() => rescheduleBooking(SALON, b.id, { starts_at: at(DAY, "09:00"), staff_id: MAJA }, { allowOutsideHours: false })), {
      ok: false,
      error: "Maja Novak ima ob tem času že termin (09:00–09:30). Izberite drugo uro ali drugega zaposlenega.",
    });
    assert.deepEqual(await asMember(() => rescheduleBooking(SALON, b.id, { starts_at: at(DAY, "16:00"), staff_id: LUKA }, { allowOutsideHours: false })), {
      ok: false,
      error: MSG.staffService,
    });
    assert.deepEqual(await asMember(() => rescheduleBooking(SALON, a.id, { starts_at: a.starts_at, staff_id: MAJA }, { allowOutsideHours: false })), {
      ok: false,
      error: MSG.sameTime,
    });
    const outside = await asMember(() => rescheduleBooking(SALON, a.id, { starts_at: at(DAY, "18:00"), staff_id: MAJA }, { allowOutsideHours: false }));
    assert.deepEqual(outside, { ok: false, error: "Maja Novak: ob tem času ni delovni čas.", outsideHours: true });

    assert.ok((await asMember(() => changeBookingStatus(SALON, a.id, "cancelled"))).ok);
    assert.deepEqual(await asMember(() => rescheduleBooking(SALON, a.id, { starts_at: at(DAY, "16:30"), staff_id: MAJA }, { allowOutsideHours: false })), {
      ok: false,
      error: MSG.notAllowed,
    });
  });
});
