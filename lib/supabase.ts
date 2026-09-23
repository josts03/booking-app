/**
 * Supabase clients. SERVER ONLY — never import this from a client component.
 *
 * Three callers, three levels of trust:
 *
 *   supabaseFromRequest()  proxy.ts, so the session cookie stays fresh
 *   supabaseServer()       signed-in admin work; RLS applies, the user sees
 *                          only their own salon (specs/schema.sql)
 *   supabaseAdmin()        service role: BYPASSES RLS. Only where the visitor
 *                          has no account at all — creating a booking and
 *                          cancelling by token, because `customers` and
 *                          `bookings` have no public policy on purpose.
 *
 * Picking the wrong one fails quietly: under RLS a blocked read returns zero
 * rows, not an error, so a screen just goes blank. Every function in
 * lib/data.ts should say which client it uses and why.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Whether the project has its Supabase keys yet.
 *
 * Without them the admin refuses to open (see app/admin/layout.tsx) and every
 * read comes back empty. It fails CLOSED on purpose: a missing environment
 * variable must never be the reason the admin is world-readable.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(URL && ANON_KEY);
}

function required(): { url: string; anonKey: string } {
  if (!URL || !ANON_KEY) {
    throw new Error(
      "Supabase ni nastavljen: manjkata NEXT_PUBLIC_SUPABASE_URL in NEXT_PUBLIC_SUPABASE_ANON_KEY (glej .env.example).",
    );
  }
  return { url: URL, anonKey: ANON_KEY };
}

/**
 * Client bound to one request/response pair, for proxy.ts. Reading the user
 * here also refreshes an expiring session and writes the new cookie onto the
 * response, which is the only place that can happen.
 */
export function supabaseFromRequest(request: NextRequest, response: NextResponse) {
  const { url, anonKey } = required();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });
}

/**
 * Client for server components and server actions, carrying the signed-in
 * user's session. Everything it reads passes through the RLS policies.
 */
export async function supabaseServer() {
  const { url, anonKey } = required();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // A server component may not set cookies. Harmless: proxy.ts has
          // already refreshed the session for this request.
        }
      },
    },
  });
}

/**
 * Service role client. IGNORES row level security, so it must never be reached
 * from anything a visitor controls beyond the narrow paths it exists for.
 * Never expose this key to the browser.
 */
export function supabaseAdmin() {
  if (!URL || !SERVICE_KEY) {
    throw new Error(
      "Manjka SUPABASE_SERVICE_ROLE_KEY (glej .env.example). Potreben je za javno rezervacijo in odpoved.",
    );
  }
  return createClient(URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
