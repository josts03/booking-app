/**
 * Who is signed in, and may they run this salon?
 *
 * This is the real check. Next.js calls it the Data Access Layer: proxy.ts only
 * makes a cheap optimistic guess from the cookie, while every page and every
 * server action that touches salon data asks here, as close to the data as
 * possible.
 *
 * Membership is `staff.user_id = auth.uid()` for THIS salon — the same rule the
 * `is_salon_member()` function and the RLS policies in specs/schema.sql use, so
 * the app and the database cannot disagree about who belongs where.
 */
import { cache } from "react";
import { getCurrentSalon } from "./current-salon";
import { isSupabaseConfigured, supabaseServer } from "./supabase";
import type { Staff } from "./types";

/**
 * The signed-in staff member of the current salon, or null.
 *
 * Returns null while Supabase is not configured (phase 1), which keeps the
 * admin shut rather than open — a missing key must never grant access.
 * Cached per request, so a layout, a page and an action share one lookup.
 */
export const getSignedInStaff = cache(async (): Promise<Staff | null> => {
  if (!isSupabaseConfigured()) return null;

  const salon = await getCurrentSalon();
  if (!salon) return null;

  const supabase = await supabaseServer();
  // getUser() revalidates the token with Supabase; getSession() would trust
  // whatever the cookie claims, so it must not be used for an access decision.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("staff")
    .select("*")
    .eq("user_id", user.id)
    .eq("salon_id", salon.id)
    .eq("is_active", true)
    .maybeSingle();

  return (data as Staff | null) ?? null;
});

/** Sentence shown when an action is attempted without a session. */
export const NOT_SIGNED_IN = "Seja je potekla. Prijavite se znova.";
