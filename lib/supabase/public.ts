/**
 * Supabase client with the PUBLISHABLE key (role "anon"), no user session.
 *
 * For public data on the booking pages. What it may read is decided by the
 * database (supabase/migrations/003_rls.sql): open salons, their services,
 * staff names, working hours and absences (without the reason). It cannot
 * read customers or bookings at all.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "./client";

let client: SupabaseClient | null = null;

export function publicDb(): SupabaseClient {
  if (!client) {
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    // A secret key here would be shipped to every browser: refuse to start.
    if (key?.startsWith("sb_secret_")) {
      throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a SECRET key. Use the publishable key.");
    }
    client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return client;
}
