"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured, supabaseServer } from "@/lib/supabase";

/** Ends the session and returns to the sign-in page. */
export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/prijava");
}
