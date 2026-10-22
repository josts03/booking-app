/**
 * Rate limits (specs/security.md, decision 3a of 22. 10. 2026). Pure: the
 * rules, the bucket names and the visitor's IP. Counting is in lib/data.ts
 * (rate_limits, one row per hit, kept two days).
 *
 * Buckets hold a SHA-256 of the IP address or phone number, not the value
 * itself, so the table and its backups show no one's number at a glance.
 */
import { createHash } from "node:crypto";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface RateLimitRule {
  prefix: string;
  limit: number;
  windowMs: number;
  /** For the visitor: a friendly sentence. */
  message: string;
}

export const RATE_LIMITS = {
  /** Bookings made from one IP address. */
  bookingPerIp: {
    prefix: "booking-ip",
    limit: 5,
    windowMs: HOUR,
    message: "Z vašega omrežja je bilo v zadnji uri oddanih že več rezervacij. Poskusite znova čez eno uro ali pokličite salon.",
  },
  /** Bookings for one phone number, in any salon. */
  bookingPerPhone: {
    prefix: "booking-phone",
    limit: 3,
    windowMs: 24 * HOUR,
    message: "S to telefonsko številko so bile danes oddane že tri rezervacije. Za nov termin pokličite salon.",
  },
  /** Sign-in attempts from one IP address (salon admin and /super). */
  signInPerIp: {
    prefix: "signin-ip",
    limit: 10,
    windowMs: 15 * MINUTE,
    message: "Preveč poskusov prijave. Poskusite znova čez 15 minut.",
  },
  /** Attempts to cancel by link from one IP address. */
  cancelPerIp: {
    prefix: "cancel-ip",
    limit: 20,
    windowMs: HOUR,
    message: "Preveč poskusov. Poskusite znova čez eno uro.",
  },
} as const satisfies Record<string, RateLimitRule>;

export function rateLimitBucket(rule: RateLimitRule, value: string): string {
  return `${rule.prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * The visitor's IP address: the first entry of x-forwarded-for (set by Next.js
 * and by the hosting platform, e.g. Vercel, which overwrites what a client
 * sends), else x-real-ip. Null if there is none: then no IP limit applies,
 * rather than one shared bucket that would block everyone.
 */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}
