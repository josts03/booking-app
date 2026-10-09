/**
 * Who is signed in (Supabase Auth, e-mail and password). Session only: whether
 * that person may use THIS salon's admin is decided in lib/admin-access.ts
 * (pages and actions) and in lib/data.ts adminOnly() (every admin query).
 *
 * Errors are logged with their code only, never the e-mail address.
 */
import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicDb } from "./supabase/public";
import { sessionDb } from "./supabase/session";

export interface SignedInUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user, or null. getUser() asks Supabase every time (once per
 * request, cached), so a session that was signed out or a deleted user stops
 * working at once. Fails closed: no request (scripts, tests) or any error
 * means nobody is signed in.
 */
export const getSignedInUser = cache(async (): Promise<SignedInUser | null> => {
  try {
    await cookies(); // throws outside a request: nobody is signed in there
  } catch {
    return null;
  }
  const { data, error } = await (await sessionDb()).auth.getUser();
  if (error || !data.user) {
    if (error && error.name !== "AuthSessionMissingError") {
      console.error(`[auth] getUser failed: ${error.code ?? error.name}`);
    }
    return null;
  }
  return { id: data.user.id, email: data.user.email ?? null };
});

export type SignInResult =
  | { ok: true; user: SignedInUser }
  | { ok: false; reason: "invalid" | "rate-limited" | "failed" };

/** Signs in and stores the session cookie. Server actions only (cookies are written). */
export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await (await sessionDb()).auth.signInWithPassword({ email, password });
  if (!error && data.user) return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } };
  if (error?.code === "invalid_credentials" || error?.code === "email_not_confirmed") {
    return { ok: false, reason: "invalid" };
  }
  console.error(`[auth] signIn failed: ${error?.code ?? error?.status ?? "no user"}`);
  if (error?.status === 429) return { ok: false, reason: "rate-limited" };
  return { ok: false, reason: "failed" };
}

/**
 * Asks Supabase to e-mail a password reset link. The link (template in
 * supabase/templates/reset-password.html) leads to `redirectTo` with a
 * one-time token_hash. Session-less client: nothing is stored in this browser,
 * so the link also works on another device. Never says whether the account
 * exists: the caller always shows the same sentence.
 */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const { error } = await publicDb().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) console.error(`[auth] resetPasswordForEmail failed: ${error.code ?? error.status ?? error.name}`);
}

/** E-mail link methods in the token's "amr" claim (a reset link gives one of them). */
const LINK_METHODS = new Set(["recovery", "otp", "magiclink"]);
const RESET_SESSION_MAX_AGE_S = 15 * 60;

/** The current session was created by an e-mail link in the last 15 minutes. */
async function signedInByResetLink(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims) return false;
  const now = Date.now() / 1000;
  return (data.claims.amr ?? []).some(
    (entry) =>
      typeof entry === "object" &&
      LINK_METHODS.has(entry.method) &&
      now - entry.timestamp < RESET_SESSION_MAX_AGE_S,
  );
}

export type NewPasswordResult =
  | { ok: true }
  | { ok: false; reason: "link-invalid" | "weak" | "same" | "failed"; verified: boolean };

/**
 * Sets a new password from a reset link. The token is checked only now, when
 * the form is sent, not when the link is opened: mail scanners open links in
 * e-mails and would otherwise use up the one-time token. Verifying signs the
 * user in (cookie), so if the password is then refused, the next try needs no
 * token (`tokenHash` null).
 */
export async function setNewPassword(tokenHash: string | null, password: string): Promise<NewPasswordResult> {
  const db = await sessionDb();
  let verified = false;
  if (tokenHash) {
    const { error } = await db.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error) {
      console.error(`[auth] verifyOtp(recovery) failed: ${error.code ?? error.name}`);
      return { ok: false, reason: "link-invalid", verified: false };
    }
    verified = true;
  } else if (!(await signedInByResetLink(db))) {
    // Without a token only a session from a reset link may set a password, not
    // any signed-in session (that would change a password without knowing it).
    return { ok: false, reason: "link-invalid", verified: false };
  }
  const { error } = await db.auth.updateUser({ password });
  if (!error) return { ok: true };
  console.error(`[auth] updateUser(password) failed: ${error.code ?? error.name}`);
  if (error.name === "AuthSessionMissingError") return { ok: false, reason: "link-invalid", verified };
  if (error.code === "weak_password") return { ok: false, reason: "weak", verified };
  if (error.code === "same_password") return { ok: false, reason: "same", verified };
  return { ok: false, reason: "failed", verified };
}

/** Ends this session (its refresh token stops working) and removes the cookie. */
export async function signOut(): Promise<void> {
  const { error } = await (await sessionDb()).auth.signOut({ scope: "local" });
  if (error) console.error(`[auth] signOut failed: ${error.code ?? error.name}`);
}
