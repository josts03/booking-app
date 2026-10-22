/**
 * Where to go after signing in (the `next` parameter of /prijava). Only a path
 * inside the admin or the platform owner's /super is accepted, so a crafted
 * link such as /prijava?next=https://evil.example cannot send someone to
 * another site right after they sign in (open redirect). Anything else gives
 * "/admin".
 *
 * Pure: shared by proxy.ts and the sign-in action.
 */
export const ADMIN_HOME = "/admin";

// Letters, digits, "-" and "/" in the path (no dots: Next's ".rsc" transport
// URLs are not pages), and a plain query string.
const ADMIN_TARGET = /^\/(?:admin|super)(?:\/[A-Za-z0-9\-/]*)?(?:\?[A-Za-z0-9\-_=&%.+]*)?$/;

export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 300) return ADMIN_HOME;
  if (!ADMIN_TARGET.test(value) || value.includes("//")) return ADMIN_HOME;
  return value;
}
