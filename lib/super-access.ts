/**
 * Who may use /super, the platform owner's dashboard (specs/mvp.md): the
 * signed-in user whose e-mail is SUPER_ADMIN_EMAIL (lib/super-admin.ts), on
 * the main domain only. Checked on the server only, never in the browser.
 *
 * Checked in layers, because each can be reached on its own:
 * - proxy.ts: no session cookie -> /prijava (fast, optimistic)
 * - app/super/layout.tsx, every /super page and server action: getSuperAccess()
 * - lib/data.ts superOnly(): every platform query and change
 */
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { getSignedInUser, type SignedInUser } from "./auth";
import { isSuperAdminEmail } from "./super-admin";
import { requestHost, subdomainOf } from "./tenant";

export type SuperAccess =
  | { ok: true; user: SignedInUser }
  /** "wrong-host": /super on a salon's subdomain, which never has it. */
  | { ok: false; reason: "wrong-host" | "signed-out" | "not-super" };

/** Cached per request, so the layout, the page and an action share one check. */
export const getSuperAccess = cache(async (): Promise<SuperAccess> => {
  if (subdomainOf(requestHost(await headers()) ?? "")) return { ok: false, reason: "wrong-host" };
  const user = await getSignedInUser();
  if (!user) return { ok: false, reason: "signed-out" };
  if (!isSuperAdminEmail(user.email)) return { ok: false, reason: "not-super" };
  return { ok: true, user };
});

/** What a /super server action answers when access is gone (e.g. signed out in another tab). */
export const NO_SUPER_ACCESS = "Seja je potekla. Prijavite se znova.";
