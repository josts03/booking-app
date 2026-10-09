/**
 * The signed-in user's Supabase client in server components and server
 * actions, with the session from the request cookies (see session-client.ts).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createSessionClient } from "./session-client";

export async function sessionDb(): Promise<SupabaseClient> {
  const store = await cookies();
  return createSessionClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const { name, value, options } of toSet) store.set(name, value, options);
      } catch {
        // A server component may not set cookies. Harmless: proxy.ts already
        // refreshed the session for this request. Server actions can set them.
      }
    },
  });
}
