import type { SubscriptionStatus } from "./types";

/**
 * The platform owner, who alone may use /super (specs/mvp.md): exactly the
 * e-mail in SUPER_ADMIN_EMAIL. Pure, shared by the sign-in action,
 * lib/super-access.ts (pages and actions) and lib/data.ts superOnly() (data).
 *
 * Fails closed: no setting, no e-mail, or anything that is not an exact match
 * (case aside) means "no". The e-mail comes from Supabase Auth on the server
 * (lib/auth.ts getUser), never from the browser.
 */
export function isSuperAdminEmail(email: string | null | undefined, configured = process.env.SUPER_ADMIN_EMAIL): boolean {
  const wanted = configured?.trim().toLowerCase();
  if (!wanted || !email) return false;
  return email.trim().toLowerCase() === wanted;
}

/** Paths of the platform owner's dashboard. */
export const SUPER_HOME = "/super";

export function isSuperPath(path: string): boolean {
  return path === SUPER_HOME || path.startsWith(`${SUPER_HOME}/`);
}

export const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const satisfies readonly SubscriptionStatus[];

/** Names for the platform owner, and whether the booking page works (lib/current-salon.ts isBookable). */
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, { label: string; bookable: boolean }> = {
  trial: { label: "Preizkus", bookable: true },
  active: { label: "Aktiven", bookable: true },
  past_due: { label: "Zamuda s plačilom", bookable: false },
  suspended: { label: "Izklopljen", bookable: false },
  cancelled: { label: "Prekinjen", bookable: false },
};
