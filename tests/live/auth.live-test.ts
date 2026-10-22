/**
 * Sign-in and salon membership against a real Supabase project, the separate test one in .env.test (npm run test:live).
 *
 * A temporary user is created with the Auth admin API (random password, never
 * printed) and deleted at the end; its salon_users rows go with it (cascade).
 * The page-level check (cookies -> user -> membership) needs a Next request;
 * these tests cover its two halves: membership (getSalonRole, used by
 * lib/admin-access.ts and lib/data.ts) and what a signed-in user can read
 * through grants + RLS (003_rls.sql, 004_private_helpers.sql).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSalonRole } from "../../lib/data";
import { FIXTURE_SALON_ID } from "../../lib/fixtures";
import { adminDb } from "../../lib/supabase/admin";

const SALON = FIXTURE_SALON_ID;
const run = randomUUID().slice(0, 8);
const password = randomBytes(24).toString("base64url");
let userId = "";
let otherSalonId = "";

/** A client signed in as the temporary user (role "authenticated"), like the admin's session. */
async function signedIn(): Promise<SupabaseClient> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: `live-test+${run}@example.com`, password });
  assert.equal(error, null, "sign-in of the temporary user");
  return client;
}

before(async () => {
  assert.ok(process.env.SUPABASE_SECRET_KEY, "Run with npm run test:live (needs .env.test)");
  const db = adminDb();
  const user = await db.auth.admin.createUser({
    email: `live-test+${run}@example.com`,
    password,
    email_confirm: true,
  });
  assert.equal(user.error, null, "create the temporary user");
  userId = user.data.user!.id;

  const salon = await db.from("salons").insert({ slug: `live-auth-${run}`, name: "Live auth salon" }).select("id").single();
  assert.equal(salon.error, null);
  otherSalonId = salon.data!.id;
});

after(async () => {
  const db = adminDb();
  if (userId) {
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) console.error("cleanup user:", error.message);
  }
  if (otherSalonId) {
    const { error } = await db.from("salons").delete().eq("id", otherSalonId);
    if (error) console.error("cleanup salon:", error.message);
  }
});

describe("salon membership (who may open /admin of a salon)", () => {
  test("a user who is in no salon_users row is a member of nothing", async () => {
    assert.equal(await getSalonRole(SALON, userId), null);
    assert.equal(await getSalonRole(otherSalonId, userId), null);
  });

  test("a signed-in non-member reads no salon data at all", async () => {
    const client = await signedIn();
    for (const table of ["bookings", "customers", "staff", "salon_users"]) {
      const { data, error } = await client.from(table).select("id").limit(5);
      assert.equal(error, null, table);
      assert.deepEqual(data, [], table);
    }
    await client.auth.signOut();
  });

  test("after joining a salon: member of that salon only", async () => {
    const { error } = await adminDb().from("salon_users").insert({ salon_id: SALON, user_id: userId, role: "staff" });
    assert.equal(error, null);
    assert.equal(await getSalonRole(SALON, userId), "staff");
    assert.equal(await getSalonRole(otherSalonId, userId), null);
  });

  test("a member reads their own salon's bookings and nothing of another salon", async () => {
    const client = await signedIn();
    const own = await client.from("bookings").select("salon_id").limit(50);
    assert.equal(own.error, null);
    assert.ok((own.data ?? []).length > 0, "the seed salon has bookings");
    assert.ok(own.data!.every((row) => row.salon_id === SALON));

    const other = await client.from("services").select("id").eq("salon_id", otherSalonId);
    assert.deepEqual(other.data, []);
    const memberships = await client.from("salon_users").select("salon_id");
    assert.deepEqual(memberships.data, [{ salon_id: SALON }]);

    // Not even a member may switch the subscription or change the slug (column grants).
    const sneaky = await client.from("salons").update({ subscription_status: "active" }).eq("id", SALON);
    assert.equal(sneaky.error?.code, "42501");
    await client.auth.signOut();
  });

  test("a wrong password does not sign in", async () => {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email: `live-test+${run}@example.com`, password: `${password}x` });
    assert.equal(error?.code, "invalid_credentials");
    assert.equal(data.session, null);
  });

  test("malformed ids are never a member", async () => {
    assert.equal(await getSalonRole("ni-uuid", userId), null);
    assert.equal(await getSalonRole(SALON, "ni-uuid"), null);
  });
});

describe("password reset link (what lib/auth.ts setNewPassword relies on)", () => {
  const plainClient = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  const email = () => `live-test+${run}@example.com`;

  /** The token_hash a reset e-mail would contain (generateLink sends no e-mail). */
  async function resetToken(): Promise<string> {
    const { data, error } = await adminDb().auth.admin.generateLink({ type: "recovery", email: email() });
    assert.equal(error, null);
    return data.properties!.hashed_token;
  }

  test("the token signs in once, as an e-mail link session, and sets a new password", async () => {
    const token = await resetToken();
    const client = plainClient();
    const verified = await client.auth.verifyOtp({ type: "recovery", token_hash: token });
    assert.equal(verified.error, null);

    // lib/auth.ts accepts a token-less retry only for such a session.
    const { data } = await client.auth.getClaims();
    const methods = (data?.claims.amr ?? []).map((entry) => (typeof entry === "object" ? entry.method : entry));
    assert.ok(
      methods.some((method) => ["recovery", "otp", "magiclink"].includes(method)),
      `amr methods: ${methods.join(", ")}`,
    );

    const newPassword = `${password}-novo`;
    assert.equal((await client.auth.updateUser({ password: newPassword })).error, null);
    const withNew = await plainClient().auth.signInWithPassword({ email: email(), password: newPassword });
    assert.equal(withNew.error, null);
    const withOld = await plainClient().auth.signInWithPassword({ email: email(), password });
    assert.equal(withOld.error?.code, "invalid_credentials");

    // Used once: the same link no longer works.
    const again = await plainClient().auth.verifyOtp({ type: "recovery", token_hash: token });
    assert.ok(again.error, "a reset token must work only once");
  });

  test("a password session is not an e-mail link session (no password change without the link)", async () => {
    const client = plainClient();
    const signed = await client.auth.signInWithPassword({ email: email(), password: `${password}-novo` });
    assert.equal(signed.error, null);
    const { data } = await client.auth.getClaims();
    const methods = (data?.claims.amr ?? []).map((entry) => (typeof entry === "object" ? entry.method : entry));
    assert.deepEqual(methods, ["password"]);
  });

  test("a made-up token does not sign in", async () => {
    const { error } = await plainClient().auth.verifyOtp({ type: "recovery", token_hash: "0".repeat(56) });
    assert.ok(error);
  });
});
