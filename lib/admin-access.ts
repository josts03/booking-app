/**
 * Who may use the admin. TEMPORARY until login (week 7).
 *
 * The admin reads real customers and bookings with the secret key, and there
 * is no login yet. So for now it only works on a developer's own machine
 * (`npm run dev`) and is closed everywhere else, including `next start` and
 * any deployment. Week 7 replaces this with a server-side check that the
 * logged-in user is in salon_users for this salon.
 *
 * Checked in three places, because each can be reached on its own:
 * proxy.ts (every /admin request), app/admin/layout.tsx (the pages) and every
 * admin server action (server actions can be called without the page).
 */
import "server-only";

export function adminAccessAllowed(): boolean {
  return process.env.NODE_ENV === "development";
}
