/**
 * Which booking status may follow which.
 *
 * Kept apart from lib/data.ts on purpose: the admin buttons need this map in
 * the browser, and importing data.ts there would drag the Supabase server
 * client into the client bundle. Both sides import this file instead, so the
 * rule cannot drift between what a button offers and what the server accepts.
 */
import type { BookingStatus } from "./types";

/** A finished, cancelled or missed booking is final; make a new one instead. */
export const ALLOWED_STATUS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled", "no_show"],
  confirmed: ["completed", "cancelled", "no_show"],
  cancelled: [],
  no_show: [],
  completed: [],
};

export function canChangeTo(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_STATUS[from].includes(to);
}

/** What the button says, as opposed to what the badge says the state is. */
export const STATUS_ACTION: Record<BookingStatus, string> = {
  pending: "Vrni v čakanje",
  confirmed: "Potrdi",
  cancelled: "Odpovej",
  no_show: "Ni prišel",
  completed: "Opravljeno",
};

/** Cancelling and marking a no-show are the destructive ones. */
export const STATUS_IS_DESTRUCTIVE: Record<BookingStatus, boolean> = {
  pending: false,
  confirmed: false,
  cancelled: true,
  no_show: true,
  completed: false,
};
