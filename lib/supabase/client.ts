/**
 * Shared setup for the two Supabase clients (public.ts and admin.ts).
 * Server only: neither client is ever sent to the browser.
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Every database read must be current (free slots!). Next.js does not cache
 * fetch by default, but this makes it explicit, whatever the route config says.
 */
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

export function createServerClient(url: string | undefined, key: string | undefined, keyName: string): SupabaseClient {
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL (see .env.example)");
  if (!key) throw new Error(`Missing ${keyName} (see .env.example)`);
  return createClient(url, key, {
    // No user session here: public pages read as "anon", the server as "service_role".
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: noStoreFetch },
  });
}
