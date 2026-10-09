/**
 * Runs before every page and server action (see `config.matcher`).
 *
 * - Closes the admin outside `npm run dev` until login exists (week 7), the
 *   same rule as lib/admin-access.ts.
 * - Passes the salon slug from the subdomain on as the `x-salon-slug` request
 *   header (lib/tenant.ts). Server code takes the salon from the Host header
 *   itself (lib/current-salon.ts), so it does not depend on this header.
 * - On a salon's own subdomain, "/" is the booking page (/rezervacija).
 *
 * Next.js 16 calls this file convention "proxy" (it was "middleware" before).
 */
import { NextResponse, type NextRequest } from "next/server";
import { salonSlugFromHost, subdomainOf } from "./lib/tenant";

/** "/admin", "/admin/...", and Next's transport URLs such as "/admin.rsc". */
const ADMIN_PATH = /^\/admin(?:[/.]|$)/;

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (ADMIN_PATH.test(path) && process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }

  const host = request.headers.get("host");

  // set() overwrites any x-salon-slug the client sent.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-salon-slug", salonSlugFromHost(host));

  // On a salon's own subdomain the root is the booking page. On the main
  // domain "/" stays the marketing site. /rezervacija works on both.
  if (subdomainOf(host ?? "") && path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/rezervacija";
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Everything except Next's static files and files with a static-asset
  // extension. Paths with other dots must still match: Next 16 serves pages
  // also as "<page>.rsc" and "<page>.segments/...", and those must not skip
  // the admin check above.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:ico|png|jpe?g|gif|webp|avif|svg|css|js|map|txt|xml|webmanifest|woff2?|ttf|otf)$).*)",
  ],
};
