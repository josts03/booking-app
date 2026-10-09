/**
 * Which salon a request is for, from its Host header. Pure and shared by
 * proxy.ts and lib/current-salon.ts, so both always agree and the salon never
 * depends on a header the client could send itself.
 *
 *   frizerstvo-test.domena.si -> "frizerstvo-test"
 *   test.localhost:3000       -> "test"
 *   localhost:3000, domena.si, www.domena.si -> null (no subdomain)
 *
 * Set ROOT_DOMAIN (e.g. "domena.si") in production. Without it, any host with
 * three or more labels is assumed to have the subdomain in front, which is
 * wrong for hosts like "my-app.vercel.app".
 */

/** Salon used when the host has no subdomain (the main domain, localhost). */
export const DEFAULT_SALON_SLUG = "test";

/** Same as the salons_slug_format check in 002_constraints.sql. */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function subdomainOf(host: string): string | null {
  const hostname = host.split(":")[0].toLowerCase();
  const rootDomain = process.env.ROOT_DOMAIN?.toLowerCase();

  let subdomain: string;
  if (rootDomain) {
    if (!hostname.endsWith(`.${rootDomain}`)) return null;
    subdomain = hostname.slice(0, -(rootDomain.length + 1));
  } else if (hostname.endsWith(".localhost")) {
    subdomain = hostname.slice(0, -".localhost".length);
  } else {
    const labels = hostname.split(".");
    if (labels.length < 3) return null;
    subdomain = labels.slice(0, -2).join(".");
  }

  if (subdomain === "www" || !SLUG_PATTERN.test(subdomain)) return null;
  return subdomain;
}

export function salonSlugFromHost(host: string | null): string {
  return subdomainOf(host ?? "") ?? DEFAULT_SALON_SLUG;
}
