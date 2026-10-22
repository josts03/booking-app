/**
 * Week 11 against the REAL Supabase project (npm run test:live): the hourly job
 * (reminders, three-year retention, rate-limit cleanup), the rate-limit
 * counters, and the job's secret. Temporary salons of its own, deleted at the
 * end. No e-mail is sent: reminders go through a fake sender, and the job route
 * is only called without a valid secret.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addDays, addMinutes, subYears } from "date-fns";
import { GET as cronJob } from "../../app/api/cron/reminders/route";
import {
  ANONYMIZED_NAME,
  anonymizeInactiveCustomers,
  countRateLimitHits,
  deleteOldRateLimitHits,
  getDueReminders,
  noteRateLimitHit,
  rateLimitReached,
  recordRateLimitHit,
} from "../../lib/data";
import { sendReminder, type NotifyDeps } from "../../lib/notifications";
import { RATE_LIMITS, rateLimitBucket } from "../../lib/rate-limit";
import { adminDb } from "../../lib/supabase/admin";
import type { Booking } from "../../lib/types";

const run = randomUUID().slice(0, 8);
const env = process.env as Record<string, string | undefined>;
const now = new Date();
const salonIds: string[] = [];

interface TempSalon {
  id: string;
  staff: string;
  service: string;
  customer: string;
}

async function tempSalon(name: string, extra: Record<string, unknown> = {}): Promise<TempSalon> {
  const db = adminDb();
  const s = await db.from("salons").insert({ slug: `live-jobs-${name}-${run}`, name: `Live jobs ${name}`, ...extra }).select("id").single();
  assert.equal(s.error, null);
  salonIds.push(s.data!.id);
  const staff = (await db.from("staff").insert({ salon_id: s.data!.id, name: "Maja" }).select("id").single()).data!.id;
  const service = (await db.from("services").insert({ salon_id: s.data!.id, name: "Masaža", duration_min: 10 }).select("id").single()).data!.id;
  const customer = (await db.from("customers").insert({ salon_id: s.data!.id, first_name: "Ana", email: `ana-${run}@example.com` }).select("id").single()).data!.id;
  return { id: s.data!.id, staff, service, customer };
}

async function booking(salon: TempSalon, start: Date, status: Booking["status"] = "confirmed", customer = salon.customer): Promise<string> {
  const { data, error } = await adminDb()
    .from("bookings")
    .insert({
      salon_id: salon.id,
      staff_id: salon.staff,
      service_id: salon.service,
      customer_id: customer,
      starts_at: start.toISOString(),
      ends_at: addMinutes(start, 10).toISOString(),
      status,
      contact_email: `ana-${run}@example.com`,
    })
    .select("id")
    .single();
  assert.equal(error, null, error?.message);
  return data!.id;
}

before(() => {
  assert.equal(process.env.NODE_ENV, "test", "npm run test:live sets NODE_ENV=test");
});

after(async () => {
  const db = adminDb();
  for (const id of salonIds) {
    const { error } = await db.from("salons").delete().eq("id", id); // cascades to every row of the salon
    if (error) console.error("cleanup salon:", error.message);
  }
});

describe("reminders", () => {
  test("due: confirmed, around the salon's reminder hours, open salon, no reminder yet", async () => {
    const salon = await tempSalon("main"); // reminder_hours_before = 24 (default)
    const off = await tempSalon("off", { reminder_hours_before: 0 });
    const closed = await tempSalon("closed", { subscription_status: "suspended" });
    const hours = (h: number) => addMinutes(now, h * 60);

    const due = await booking(salon, hours(24));
    const pending = await booking(salon, hours(24.4), "pending");
    const later = await booking(salon, hours(30));
    const early = await booking(salon, hours(22.5));
    const done = await booking(salon, hours(23.6));
    await adminDb().from("booking_notifications").insert({ salon_id: salon.id, booking_id: done, kind: "reminder", status: "sent" });
    const noReminders = await booking(off, hours(24));
    const suspended = await booking(closed, hours(24));

    const ids = await getDueReminders(now, 10_000);
    assert.ok(ids.includes(due), "the confirmed booking in 24 h is due");
    for (const [label, id] of Object.entries({ pending, later, early, done, noReminders, suspended })) {
      assert.ok(!ids.includes(id), `${label} is not due`);
    }
  });

  test("sent once: the second run finds the row and sends nothing", async () => {
    const salon = await tempSalon("send");
    const id = await booking(salon, addMinutes(now, 24 * 60));
    const sent: string[] = [];
    const deps: NotifyDeps = {
      send: async (message) => {
        sent.push(message.subject);
        return { ok: true, id: `fake-${run}` };
      },
      now: () => now,
    };
    const saved = { RESEND_API_KEY: env.RESEND_API_KEY, EMAIL_FROM: env.EMAIL_FROM };
    env.RESEND_API_KEY = "re_fake_for_tests";
    env.EMAIL_FROM = "Termin <obvestila@example.com>";
    try {
      assert.equal(await sendReminder(id, deps), "sent");
      assert.equal(await sendReminder(id, deps), "skipped");
    } finally {
      Object.assign(env, saved);
    }
    assert.equal(sent.length, 1);
    assert.match(sent[0], /^Opomnik: /);
    const rows = await adminDb().from("booking_notifications").select("kind, status, provider_id").eq("booking_id", id);
    assert.deepEqual(rows.data, [{ kind: "reminder", status: "sent", provider_id: `fake-${run}` }]);
    assert.ok(!(await getDueReminders(now, 10_000)).includes(id));
  });
});

describe("retention: three years without a booking", () => {
  test("anonymizes only customers with no booking from three years ago on; bookings stay", async () => {
    const salon = await tempSalon("retention");
    const db = adminDb();
    const old = subYears(now, 4).toISOString();
    const customer = async (name: string, createdAt = old) =>
      (await db.from("customers").insert({ salon_id: salon.id, first_name: name, email: `${name}-${run}@example.com`, created_at: createdAt }).select("id").single()).data!.id;

    const gone = await customer("Stara");
    const oldBooking = await booking(salon, subYears(now, 4), "completed", gone);
    const noBookings = await customer("Brez");
    const recent = await customer("Nedavna");
    await booking(salon, subYears(now, 2), "completed", recent);
    const coming = await customer("Prihaja");
    await booking(salon, addDays(now, 10), "confirmed", coming);
    const young = await customer("Mlada", subYears(now, 1).toISOString());

    const count = await anonymizeInactiveCustomers(now, 10_000);
    assert.ok(count >= 2);

    const rows = await db.from("customers").select("id, first_name, last_name, email, anonymized_at").eq("salon_id", salon.id);
    const byId = new Map(rows.data!.map((r) => [r.id, r]));
    for (const id of [gone, noBookings]) {
      assert.equal(byId.get(id)?.first_name, ANONYMIZED_NAME.first_name);
      assert.equal(byId.get(id)?.email, null);
      assert.ok(byId.get(id)?.anonymized_at);
    }
    for (const id of [recent, coming, young]) assert.equal(byId.get(id)?.anonymized_at, null);

    const kept = await db.from("bookings").select("status, contact_email").eq("id", oldBooking).single();
    assert.deepEqual(kept.data, { status: "completed", contact_email: null });
    const audit = await db.from("audit_log").select("actor_user_id, payload").eq("entity_id", gone).eq("action", "customer.anonymize");
    assert.deepEqual(audit.data, [{ actor_user_id: null, payload: { reason: "retention" } }]);
  });
});

describe("rate-limit counters", () => {
  test("every hit is its own row, counted in a sliding window; old hits are removed", async () => {
    const bucket = `live-test:${run}`;
    for (let i = 0; i < 3; i++) await recordRateLimitHit(bucket, now);
    await recordRateLimitHit(bucket, addDays(now, -3));
    assert.equal(await countRateLimitHits(bucket, addMinutes(now, -1)), 3);
    assert.equal(await countRateLimitHits(bucket, addDays(now, -4)), 4);

    assert.ok((await deleteOldRateLimitHits(addDays(now, -2))) >= 1);
    assert.equal(await countRateLimitHits(bucket, addDays(now, -4)), 3);
    await adminDb().from("rate_limits").delete().eq("bucket", bucket);
  });

  test("5 bookings from one IP in an hour: the sixth is refused; older hits do not count", async () => {
    const rule = RATE_LIMITS.bookingPerIp;
    const bucket = rateLimitBucket(rule, `203.0.113.${run}`);
    await noteRateLimitHit(bucket, addMinutes(now, -61)); // outside the hour
    for (let i = 0; i < 4; i++) await noteRateLimitHit(bucket, addMinutes(now, -i));
    assert.equal(await rateLimitReached(bucket, rule, now), false, "4 in the hour: a fifth is allowed");
    await noteRateLimitHit(bucket, now);
    assert.equal(await rateLimitReached(bucket, rule, now), true, "5 in the hour: the sixth is refused");
    await adminDb().from("rate_limits").delete().eq("bucket", bucket);
  });
});

describe("the job's secret", () => {
  test("without CRON_SECRET the job does not run; a wrong or missing header is refused", async () => {
    const saved = env.CRON_SECRET;
    try {
      delete env.CRON_SECRET;
      assert.equal((await cronJob(new Request("http://localhost/api/cron/reminders"))).status, 503);
      env.CRON_SECRET = `secret-${run}`;
      assert.equal((await cronJob(new Request("http://localhost/api/cron/reminders"))).status, 401);
      const wrong = new Request("http://localhost/api/cron/reminders", { headers: { authorization: `Bearer secret-${run}x` } });
      assert.equal((await cronJob(wrong)).status, 401);
    } finally {
      if (saved === undefined) delete env.CRON_SECRET;
      else env.CRON_SECRET = saved;
    }
  });
});
