/**
 * Supabase client with the SECRET key (role "service_role"). Bypasses RLS.
 *
 * CLAUDE.md: the secret key is used in this file only, and this file is
 * imported on the server only ("server-only" makes a client import fail the
 * build). Every query through it must filter by salon_id itself.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "./client";

let client: SupabaseClient | null = null;

export function adminDb(): SupabaseClient {
  if (!client) {
    const key = process.env.SUPABASE_SECRET_KEY;
    if (key?.startsWith("sb_publishable_")) {
      throw new Error("SUPABASE_SECRET_KEY holds the publishable key. Use the secret key.");
    }
    client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, "SUPABASE_SECRET_KEY");
  }
  return client;
}
