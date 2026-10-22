/**
 * Week 10 against a real Supabase project, the separate test one in .env.test (npm run test:live): the customer's
 * internal note, the CSV exports and GDPR anonymization. Runs in temporary salons of its own,
 * deleted at the end with all their rows, and so are the users.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { addDays, subDays } from "date-fns";
import { runAsSignedInUser, type SignedInUser } from "../../lib/auth";
import {
  ANONYMIZED_NAME,
  anonymizeCustomer,
  CUSTOMER_MESSAGES,
  CUSTOMER_NOTE_MAX,
  exportCustomer,
  exportCustomers,
  getCustomers,
  updateCustomerNote,
} from "../../lib/data";
import { adminDb } from "../../lib/supabase/admin";
import type { Booking, Customer } from "../../lib/types";

const run = randomUUID().slice(0, 8);

let salon = "";
let otherSalon = "";
let service = "";
let maja = "";
let owner: SignedInUser;
let helper: SignedInUser; // a staff member's account
let stranger: SignedInUser; // owner of another salon
const userIds: string[] = [];
const asOwner = <T>(fn: () => Promise<T>) => runAsSignedInUser(owner, fn);
const asHelper = <T>(fn: () => Promise<T>) => runAsSignedInUser(helper, fn);

async function tempUser(salonId: string, role: "owner" | "staff"): Promise<SignedInUser> {
  const email = `live-test+customers-${run}-${role}-${userIds.length}@example.com`;
  const { data, error } = await adminDb().auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
  assert.equal(error, null);
  userIds.push(data.user!.id);
  assert.equal((await adminDb().from("salon_users").insert({ salon_id: salonId, user_id: data.user!.id, role })).error, null);
  return { id: data.user!.id, email };
}

let phoneCounter = 0;
async function customer(salonId = salon): Promise<Customer> {
  phoneCounter += 1;
  const phone = `+38641${String(Math.floor(Math.random() * 9000 + 1000))}${String(phoneCounter).padStart(2, "0")}`;
  const { data, error } = await adminDb()
    .from("customers")
    .insert({ salon_id: salonId, first_name: "Ana", last_name: "Novak", phone, email: `ana-${run}@example.com`, notes: "Alergija na amoniak", marketing_consent: true })
    .select("*")
    .single<Customer>();
  assert.equal(error, null);
  return data!;
}

async function booking(customerId: string, start: Date, status: Booking["status"]): Promise<string> {
  const { data, error } = await adminDb()
    .from("bookings")
    .insert({
      salon_id: salon,
      staff_id: maja,
      service_id: service,
      customer_id: customerId,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
      status,
      price_cents: 2500,
      customer_note: "Pridem s hčerko",
      internal_note: "Barva 7.1",
      contact_email: `ana-${run}@example.com`,
    })
    .select("id")
    .single();
  assert.equal(error, null);
  return data!.id;
}

before(async () => {
  assert.equal(process.env.NODE_ENV, "test", "npm run test:live sets NODE_ENV=test");
  const db = adminDb();
  const s = await db.from("salons").insert({ slug: `live-customers-${run}`, name: "Live customers salon" }).select("id").single();
  assert.equal(s.error, null);
  salon = s.data!.id;
  const o = await db.from("salons").insert({ slug: `live-customers-other-${run}`, name: "Other salon" }).select("id").single();
  assert.equal(o.error, null);
  otherSalon = o.data!.id;
  service = (await db.from("services").insert({ salon_id: salon, name: "Striženje", duration_min: 30 }).select("id").single()).data!.id;
  maja = (await db.from("staff").insert({ salon_id: salon, name: "Maja" }).select("id").single()).data!.id;
  owner = await tempUser(salon, "owner");
  helper = await tempUser(salon, "staff");
  stranger = await tempUser(otherSalon, "owner");
});

after(async () => {
  const db = adminDb();
  for (const id of [salon, otherSalon].filter(Boolean)) {
    const { error } = await db.from("salons").delete().eq("id", id); // cascades to every row of the salon
    if (error) console.error("cleanup salon:", error.message);
  }
  for (const id of userIds) await db.auth.admin.deleteUser(id);
});

describe("internal note", () => {
  test("owner and staff save it (trimmed, empty clears it); too long is refused", async () => {
    const ana = await customer();
    const saved = await asHelper(() => updateCustomerNote(salon, ana.id, "  Raje zjutraj.  "));
    assert.ok(saved.ok);
    assert.equal(saved.value.notes, "Raje zjutraj.");

    const cleared = await asOwner(() => updateCustomerNote(salon, ana.id, "   "));
    assert.ok(cleared.ok);
    assert.equal(cleared.value.notes, null);

    const long = await asOwner(() => updateCustomerNote(salon, ana.id, "x".repeat(CUSTOMER_NOTE_MAX + 1)));
    assert.deepEqual(long, { ok: false, error: CUSTOMER_MESSAGES.noteTooLong });

    // The audit row says who changed it, not what the note says.
    const audit = await adminDb().from("audit_log").select("action, actor_user_id, payload").eq("salon_id", salon).eq("entity_id", ana.id);
    assert.ok(audit.data!.length >= 2);
    for (const row of audit.data!) assert.deepEqual(row.payload, {});
  });

  test("another salon's account or no session gets nothing; another salon's customer is not found", async () => {
    const ana = await customer();
    await assert.rejects(() => runAsSignedInUser(stranger, () => updateCustomerNote(salon, ana.id, "X")), /No admin access/);
    await assert.rejects(() => updateCustomerNote(salon, ana.id, "X"), /No admin access/);
    const foreign = await customer(otherSalon);
    const result = await asOwner(() => updateCustomerNote(salon, foreign.id, "X"));
    assert.deepEqual(result, { ok: false, error: CUSTOMER_MESSAGES.notFound });
    const untouched = await adminDb().from("customers").select("notes").eq("id", foreign.id).single();
    assert.equal(untouched.data?.notes, "Alergija na amoniak");
  });
});

describe("anonymization", () => {
  test("owner only; refused while the customer has a future booking", async () => {
    const ana = await customer();
    await assert.rejects(() => asHelper(() => anonymizeCustomer(salon, ana.id)), /No owner access/);
    await assert.rejects(() => runAsSignedInUser(stranger, () => anonymizeCustomer(salon, ana.id)), /No owner access/);

    const upcoming = await booking(ana.id, addDays(new Date(), 3), "confirmed");
    const refused = await asOwner(() => anonymizeCustomer(salon, ana.id));
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.error, /prihodnjih terminov te stranke: 1/);
    const still = await adminDb().from("customers").select("first_name, anonymized_at").eq("id", ana.id).single();
    assert.deepEqual(still.data, { first_name: "Ana", anonymized_at: null });

    // A cancelled future booking does not block it.
    await adminDb().from("bookings").update({ status: "cancelled" }).eq("id", upcoming);
    const done = await asOwner(() => anonymizeCustomer(salon, ana.id));
    assert.ok(done.ok, done.ok ? "" : done.error);
  });

  test("clears personal data, keeps the bookings for statistics, and is safe to repeat", async () => {
    const ana = await customer();
    const past = await booking(ana.id, subDays(new Date(), 10), "completed");
    const noShow = await booking(ana.id, subDays(new Date(), 5), "no_show");

    const result = await asOwner(() => anonymizeCustomer(salon, ana.id));
    assert.ok(result.ok, result.ok ? "" : result.error);

    const row = await adminDb().from("customers").select("*").eq("id", ana.id).single<Customer>();
    assert.equal(row.data!.first_name, ANONYMIZED_NAME.first_name);
    assert.equal(row.data!.last_name, ANONYMIZED_NAME.last_name);
    assert.equal(row.data!.phone, null);
    assert.equal(row.data!.email, null);
    assert.equal(row.data!.notes, null);
    assert.equal(row.data!.marketing_consent, false);
    assert.ok(row.data!.anonymized_at);

    const bookings = await adminDb()
      .from("bookings")
      .select("id, status, price_cents, contact_email, customer_note, internal_note")
      .in("id", [past, noShow])
      .order("starts_at");
    assert.deepEqual(bookings.data, [
      { id: past, status: "completed", price_cents: 2500, contact_email: null, customer_note: null, internal_note: null },
      { id: noShow, status: "no_show", price_cents: 2500, contact_email: null, customer_note: null, internal_note: null },
    ]);

    // Again: nothing to do, still fine. A note can no longer be added.
    assert.ok((await asOwner(() => anonymizeCustomer(salon, ana.id))).ok);
    assert.deepEqual(await asOwner(() => updateCustomerNote(salon, ana.id, "Nekaj")), { ok: false, error: CUSTOMER_MESSAGES.notFound });

    // The old name no longer finds anyone.
    const found = await asOwner(() => getCustomers(salon, { query: "novak" }));
    assert.ok(!found.some((c) => c.customer.id === ana.id));

    const audit = await adminDb().from("audit_log").select("payload").eq("entity_id", ana.id).eq("action", "customer.anonymize");
    assert.deepEqual(audit.data, [{ payload: {} }]);
  });

  test("another salon's customer is not found and stays untouched", async () => {
    const foreign = await customer(otherSalon);
    assert.deepEqual(await asOwner(() => anonymizeCustomer(salon, foreign.id)), { ok: false, error: CUSTOMER_MESSAGES.notFound });
    const untouched = await adminDb().from("customers").select("anonymized_at").eq("id", foreign.id).single();
    assert.equal(untouched.data?.anonymized_at, null);
  });
});

describe("CSV exports", () => {
  test("owner only; the list leaves out anonymized customers; every export is logged", async () => {
    await assert.rejects(() => asHelper(() => exportCustomers(salon)), /No owner access/);
    await assert.rejects(() => runAsSignedInUser(stranger, () => exportCustomers(salon)), /No owner access/);

    const ana = await customer();
    const rows = await asOwner(() => exportCustomers(salon));
    assert.ok(rows.some((r) => r.customer.id === ana.id));
    assert.ok(rows.every((r) => r.customer.anonymized_at === null));
    assert.ok(rows.every((r) => r.customer.salon_id === salon));

    const audit = await adminDb().from("audit_log").select("payload, actor_user_id").eq("salon_id", salon).eq("action", "customers.export");
    assert.deepEqual(audit.data?.at(-1), { payload: { count: rows.length }, actor_user_id: owner.id });
  });

  test("one customer: every booking with service and staff names; another salon's customer is not found", async () => {
    await assert.rejects(() => asHelper(() => exportCustomer(salon, randomUUID())), /No owner access/);
    const ana = await customer();
    const done = await booking(ana.id, subDays(new Date(), 20), "completed");
    const data = await asOwner(() => exportCustomer(salon, ana.id));
    assert.ok(data);
    assert.equal(data.customer.id, ana.id);
    assert.deepEqual(
      data.bookings.map((b) => [b.id, b.service_name, b.staff_name, b.price_cents]),
      [[done, "Striženje", "Maja", 2500]],
    );
    const audit = await adminDb().from("audit_log").select("payload").eq("entity_id", ana.id).eq("action", "customer.export");
    assert.deepEqual(audit.data, [{ payload: {} }]);

    const foreign = await customer(otherSalon);
    assert.equal(await asOwner(() => exportCustomer(salon, foreign.id)), null);
  });
});
