/**
 * Messages to customers about their booking. Each message is sent at most once:
 * its booking_notifications row is claimed first (status "pending"; unique per
 * booking, kind and channel), then the e-mail goes out, then the row says
 * "sent" (with Resend's id) or "failed". A failed e-mail never undoes or
 * blocks a booking.
 *
 * Logs say which step failed, never an e-mail address or a name.
 */
import "server-only";
import { claimNotification, finishNotification, getNotificationData } from "./data";
import { confirmationEmail, emailConfigured, sendEmail } from "./email";

export interface NotifyDeps {
  send: typeof sendEmail;
  now: () => Date;
}

const defaultDeps: NotifyDeps = { send: (message) => sendEmail(message), now: () => new Date() };

/**
 * The confirmation e-mail right after a booking (or the "request received"
 * version when the salon confirms by hand). Called with after() from the
 * booking action, so the visitor does not wait for it. Never throws.
 */
export async function sendBookingConfirmation(bookingId: string, deps: NotifyDeps = defaultDeps): Promise<void> {
  try {
    if (!emailConfigured()) {
      console.warn("[notify] e-mail is not configured (RESEND_API_KEY, EMAIL_FROM): no confirmation sent");
      return;
    }
    const data = await getNotificationData(bookingId);
    if (!data?.to) return; // no booking, or no e-mail to send to
    if (data.booking.status !== "confirmed" && data.booking.status !== "pending") return;

    const claim = await claimNotification(data.salonId, data.bookingId, "confirmation");
    if (!claim) return; // already sent (or being sent) by someone else

    const email = confirmationEmail(data, deps.now());
    const result = await deps.send({ ...email, to: data.to, idempotencyKey: `confirmation:${data.bookingId}` });
    await finishNotification(claim, result.ok ? "sent" : "failed", result.ok ? result.id : null);
    if (!result.ok) console.error(`[notify] confirmation for booking ${data.bookingId} not sent: ${result.reason}`);
  } catch (error) {
    console.error(`[notify] confirmation for booking ${bookingId} failed: ${error instanceof Error ? error.message : "?"}`);
  }
}
