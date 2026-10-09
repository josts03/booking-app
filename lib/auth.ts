/**
 * Who is signed in (Supabase Auth, e-mail and password). Session only: whether
 * that person may use THIS salon's admin is decided in lib/admin-access.ts
 * (pages and actions) and in lib/data.ts adminOnly() (every admin query).
 *
 * Errors are logged with their code only, never the e-mail address.
 */
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
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

/** Ends this session (its refresh token stops working) and removes the cookie. */
export async function signOut(): Promise<void> {
  const { error } = await (await sessionDb()).auth.signOut({ scope: "local" });
  if (error) console.error(`[auth] signOut failed: ${error.code ?? error.name}`);
}
