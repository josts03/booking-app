/**
 * Week 9 against a real Supabase project, the separate test one in .env.test (npm run test:live): what the salon
 * owner changes (staff, working hours, absences, who performs a service,
 * settings) and that the booking page follows at once. Everything runs in a
 * temporary salon of its own, so the test salon's hours and settings are never
 * touched; it is deleted at the end (with all its rows), and so are the users.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { addDays, format, getDay, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { runAsSignedInUser, type SignedInUser } from "../../lib/auth";
import {
  addTimeOff,
  createService,
  createStaff,
  deleteTimeOff,
  getFreeSlots,
  getStaff,
  MANAGE_MESSAGES,
  setServiceStaff,
  setStaffHours,
  updateSalonSettings,
  updateStaff,
} from "../../lib/data";
import { checkWeek } from "../../lib/schedule";
import { adminDb } from "../../lib/supabase/admin";
import type { Salon, SalonSettingsInput } from "../../lib/types";

const TZ = "Europe/Ljubljana";
const run = randomUUID().slice(0, 8);
const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
function weekdayFrom(days: number, weekday: number): string {
  let date = addDays(parseISO(today), days);
  while (getDay(date) !== weekday) date = addDays(date, 1);
  return format(date, "yyyy-MM-dd");
}
const DAY = weekdayFrom(14, 3); // a Wednesday about two weeks ahead
const at = (hhmm: string) => fromZonedTime(`${DAY}T${hhmm}:00`, TZ).toISOString();
const times = async (staffId: string | null = null, serviceId = service) =>
  (await getFreeSlots({ salon_id: salon, service_id: serviceId, staff_id: staffId, day: DAY })).map((s) =>
    formatInTimeZone(s.starts_at, TZ, "HH:mm"),
  );

let salon = "";
let service = "";
let maja = ""; // works Mon-Fri 9-17, performs the service
let owner: SignedInUser;
let helper: SignedInUser; // a staff member's account: may manage bookings, not this
const userIds: string[] = [];
const asOwner = <T>(fn: () => Promise<T>) => runAsSignedInUser(owner, fn);

async function tempUser(role: "owner" | "staff"): Promise<SignedInUser> {
  const email = `live-test+manage-${run}-${role}@example.com`;
  const { data, error } = await adminDb().auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
  assert.equal(error, null);
  userIds.push(data.user!.id);
  assert.equal((await adminDb().from("salon_users").insert({ salon_id: salon, user_id: data.user!.id, role })).error, null);
  return { id: data.user!.id, email };
}

/** A confirmed booking straight into the database (the time is the test's choice). */
async function booking(hhmm: string, minutes = 30, staffId = maja): Promise<string> {
  const db = adminDb();
  const phone = `+38640997${String(Math.floor(Math.random() * 9000 + 1000))}`;
  const customer = await db.from("customers").insert({ salon_id: salon, first_name: "Ana", last_name: `Test ${hhmm}`, phone }).select("id").single();
  assert.equal(customer.error, null);
  const start = new Date(at(hhmm));
  const row = await db
    .from("bookings")
    .insert({ salon_id: salon, staff_id: staffId, service_id: service, customer_id: customer.data!.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(), price_cents: 1000 })
    .select("id")
    .single();
  assert.equal(row.error, null);
  return row.data!.id;
}

before(async () => {
  assert.equal(process.env.NODE_ENV, "test", "npm run test:live sets NODE_ENV=test");
  const db = adminDb();
  const s = await db.from("salons").insert({ slug: `live-manage-${run}`, name: "Live manage salon" }).select("id").single();
  assert.equal(s.error, null);
  salon = s.data!.id;
  const svc = await db.from("services").insert({ salon_id: salon, name: "Striženje", duration_min: 30 }).select("id").single();
  service = svc.data!.id;
  const m = await db.from("staff").insert({ salon_id: salon, name: "Maja", color: "#6366f1", sort_order: 1 }).select("id").single();
  maja = m.data!.id;
  await db.from("staff_services").insert({ salon_id: salon, staff_id: maja, service_id: service });
  for (const weekday of [1, 2, 3, 4, 5]) {
    await db.from("staff_hours").insert({ salon_id: salon, staff_id: maja, weekday, start_time: "09:00", end_time: "17:00" });
  }
  owner = await tempUser("owner");
  helper = await tempUser("staff");
});

after(async () => {
  const db = adminDb();
  if (salon) {
    const { error } = await db.from("salons").delete().eq("id", salon); // cascades to every row of the salon
    if (error) console.error("cleanup salon:", error.message);
  }
  for (const id of userIds) await db.auth.admin.deleteUser(id);
});

describe("only the salon's owner", () => {
  test("a staff member's account, or no session, cannot change staff, hours, services or settings", async () => {
    const asHelper = <T>(fn: () => Promise<T>) => runAsSignedInUser(helper, fn);
    await assert.rejects(() => asHelper(() => setStaffHours(salon, maja, [])), /No owner access/);
    await assert.rejects(() => asHelper(() => createStaff(salon, { name: "X", color: "#111111" })), /No owner access/);
    await assert.rejects(
      () => asHelper(() => createService(salon, { name: "X", category: null, duration_min: 30, buffer_after_min: 0, price_cents: 0, is_active: true })),
      /No owner access/,
    );
    await assert.rejects(() => setServiceStaff(salon, service, []), /No owner access/);
    // Nothing changed.
    assert.equal((await times(maja))[0], "09:00");
  });
});

describe("working hours and absences", () => {
  test("a new week takes effect at once and lists the bookings that no longer fit", async () => {
    const early = await booking("10:00");
    const week = checkWeek({ 3: [{ start: "12:00", end: "14:00" }] });
    assert.ok(week.ok);
    const result = await asOwner(() => setStaffHours(salon, maja, week.rows));
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.deepEqual(result.affected.map((b) => [b.id, b.customer_name]), [[early, "Ana Test 10:00"]]);
    assert.deepEqual(await times(maja), ["12:00", "12:15", "12:30", "12:45", "13:00", "13:15", "13:30"]);
    // The booking itself was not touched.
    const kept = await adminDb().from("bookings").select("status").eq("id", early).single();
    assert.equal(kept.data?.status, "confirmed");
    await adminDb().from("bookings").update({ status: "cancelled" }).eq("id", early);
  });

  test("a bad week is refused by the database as a whole: the old week stays", async () => {
    const result = await asOwner(() =>
      setStaffHours(salon, maja, [
        { weekday: 3, start_time: "08:00:00", end_time: "10:00:00" },
        { weekday: 4, start_time: "17:00:00", end_time: "09:00:00" },
      ]),
    );
    assert.deepEqual(result, { ok: false, error: MANAGE_MESSAGES.invalid });
    assert.equal((await times(maja))[0], "12:00");
  });

  test("an absence takes effect at once, names the bookings it covers; deleting it frees the time", async () => {
    const covered = await booking("13:00");
    const added = await asOwner(() =>
      addTimeOff(salon, { staff_id: maja, starts_at: at("12:30"), ends_at: at("13:30"), reason: "Zdravnik" }),
    );
    assert.ok(added.ok, added.ok ? "" : added.error);
    assert.deepEqual(added.affected.map((b) => b.id), [covered]);
    assert.deepEqual(await times(maja), ["12:00", "13:30"]);

    const removed = await asOwner(() => deleteTimeOff(salon, added.value.id));
    assert.ok(removed.ok);
    assert.deepEqual(await times(maja), ["12:00", "12:15", "12:30", "13:30"]);

    // The whole salon closed: everyone's day is gone.
    const closed = await asOwner(() => addTimeOff(salon, { staff_id: null, starts_at: at("00:00"), ends_at: at("23:59"), reason: "Praznik" }));
    assert.ok(closed.ok);
    assert.deepEqual(await times(), []);
    assert.ok((await asOwner(() => deleteTimeOff(salon, closed.value.id))).ok);
    assert.deepEqual(await asOwner(() => deleteTimeOff(salon, closed.value.id)), { ok: false, error: MANAGE_MESSAGES.notFound });
  });
});

describe("staff members", () => {
  test("a new staff member: active, last in the list; inactive only without future bookings", async () => {
    const made = await asOwner(() => createStaff(salon, { name: "Luka", color: "#f59e0b" }));
    assert.ok(made.ok, made.ok ? "" : made.error);
    assert.equal(made.value.is_active, true);
    assert.equal(made.value.sort_order, 2);
    const luka = made.value.id;

    const off = await asOwner(() => updateStaff(salon, luka, { name: "Luka K.", color: "#f59e0b", email: "luka@example.com", phone: null, is_active: false }));
    assert.ok(off.ok && !off.value.is_active && off.value.name === "Luka K.");

    // Maja still has the 13:00 booking from above.
    const refused = await asOwner(() => updateStaff(salon, maja, { name: "Maja", color: "#6366f1", email: null, phone: null, is_active: false }));
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.error, /^Število prihodnjih terminov tega zaposlenega: 1\./);

    assert.deepEqual(await asOwner(() => updateStaff(salon, maja, { name: "", color: "#6366f1", email: null, phone: null, is_active: true })), {
      ok: false,
      error: MANAGE_MESSAGES.invalid,
    });
  });

  test("who performs a service decides who can be booked for it", async () => {
    const luka = (await asOwner(() => createStaff(salon, { name: "Nina", color: "#10b981" })));
    assert.ok(luka.ok);
    const nina = luka.value.id;
    await adminDb().from("staff_hours").insert({ salon_id: salon, staff_id: nina, weekday: 3, start_time: "09:00", end_time: "10:00" });

    assert.ok((await asOwner(() => setServiceStaff(salon, service, [maja, nina]))).ok);
    assert.deepEqual((await getStaff(salon, { serviceId: service })).map((s) => s.name).sort(), ["Maja", "Nina"]);
    assert.equal((await times(nina))[0], "09:00");

    assert.ok((await asOwner(() => setServiceStaff(salon, service, [nina]))).ok);
    assert.deepEqual((await getStaff(salon, { serviceId: service })).map((s) => s.name), ["Nina"]);
    assert.deepEqual(await times(maja), []);

    // Another salon's staff member is refused, and nothing changes.
    const other = await adminDb().from("staff").select("id").neq("salon_id", salon).limit(1).single();
    assert.deepEqual(await asOwner(() => setServiceStaff(salon, service, [maja, other.data!.id])), {
      ok: false,
      error: MANAGE_MESSAGES.staffNotFound,
    });
    assert.deepEqual((await getStaff(salon, { serviceId: service })).map((s) => s.name), ["Nina"]);
    assert.ok((await asOwner(() => setServiceStaff(salon, service, [maja]))).ok);
  });
});

describe("salon settings", () => {
  test("saved, checked, and the booking page follows at once", async () => {
    const current = (await adminDb().from("salons").select("*").eq("id", salon).single<Salon>()).data!;
    const settings: SalonSettingsInput = {
      name: "Live manage salon",
      phone: "01 111 22 33",
      email: "salon-live@example.com",
      address: "Testna ulica 1",
      brand_color: "#0f766e",
      slot_interval_min: current.slot_interval_min,
      min_lead_time_min: current.min_lead_time_min,
      max_days_ahead: 5, // DAY is about two weeks away: no slots any more
      cancel_window_hours: 12,
      require_confirmation: false,
      reminder_hours_before: 24,
      confirmation_note: "Parkirate lahko za hišo.",
    };
    const saved = await asOwner(() => updateSalonSettings(salon, settings));
    assert.ok(saved.ok, saved.ok ? "" : saved.error);
    assert.equal(saved.value.confirmation_note, "Parkirate lahko za hišo.");
    assert.equal(saved.value.slug, current.slug); // never changed from here
    assert.equal(saved.value.subscription_status, current.subscription_status);
    assert.deepEqual(await times(maja), []);

    assert.ok((await asOwner(() => updateSalonSettings(salon, { ...settings, max_days_ahead: 60, slot_interval_min: 30 }))).ok);
    assert.deepEqual(await times(maja), ["12:00", "12:30", "13:30"]);

    for (const bad of [{ slot_interval_min: 0 }, { brand_color: "red" }, { name: " " }, { confirmation_note: "x".repeat(501) }, { max_days_ahead: 400 }]) {
      assert.deepEqual(await asOwner(() => updateSalonSettings(salon, { ...settings, ...bad })), { ok: false, error: MANAGE_MESSAGES.invalid }, JSON.stringify(bad).slice(0, 40));
    }

    const audit = await adminDb().from("audit_log").select("action").eq("salon_id", salon);
    const actions = new Set((audit.data ?? []).map((r) => r.action));
    for (const action of ["staff.hours", "time_off.create", "time_off.delete", "staff.create", "staff.update", "service.staff", "salon.settings"]) {
      assert.ok(actions.has(action), action);
    }
  });
});
