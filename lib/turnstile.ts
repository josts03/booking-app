/**
 * Cloudflare Turnstile on the public booking form (specs/security.md, decision
 * 4a of 22. 10. 2026). The widget gives the browser a one-time token; the
 * server checks it with Cloudflare (siteverify) before it books anything. Plain
 * fetch, no library.
 *
 * Without TURNSTILE_SECRET_KEY: skipped in development and tests, refused in
 * production, so the protection can never be off on the live site by mistake.
 * If Cloudflare cannot be reached, the booking is refused as well (a bot must
 * not get through just because the check is down). Never logs the token.
 */
import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 10_000;
/** Cloudflare: a token is at most 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileResult =
  | "ok"
  /** Not configured, development or tests: no check. */
  | "skipped"
  /** The visitor sent no token (the widget did not finish). */
  | "missing"
  /** Cloudflare says no (expired, used twice, or a bot). */
  | "invalid"
  /** Cloudflare unreachable, or not configured in production. */
  | "unavailable";

export interface TurnstileDeps {
  fetch: typeof fetch;
}

const defaultDeps: TurnstileDeps = { fetch: (input, init) => fetch(input, init) };

export const TURNSTILE_MESSAGES = {
  missing: "Počakajte, da se preverjanje »Nisem robot« zaključi, nato znova kliknite Potrdi rezervacijo.",
  invalid: "Preverjanje »Nisem robot« ni uspelo. Poskusite znova.",
  unavailable: "Naročanje prek spleta trenutno ni mogoče. Poskusite znova čez nekaj minut ali pokličite salon.",
} as const;

export async function verifyTurnstile(
  token: string,
  ip: string | null,
  deps: TurnstileDeps = defaultDeps,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[turnstile] TURNSTILE_SECRET_KEY is not set: public bookings are refused");
      return "unavailable";
    }
    return "skipped";
  }
  if (!token || token.length > MAX_TOKEN_LENGTH) return "missing";

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const response = await deps.fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error(`[turnstile] siteverify answered ${response.status}`);
      return "unavailable";
    }
    const result = (await response.json().catch(() => null)) as { success?: unknown; "error-codes"?: unknown } | null;
    if (result?.success === true) return "ok";
    const codes = Array.isArray(result?.["error-codes"]) ? result["error-codes"].join(",") : "";
    console.warn(`[turnstile] token refused: ${codes}`);
    return "invalid";
  } catch (error) {
    console.error(`[turnstile] siteverify failed: ${error instanceof Error ? error.name : "network error"}`);
    return "unavailable";
  }
}
