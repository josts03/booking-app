/**
 * Week 10 against a real Supabase project, the separate test one in .env.test (npm run test:live): the platform
 * owner's /super data. SUPER_ADMIN_EMAIL is pointed at a temporary account for
 * the run. Every salon and user made here is deleted at the end. No e-mail is
 * sent: createSalonWithOwner only returns the token, the action sends.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { runAsSignedInUser, type SignedInUser } from "../../lib/auth";
import { createSalonWithOwner, getPlatformOverview, PLATFORM_MESSAGES, setSalonStatus } from "../../lib/data";
import { adminDb } from "../../lib/supabase/admin";

const run = randomUUID().slice(0, 8);
const env = process.env as Record<string, string | undefined>;
const savedSuper = env.SUPER_ADMIN_EMAIL;

let salon = "";
let platformOwner: SignedInUser;
let salonOwner: SignedInUser; // owns `salon`, is not the platform owner
const userIds: string[] = [];
const salonIds: string[] = [];
const asSuper = <T>(fn: () => Promise<T>) => runAsSignedInUser(platformOwner, fn);

async function tempUser(name: string): Promise<SignedInUser> {
  const email = `live-test+super-${run}-${name}@example.com`;
  const { data, error } = await adminDb().auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
  assert.equal(error, null);
  userIds.push(data.user!.id);
  return { id: data.user!.id, email };
}

before(async () => {
  assert.equal(process.env.NODE_ENV, "test", "npm run test:live sets NODE_ENV=test");
  const db = adminDb();
  const s = await db.from("salons").insert({ slug: `live-super-${run}`, name: "Live super salon" }).select("id").single();
  assert.equal(s.error, null);
  salon = s.data!.id;
  salonIds.push(salon);
  platformOwner = await tempUser("platform");
  salonOwner = await tempUser("owner");
  await db.from("salon_users").insert({ salon_id: salon, user_id: salonOwner.id, role: "owner" });
  env.SUPER_ADMIN_EMAIL = platformOwner.email!.toUpperCase(); // case does not matter
});

after(async () => {
  if (savedSuper === undefined) delete env.SUPER_ADMIN_EMAIL;
  else env.SUPER_ADMIN_EMAIL = savedSuper;
  const db = adminDb();
  for (const id of salonIds) {
    const { error } = await db.from("salons").delete().eq("id", id); // cascades to every row of the salon
    if (error) console.error("cleanup salon:", error.message);
  }
  for (const id of userIds) await db.auth.admin.deleteUser(id);
});

describe("only the platform owner", () => {
  test("no session, a salon's owner, or an empty SUPER_ADMIN_EMAIL get nothing", async () => {
    await assert.rejects(() => getPlatformOverview(), /No platform access/);
    await assert.rejects(() => runAsSignedInUser(salonOwner, () => getPlatformOverview()), /No platform access/);
    await assert.rejects(() => runAsSignedInUser(salonOwner, () => setSalonStatus(salon, "active")), /No platform access/);
    await assert.rejects(
      () => runAsSignedInUser(salonOwner, () => createSalonWithOwner({ name: "X", slug: `live-x-${run}`, owner_email: "x@example.com" })),
      /No platform access/,
    );
    const configured = env.SUPER_ADMIN_EMAIL;
    env.SUPER_ADMIN_EMAIL = "";
    try {
      await assert.rejects(() => asSuper(() => getPlatformOverview()), /No platform access/);
    } finally {
      env.SUPER_ADMIN_EMAIL = configured;
    }
  });
});

describe("overview", () => {
  test("every salon with its bookings this month, and the e-mails sent", async () => {
    const before = await asSuper(() => getPlatformOverview());
    const mine = before.salons.find((s) => s.salon.id === salon);
    assert.ok(mine);
    assert.equal(mine.bookings_this_month, 0);

    const db = adminDb();
    const service = (await db.from("services").insert({ salon_id: salon, name: "Striženje", duration_min: 30 }).select("id").single()).data!.id;
    const staff = (await db.from("staff").insert({ salon_id: salon, name: "Maja" }).select("id").single()).data!.id;
    const customer = (await db.from("customers").insert({ salon_id: salon, first_name: "Ana" }).select("id").single()).data!.id;
    const start = new Date(Date.now() + 3 * 86_400_000);
    const booking = await db
      .from("bookings")
      .insert({ salon_id: salon, staff_id: staff, service_id: service, customer_id: customer, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 1_800_000).toISOString() })
      .select("id")
      .single();
    assert.equal(booking.error, null);
    await db.from("booking_notifications").insert({ salon_id: salon, booking_id: booking.data!.id, kind: "confirmation", status: "sent" });

    const later = await asSuper(() => getPlatformOverview());
    assert.equal(later.salons.find((s) => s.salon.id === salon)?.bookings_this_month, 1);
    assert.ok(later.emails_this_month >= before.emails_this_month + 1);
    assert.ok(later.emails_today >= before.emails_today + 1);
    // Sorted by name, Slovenian order.
    const names = later.salons.map((s) => s.salon.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "sl")));
  });
});

describe("switching a salon on and off", () => {
  test("saves the status and logs who changed it from what to what", async () => {
    const result = await asSuper(() => setSalonStatus(salon, "suspended"));
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal(result.value.subscription_status, "suspended");
    const audit = await adminDb().from("audit_log").select("actor_user_id, payload").eq("salon_id", salon).eq("action", "salon.status");
    assert.deepEqual(audit.data, [{ actor_user_id: platformOwner.id, payload: { from: "trial", to: "suspended" } }]);
  });

  test("an unknown status or salon is refused", async () => {
    assert.deepEqual(await asSuper(() => setSalonStatus(salon, "free" as never)), { ok: false, error: PLATFORM_MESSAGES.invalid });
    assert.deepEqual(await asSuper(() => setSalonStatus(randomUUID(), "active")), { ok: false, error: PLATFORM_MESSAGES.salonNotFound });
  });
});

describe("new salon", () => {
  async function created(slug: string) {
    const row = await adminDb().from("salons").select("id, name, subscription_status, trial_ends_at").eq("slug", slug).maybeSingle();
    if (row.data) salonIds.push(row.data.id);
    return row.data;
  }

  test("a new account: salon in trial, the account confirmed with no password, owner membership, a one-time token", async () => {
    const slug = `live-new-${run}`;
    const email = `live-test+super-${run}-new@example.com`;
    const result = await asSuper(() => createSalonWithOwner({ name: "  Studio Novi  ", slug: ` ${slug.toUpperCase()} `, owner_email: email.toUpperCase() }));
    const row = await created(slug);
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal(row?.name, "Studio Novi");
    assert.equal(row?.subscription_status, "trial");
    assert.ok(Date.parse(row!.trial_ends_at!) > Date.now() + 13 * 86_400_000);
    assert.deepEqual(result.owner, { email, isNew: true });
    assert.match(result.setPasswordToken ?? "", /^[A-Za-z0-9_-]{8,200}$/, "a token the /novo-geslo form accepts");

    const member = await adminDb().from("salon_users").select("user_id, role").eq("salon_id", row!.id).single();
    assert.equal(member.data?.role, "owner");
    userIds.push(member.data!.user_id);
    const user = await adminDb().auth.admin.getUserById(member.data!.user_id);
    assert.equal(user.data.user?.email, email);
    assert.ok(user.data.user?.email_confirmed_at);

    const audit = await adminDb().from("audit_log").select("actor_user_id, payload").eq("salon_id", row!.id).eq("action", "salon.create");
    assert.deepEqual(audit.data, [{ actor_user_id: platformOwner.id, payload: { slug, owner: "new" } }]);
  });

  test("an existing account gets access too, with no token", async () => {
    const slug = `live-second-${run}`;
    const result = await asSuper(() => createSalonWithOwner({ name: "Drugi salon", slug, owner_email: salonOwner.email! }));
    const row = await created(slug);
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.deepEqual(result.owner, { email: salonOwner.email, isNew: false });
    assert.equal(result.setPasswordToken, null);
    const member = await adminDb().from("salon_users").select("user_id, role").eq("salon_id", row!.id).single();
    assert.deepEqual(member.data, { user_id: salonOwner.id, role: "owner" });
  });

  test("a taken, reserved or malformed subdomain and a bad e-mail are refused; nothing is left behind", async () => {
    const email = `live-test+super-${run}-refused@example.com`;
    assert.deepEqual(
      await asSuper(() => createSalonWithOwner({ name: "Isti", slug: `live-super-${run}`, owner_email: email })),
      { ok: false, error: PLATFORM_MESSAGES.slugTaken },
    );
    assert.deepEqual(await asSuper(() => createSalonWithOwner({ name: "X", slug: "admin", owner_email: email })), {
      ok: false,
      error: PLATFORM_MESSAGES.slugReserved,
    });
    for (const slug of ["a", "-x-", "čarovnija", "a_b", "x".repeat(41)]) {
      assert.deepEqual(await asSuper(() => createSalonWithOwner({ name: "X", slug, owner_email: email })), {
        ok: false,
        error: PLATFORM_MESSAGES.invalid,
      }, slug);
    }
    assert.deepEqual(await asSuper(() => createSalonWithOwner({ name: "X", slug: `live-bad-${run}`, owner_email: "ni-naslov" })), {
      ok: false,
      error: PLATFORM_MESSAGES.invalid,
    });
    assert.equal(await created(`live-bad-${run}`), null);
    // The refused e-mail got no account.
    const users = await adminDb().auth.admin.listUsers({ page: 1, perPage: 200 });
    assert.ok(!users.data.users.some((u) => u.email === email));
  });
});
