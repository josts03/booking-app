/**
 * Reads the subdomain from the Host header and passes it on as the
 * `x-salon-slug` request header. Server code reads it with `headers()`.
 *
 *   frizerstvo-test.domena.si -> "frizerstvo-test"
 *   test.localhost:3000       -> "test"
 *   localhost:3000, domena.si, www.domena.si -> "test" (no subdomain, default)
 *
 * With a subdomain, "/" is rewritten to the salon's booking page (/rezervacija).
 *
 * Set ROOT_DOMAIN (e.g. "domena.si") in production. Without it, any host with
 * three or more labels is assumed to have the subdomain in front, which is
 * wrong for hosts like "my-app.vercel.app".
 *
 * NOTE: Next.js 16 renamed this file convention to proxy.ts (same code, the
 * exported function is called `proxy`). middleware.ts still works but is
 * deprecated.
 */
import { NextResponse, type NextRequest } from "next/server";

const DEFAULT_SLUG = "test";
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function getSubdomain(host: string): string | null {
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

export function middleware(request: NextRequest) {
  const subdomain = getSubdomain(request.headers.get("host") ?? "");
  const slug = subdomain ?? DEFAULT_SLUG;

  // set() overwrites any x-salon-slug the client sent, so it cannot be spoofed.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-salon-slug", slug);

  // On a salon's own subdomain the root is the booking page. On the main
  // domain "/" stays the marketing site. /rezervacija works on both.
  if (subdomain && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/rezervacija";
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Skip static assets and files with an extension.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
