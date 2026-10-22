/**
 * Messages to customers about their booking. Each message is sent at most once:
 * its booking_notifications row is claimed first (status "pending"; unique per
 * booking, kind and channel, except "reschedule", 006), then the e-mail goes
 * out, then the row says "sent" (with Resend's id) or "failed". A failed
 * e-mail never undoes or blocks a booking, a cancellation or a move.
 *
 * Logs say which step failed, never an e-mail address or a name.
 */
import "server-only";
import { claimNotification, finishNotification, getNotificationData, type NotificationData } from "./data";
import {
  cancellationEmail,
  confirmationEmail,
  emailConfigured,
  reminderEmail,
  rescheduleEmail,
  sendEmail,
  type RenderedEmail,
} from "./email";
import type { BookingStatus, NotificationKind } from "./types";

export interface NotifyDeps {
  send: typeof sendEmail;
  now: () => Date;
}

const defaultDeps: NotifyDeps = { send: (message) => sendEmail(message), now: () => new Date() };

interface Message {
  /** booking_notifications.kind for this booking. */
  kind: (data: NotificationData) => NotificationKind;
  /** Sent only while the booking has one of these statuses. */
  statuses: BookingStatus[];
  render: (data: NotificationData, now: Date) => RenderedEmail;
  /** Resend's idempotency key: one e-mail per key within 24 h. */
  key: (data: NotificationData, kind: NotificationKind) => string;
}

const oncePerBooking = (data: NotificationData, kind: NotificationKind) => `${kind}:${data.bookingId}`;

/** "Request received" while the salon still has to confirm (006: "request"), else the confirmation. */
const CONFIRMATION: Message = {
  kind: (data) => (data.booking.status === "pending" ? "request" : "confirmation"),
  statuses: ["confirmed", "pending"],
  render: confirmationEmail,
  key: oncePerBooking,
};

const cancellation = (by: "customer" | "salon"): Message => ({
  kind: () => "cancellation",
  statuses: ["cancelled"],
  render: (data, now) => cancellationEmail(data, now, by),
  key: oncePerBooking,
});

/** Some hours before a confirmed booking (app/api/cron/reminders). Once per booking. */
const REMINDER: Message = {
  kind: () => "reminder",
  statuses: ["confirmed"],
  render: reminderEmail,
  key: oncePerBooking,
};

/** A booking can be moved more than once: one e-mail per new time. */
const RESCHEDULE: Message = {
  kind: () => "reschedule",
  statuses: ["confirmed", "pending"],
  render: rescheduleEmail,
  key: (data, kind) => `${kind}:${data.bookingId}:${data.booking.starts_at}:${data.staffName}`,
};

/** What happened to one message (the cron reports the counts; nothing personal). */
export type NotifyOutcome = "sent" | "failed" | "skipped";

async function notify(message: Message, bookingId: string, deps: NotifyDeps): Promise<NotifyOutcome> {
  try {
    if (!emailConfigured()) {
      console.warn("[notify] e-mail is not configured (RESEND_API_KEY, EMAIL_FROM): nothing sent");
      return "skipped";
    }
    const data = await getNotificationData(bookingId);
    if (!data?.to) return "skipped"; // no booking, or no e-mail to send to
    if (!message.statuses.includes(data.booking.status)) return "skipped";

    const kind = message.kind(data);
    const claim = await claimNotification(data.salonId, data.bookingId, kind);
    if (!claim) return "skipped"; // already sent (or being sent) by someone else

    const email = message.render(data, deps.now());
    const result = await deps.send({ ...email, to: data.to, idempotencyKey: message.key(data, kind) });
    await finishNotification(claim, result.ok ? "sent" : "failed", result.ok ? result.id : null);
    if (!result.ok) console.error(`[notify] ${kind} for booking ${data.bookingId} not sent: ${result.reason}`);
    return result.ok ? "sent" : "failed";
  } catch (error) {
    console.error(`[notify] message for booking ${bookingId} failed: ${error instanceof Error ? error.message : "?"}`);
    return "failed";
  }
}

/**
 * The confirmation right after a booking, or the "request received" version
 * while the salon confirms by hand; called again when the salon confirms such
 * a booking, it sends the real confirmation. Called with after(). Never throws.
 */
export async function sendBookingConfirmation(bookingId: string, deps: NotifyDeps = defaultDeps): Promise<void> {
  await notify(CONFIRMATION, bookingId, deps);
}

/** The reminder before a confirmed booking, at most once. Never throws. */
export function sendReminder(bookingId: string, deps: NotifyDeps = defaultDeps): Promise<NotifyOutcome> {
  return notify(REMINDER, bookingId, deps);
}

/**
 * "Your booking is cancelled", only for a booking that really is cancelled.
 * `by`: the customer (cancel link) or the salon (admin). Never throws.
 */
export async function sendCancellationNotice(
  bookingId: string,
  deps: NotifyDeps = defaultDeps,
  by: "customer" | "salon" = "customer",
): Promise<void> {
  await notify(cancellation(by), bookingId, deps);
}

/** "Your booking was moved", with the new time and staff member. Never throws. */
export async function sendRescheduleNotice(bookingId: string, deps: NotifyDeps = defaultDeps): Promise<void> {
  await notify(RESCHEDULE, bookingId, deps);
}
