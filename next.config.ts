import type { NextConfig } from "next";

/**
 * Security headers on every response (security review of 22. 10. 2026, finding 3).
 * - No page may be shown inside a frame on another site: the admin could
 *   otherwise be hidden under a fake page and clicked (clickjacking).
 *   frame-ancestors only says who may frame US; the Turnstile frame inside the
 *   booking form is not affected.
 * - Browsers must not guess file types (the CSV exports), and other sites get
 *   only the origin, never a path with a token in it.
 * - HTTPS only, on each host that sent it (ignored over
 *   plain http, so development on localhost is not affected).
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
