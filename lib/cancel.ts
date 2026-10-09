/**
 * When a customer may cancel online: the booking is still pending or confirmed
 * and its start is MORE than salons.cancel_window_hours away. Exactly at the
 * deadline it is too late. Pure (no clock, no database): `now` is a parameter.
 * The database update in lib/data.ts checks the same rule again.
 */
import type { Booking, BookingStatus } from "./types";

const CANCELLABLE: BookingStatus[] = ["pending", "confirmed"];

/** The last moment to cancel online: start minus the window. */
export function cancelDeadline(startsAt: string, windowHours: number): Date {
  return new Date(Date.parse(startsAt) - windowHours * 3_600_000);
}

export function canCancel(booking: Pick<Booking, "status" | "starts_at">, windowHours: number, now: Date): boolean {
  return CANCELLABLE.includes(booking.status) && now.getTime() < cancelDeadline(booking.starts_at, windowHours).getTime();
}
