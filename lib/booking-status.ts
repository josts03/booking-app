/**
 * Which status a booking may move to from the admin, and what the buttons say.
 * Pure (no clock: `now` is a parameter) and safe for the browser, so the
 * buttons the admin sees and the rule the server enforces (lib/data.ts
 * changeBookingStatus) cannot drift apart.
 *
 * Decisions of 21. 10. 2026:
 * - "completed" and "no_show" only once the booking has started;
 * - both can be undone back to "confirmed" (a mistapped button on the phone);
 * - "cancelled" is final: the customer was told, so a new booking is made instead.
 */
import type { Booking, BookingStatus } from "./types";

export const NEXT_STATUSES: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled"],
  completed: ["confirmed"],
  no_show: ["confirmed"],
  cancelled: [],
};

/** What the status is called (badge, calendar, CSV export). */
export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Čaka potrditev",
  confirmed: "Potrjeno",
  cancelled: "Odpovedano",
  no_show: "Neprihod",
  completed: "Opravljeno",
};

/** Statuses that describe what happened, so they need the appointment to have begun. */
const AFTER_START: BookingStatus[] = ["completed", "no_show"];

/** Statuses whose booking can still be moved to another time or staff member. */
export const MOVABLE: BookingStatus[] = ["pending", "confirmed"];

export function canChangeStatus(
  booking: Pick<Booking, "status" | "starts_at">,
  to: BookingStatus,
  now: Date,
): boolean {
  if (!NEXT_STATUSES[booking.status].includes(to)) return false;
  if (AFTER_START.includes(to) && Date.parse(booking.starts_at) > now.getTime()) return false;
  return true;
}

/** The status changes to offer as buttons, in button order. */
export function statusChanges(booking: Pick<Booking, "status" | "starts_at">, now: Date): BookingStatus[] {
  return NEXT_STATUSES[booking.status].filter((to) => canChangeStatus(booking, to, now));
}

/** What the button says (the badge says what the state is: components/status-badge). */
export function statusActionLabel(from: BookingStatus, to: BookingStatus): string {
  if (to === "confirmed") return from === "pending" ? "Potrdi" : "Vrni na potrjeno";
  if (to === "completed") return "Opravljeno";
  if (to === "no_show") return "Ni prišel";
  if (to === "cancelled") return "Odpovej";
  return "Čaka potrditev";
}

/** Changes that are hard to take back: the admin confirms them first. */
export function needsConfirmation(to: BookingStatus): boolean {
  return to === "cancelled" || to === "no_show";
}
