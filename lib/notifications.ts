/**
 * Messages to customers about their booking. Each message is sent at most once:
 * its booking_notifications row is claimed first (status "pending"; unique per
 * booking, kind and channel), then the e-mail goes out, then the row says
 * "sent" (with Resend's id) or "failed". A failed e-mail never undoes or
 * blocks a booking or a cancellation.
 *
 * Logs say which step failed, never an e-mail address or a name.
 */
import "server-only";
import { claimNotification, finishNotification, getNotificationData } from "./data";
import { cancellationEmail, confirmationEmail, emailConfigured, sendEmail, type BookingEmailData, type RenderedEmail } from "./email";
import type { BookingStatus, NotificationKind } from "./types";

export interface NotifyDeps {
  send: typeof sendEmail;
  now: () => Date;
}

const defaultDeps: NotifyDeps = { send: (message) => sendEmail(message), now: () => new Date() };

interface Message {
  kind: NotificationKind;
  /** Sent only while the booking has one of these statuses. */
  statuses: BookingStatus[];
  render: (data: BookingEmailData, now: Date) => RenderedEmail;
}

const CONFIRMATION: Message = { kind: "confirmation", statuses: ["confirmed", "pending"], render: confirmationEmail };
const CANCELLATION: Message = { kind: "cancellation", statuses: ["cancelled"], render: cancellationEmail };

async function notify(message: Message, bookingId: string, deps: NotifyDeps): Promise<void> {
  try {
    if (!emailConfigured()) {
      console.warn(`[notify] e-mail is not configured (RESEND_API_KEY, EMAIL_FROM): no ${message.kind} sent`);
      return;
    }
    const data = await getNotificationData(bookingId);
    if (!data?.to) return; // no booking, or no e-mail to send to
    if (!message.statuses.includes(data.booking.status)) return;

    const claim = await claimNotification(data.salonId, data.bookingId, message.kind);
    if (!claim) return; // already sent (or being sent) by someone else

    const email = message.render(data, deps.now());
    const result = await deps.send({ ...email, to: data.to, idempotencyKey: `${message.kind}:${data.bookingId}` });
    await finishNotification(claim, result.ok ? "sent" : "failed", result.ok ? result.id : null);
    if (!result.ok) console.error(`[notify] ${message.kind} for booking ${data.bookingId} not sent: ${result.reason}`);
  } catch (error) {
    console.error(`[notify] ${message.kind} for booking ${bookingId} failed: ${error instanceof Error ? error.message : "?"}`);
  }
}

/**
 * The confirmation e-mail right after a booking (or the "request received"
 * version when the salon confirms by hand). Called with after() from the
 * booking action, so the visitor does not wait for it. Never throws.
 */
export function sendBookingConfirmation(bookingId: string, deps: NotifyDeps = defaultDeps): Promise<void> {
  return notify(CONFIRMATION, bookingId, deps);
}

/**
 * "Your booking is cancelled", after the customer cancelled with the link.
 * Only for a booking that really is cancelled. Called with after(). Never throws.
 */
export function sendCancellationNotice(bookingId: string, deps: NotifyDeps = defaultDeps): Promise<void> {
  return notify(CANCELLATION, bookingId, deps);
}
