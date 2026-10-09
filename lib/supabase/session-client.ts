/**
 * Supabase client that carries the signed-in user's session in a cookie
 * (@supabase/ssr). PUBLISHABLE key: the user acts as role "authenticated", so
 * grants and RLS (003_rls.sql) apply to everything it reads.
 *
 * Two callers:
 * - lib/supabase/session.ts: server components and server actions (next/headers)
 * - proxy.ts: refreshSession() below, before a page renders
 *
 * No "server-only" here: proxy.ts imports this file and handles no secret
 * (the publishable key is public on purpose).
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

/**
 * httpOnly: the browser's JavaScript never needs the session (sign-in and
 * everything else runs on the server), so a script injected into a page
 * cannot read it. Secure outside development (http://test.localhost has no TLS).
 */
const SESSION_COOKIE: CookieOptions = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};

const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

export type SessionCookie = { name: string; value: string; options: CookieOptions };

export interface SessionCookieStore {
  getAll(): { name: string; value: string }[];
  /** Called when the session is created, refreshed or removed. */
  setAll(cookies: SessionCookie[], headers: Record<string, string>): void;
}

/** A new client per request (never shared: it holds that request's session). */
export function createSessionClient(store: SessionCookieStore): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL (see .env.example)");
  if (!key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)");
  if (key.startsWith("sb_secret_")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a SECRET key. Use the publishable key.");
  }
  return createServerClient(url, key, {
    cookieOptions: SESSION_COOKIE,
    cookies: { getAll: () => store.getAll(), setAll: (cookies, headers) => store.setAll(cookies, headers) },
    global: { fetch: noStoreFetch },
  });
}

export interface SessionRefresh {
  /** A valid session was found (optimistic: the real check is lib/admin-access.ts). */
  signedIn: boolean;
  /** Cookies and no-cache headers to put on the response. */
  cookies: SessionCookie[];
  headers: Record<string, string>;
}

/**
 * Refreshes an expiring session before the page renders. Server components may
 * not write cookies, and Supabase refresh tokens work only once, so without
 * this a page would refresh, fail to store the new tokens and sign the user
 * out on the next request. The new cookies are also written into `request`, so
 * the page rendered after the proxy already sees them.
 */
export async function refreshSession(request: NextRequest): Promise<SessionRefresh> {
  const result: SessionRefresh = { signedIn: false, cookies: [], headers: {} };
  const supabase = createSessionClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookies, headers) => {
      for (const { name, value } of cookies) request.cookies.set(name, value);
      result.cookies.push(...cookies);
      Object.assign(result.headers, headers);
    },
  });
  // Verifies the token's signature (or asks Supabase) and refreshes it if needed.
  const { data, error } = await supabase.auth.getClaims();
  result.signedIn = !error && Boolean(data?.claims?.sub);
  return result;
}
