import { createHash, timingSafeEqual } from "node:crypto";
import { anonymizeInactiveCustomers, deleteOldRateLimitHits, getDueReminders } from "@/lib/data";
import { sendReminder } from "@/lib/notifications";

/**
 * The hourly job (decision 1b: called by cron-job.org; Vercel Cron would call it
 * the same way). Only with "Authorization: Bearer <CRON_SECRET>".
 *
 * 1. Reminders: confirmed bookings due by the salon's reminder_hours_before
 *    (lib/data.ts getDueReminders), each sent at most once.
 * 2. Retention: customers without a booking in three years are anonymized.
 * 3. rate_limits: hits older than two days are removed.
 *
 * Answers with counts only, nothing personal. A step that fails does not stop
 * the others; the answer is then 500, so the cron service reports it. Without
 * the right secret the answer is always the same 401, also when CRON_SECRET is
 * not set at all: the log says which (security review, finding 6).
 */

/** Up to a minute per run; e-mails go out one by one. */
export const maxDuration = 60;

/** Resend allows two requests a second. 60 a run x 0.6 s fits the minute; the rest come next hour. */
const REMINDERS_PER_RUN = 60;
const SEND_SPACING_MS = 600;
const RATE_LIMIT_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Compares in constant time (hashes first, so the lengths are equal too). */
function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  return timingSafeEqual(sha256(header), sha256(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) console.error("[cron] CRON_SECRET is not set: the job does not run");
  if (!secret || !authorized(request, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const errors: string[] = [];
  const reminders = { due: 0, sent: 0, failed: 0, skipped: 0 };
  let anonymized = 0;
  let rateLimitsDeleted = 0;

  try {
    const due = await getDueReminders(now, REMINDERS_PER_RUN);
    reminders.due = due.length;
    for (const bookingId of due) {
      const outcome = await sendReminder(bookingId);
      reminders[outcome] += 1;
      if (outcome !== "skipped") await new Promise((resolve) => setTimeout(resolve, SEND_SPACING_MS));
    }
  } catch {
    errors.push("reminders");
  }
  try {
    anonymized = await anonymizeInactiveCustomers(now);
  } catch {
    errors.push("retention");
  }
  try {
    rateLimitsDeleted = await deleteOldRateLimitHits(new Date(now.getTime() - RATE_LIMIT_KEEP_MS));
  } catch {
    errors.push("cleanup");
  }

  return Response.json(
    { reminders, anonymized, cleaned: rateLimitsDeleted, errors },
    { status: errors.length ? 500 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
