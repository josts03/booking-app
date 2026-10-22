/**
 * Who may use the admin of the current salon: a signed-in user who is in
 * salon_users for THIS salon (the one from the request's host, lib/tenant.ts).
 * Checked on the server only, never in the browser.
 *
 * Checked in layers, because each can be reached on its own:
 * - proxy.ts: no session cookie -> /prijava (fast, optimistic)
 * - app/admin/layout.tsx and every admin server action: getAdminAccess()
 * - lib/data.ts adminOnly(): every admin query, for the salon it is asked about
 * Owners and staff have the same access for now (roles come later).
 */
import "server-only";
import { cache } from "react";
import { getSignedInUser, type SignedInUser } from "./auth";
import { getCurrentSalon } from "./current-salon";
import { getSalonRole, type SalonRole } from "./data";
import type { Salon } from "./types";

export type AdminAccess =
  | { ok: true; salon: Salon; user: SignedInUser; role: SalonRole }
  | { ok: false; reason: "no-salon"; salon: null; user: SignedInUser | null }
  | { ok: false; reason: "signed-out"; salon: Salon; user: null }
  | { ok: false; reason: "not-member"; salon: Salon; user: SignedInUser };

/** Cached per request, so the layout, the page and an action share one check. */
export const getAdminAccess = cache(async (): Promise<AdminAccess> => {
  const [salon, user] = await Promise.all([getCurrentSalon(), getSignedInUser()]);
  if (!salon) return { ok: false, reason: "no-salon", salon: null, user };
  if (!user) return { ok: false, reason: "signed-out", salon, user: null };
  const role = await getSalonRole(salon.id, user.id);
  if (!role) return { ok: false, reason: "not-member", salon, user };
  return { ok: true, salon, user, role };
});

/** What an admin server action answers when access is gone (e.g. signed out in another tab). */
export const NO_ADMIN_ACCESS = "Seja je potekla. Prijavite se znova.";

/** What a staff member's account sees when it tries an owner-only change (decision of 22. 10. 2026). */
export const OWNER_ONLY = "To lahko ureja samo lastnik salona.";
