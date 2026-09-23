/**
 * Reads the subdomain from the Host header and passes it on as the
 * `x-salon-slug` request header. Server code reads it with `headers()`.
 *
 *   frizerstvo-test.domena.si -> "frizerstvo-test"
 *   test.localhost:3000       -> "test"
 *   localhost:3000, domena.si, www.domena.si -> "test" (no subdomain, default)
 *   booking-app.vercel.app    -> "test" (platform host, see PLATFORM_SUFFIXES)
 *
 * With a subdomain, "/" is rewritten to the salon's booking page (/rezervacija).
 *
 * Set ROOT_DOMAIN (e.g. "domena.si") in production, so only real salon
 * subdomains are recognised. Without it we fall back to a heuristic that reads
 * the front labels of any host with three or more of them as the subdomain,
 * which is why PLATFORM_SUFFIXES has to carve out the hosting platform itself.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseFromRequest } from "./lib/supabase";

const DEFAULT_SLUG = "test";
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * The hosting platform's own domains. The label in front of these is the
 * deployment name ("booking-app", "booking-app-git-main-jost"), never a salon,
 * so they count as having no subdomain. Without this the heuristic below reads
 * the deployment name as a slug, finds no such salon, and every page 404s.
 */
const PLATFORM_SUFFIXES = [".vercel.app", ".vercel.sh"];

function getSubdomain(host: string): string | null {
  const hostname = host.split(":")[0].toLowerCase();
  const rootDomain = process.env.ROOT_DOMAIN?.toLowerCase();

  let subdomain: string;
  if (rootDomain) {
    if (!hostname.endsWith(`.${rootDomain}`)) return null;
    subdomain = hostname.slice(0, -(rootDomain.length + 1));
  } else if (hostname.endsWith(".localhost")) {
    subdomain = hostname.slice(0, -".localhost".length);
  } else if (PLATFORM_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return null;
  } else {
    const labels = hostname.split(".");
    if (labels.length < 3) return null;
    subdomain = labels.slice(0, -2).join(".");
  }

  if (subdomain === "www" || !SLUG_PATTERN.test(subdomain)) return null;
  return subdomain;
}

/** The signed-in cookie @supabase/ssr writes, possibly split into chunks. */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"));
}

export async function proxy(request: NextRequest) {
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

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  const { pathname } = request.nextUrl;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return guardAdmin(request, response, pathname);
  }

  return response;
}

/**
 * Keeps signed-out visitors out of /admin, and keeps a signed-in session alive.
 *
 * This is only the first line: the Next.js docs call it an optimistic check and
 * warn that Proxy runs on every route, including prefetched ones. So when there
 * is no session cookie at all we redirect without asking Supabase anything, and
 * only spend a network call when a cookie exists — which is also the one place
 * able to write the refreshed cookie back, since server components cannot.
 *
 * The decision that actually protects data is made again in
 * app/admin/layout.tsx and in every admin server action (lib/auth.ts), and once
 * more by row level security in the database.
 */
async function guardAdmin(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
): Promise<NextResponse> {
  const toSignIn = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/prijava";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  };

  // No keys yet (phase 1): fail closed, never open.
  if (!isSupabaseConfigured()) return toSignIn();
  if (!hasSessionCookie(request)) return toSignIn();

  const supabase = supabaseFromRequest(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return toSignIn();

  return response;
}

export const config = {
  // Skip static assets and files with an extension.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
