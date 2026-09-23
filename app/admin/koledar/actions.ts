"use server";

import { revalidatePath } from "next/cache";
import { getSignedInStaff, NOT_SIGNED_IN } from "@/lib/auth";
import { getCurrentSalon } from "@/lib/current-salon";
import { setBookingInternalNote, setBookingStatus } from "@/lib/data";
import type { BookingStatus } from "@/lib/types";

export type BookingActionState = { ok?: boolean; message: string } | null;

const STATUSES: BookingStatus[] = [
  "pending",
  "confirmed",
  "cancelled",
  "no_show",
  "completed",
];

function isStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && (STATUSES as string[]).includes(value);
}

/**
 * Moves a booking to another status from the calendar sheet.
 *
 * The salon comes from the request host, never from the form, so a booking id
 * from another salon simply is not found.
 */
export async function changeBookingStatus(
  _previous: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const id = formData.get("id");
  const status = formData.get("status");
  if (typeof id !== "string" || !isStatus(status)) {
    return { message: "Rezervacije ni mogoče spremeniti." };
  }

  // Checked here too: a server action is its own endpoint and can be posted to
  // without ever loading the admin page that normally guards it.
  const staff = await getSignedInStaff();
  if (!staff) return { message: NOT_SIGNED_IN };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti." };

  const result = await setBookingStatus(salon.id, id, status);
  if (!result.ok) return { message: result.error };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Shranjeno." };
}

/** The salon's private note on a booking. The customer never sees it. */
export async function saveInternalNote(
  _previous: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const id = formData.get("id");
  const note = formData.get("internal_note");
  if (typeof id !== "string") return { message: "Rezervacije ni mogoče spremeniti." };

  // Checked here too: a server action is its own endpoint and can be posted to
  // without ever loading the admin page that normally guards it.
  const staff = await getSignedInStaff();
  if (!staff) return { message: NOT_SIGNED_IN };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti." };

  const result = await setBookingInternalNote(
    salon.id,
    id,
    typeof note === "string" ? note : null,
  );
  if (!result.ok) return { message: result.error };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Zaznamek je shranjen." };
}
