"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSalon } from "@/lib/current-salon";
import { cancelBookingByToken, getBookingByCancelToken } from "@/lib/data";

export type CancelState = { error: string } | null;

/**
 * Cancels the booking behind the token in the link.
 *
 * The token arrives in a hidden field rather than from the URL, and the booking
 * must belong to the salon of THIS host: a token from another salon's e-mail
 * cannot be used on this subdomain.
 */
export async function cancelBooking(
  _previous: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const token = formData.get("token");
  if (typeof token !== "string" || !token) {
    return { error: "Termina ni mogoče najti." };
  }

  const salon = await getCurrentSalon();
  const booking = await getBookingByCancelToken(token);
  if (!salon || !booking || booking.salon_id !== salon.id) {
    return { error: "Termina ni mogoče najti." };
  }

  const result = await cancelBookingByToken(token);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/rezervacija/potrditev/${token}`);
  return null;
}
