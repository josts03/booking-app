/**
 * Runs before every page and server action (see `config.matcher`).
 *
 * - Admin and /super: refreshes the Supabase session cookie before the page
 *   renders (lib/supabase/session-client.ts). Without a valid session, both go
 *   to /prijava. This is only the fast first check; the real one is on the
 *   server next to the data (lib/admin-access.ts, lib/super-access.ts).
 * - Passes the salon slug from the subdomain on as the `x-salon-slug` request
 *   header (lib/tenant.ts). Server code takes the salon from the Host header
 *   itself (lib/current-salon.ts), so it does not depend on this header.
 * - On a salon's own subdomain, "/" is the booking page (/rezervacija).
 *
 * Next.js 16 calls this file convention "proxy" (it was "middleware" before).
 */
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath, ADMIN_HOME } from "./lib/safe-next";
import { refreshSession, type SessionRefresh } from "./lib/supabase/session-client";
import { salonSlugFromHost, subdomainOf } from "./lib/tenant";

/** "/admin", "/super", their subpaths, and Next's transport URLs such as "/admin.rsc". */
const SIGNED_IN_PATH = /^\/(?:admin|super)(?:[/.]|$)/;

/** Puts the refreshed session cookies, and the headers that keep CDNs from caching them, on a response. */
function withSession(response: NextResponse, session: SessionRefresh | null): NextResponse {
  if (!session) return response;
  for (const { name, value, options } of session.cookies) response.cookies.set(name, value, options);
  for (const [key, value] of Object.entries(session.headers)) response.headers.set(key, value);
  return response;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  let session: SessionRefresh | null = null;
  if (SIGNED_IN_PATH.test(path)) {
    session = await refreshSession(request);
    // Pages only. A server action (POST) is not redirected: Next could not show
    // the sign-in page as its answer. The action itself answers "session
    // expired" (lib/admin-access.ts), and lib/data.ts refuses the data anyway.
    const isPageRequest = request.method === "GET" || request.method === "HEAD";
    if (!session.signedIn && isPageRequest) {
      const url = request.nextUrl.clone();
      url.pathname = "/prijava";
      url.search = "";
      const next = safeNextPath(path + request.nextUrl.search);
      if (next !== ADMIN_HOME) url.searchParams.set("next", next);
      return withSession(NextResponse.redirect(url), session);
    }
  }

  const host = request.headers.get("host");

  // Built after refreshSession(), so the page sees the refreshed cookies.
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

  return withSession(NextResponse.next({ request: { headers: requestHeaders } }), session);
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
