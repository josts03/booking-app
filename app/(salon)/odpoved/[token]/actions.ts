"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { getCurrentSalon, isBookable } from "@/lib/current-salon";
import { cancelBookingByToken, noteRateLimitHit, rateLimitReached } from "@/lib/data";
import { sendCancellationNotice } from "@/lib/notifications";
import { clientIp, RATE_LIMITS, rateLimitBucket } from "@/lib/rate-limit";

export type CancelState = { message: string } | null;

const MESSAGES = {
  "not-found": "Rezervacije ni mogoče najti. Preverite povezavo iz e-pošte.",
  "not-active": "Ta termin ni več aktiven.",
  "too-late": "Roka za odpoved prek spleta je žal že potekel. Pokličite salon.",
  failed: "Odpovedi trenutno ni mogoče shraniti. Poskusite znova čez nekaj minut.",
} as const;

/**
 * Cancels the booking of the link. Runs on the server: the salon comes from
 * the host, the token is compared in full, and the deadline is checked again
 * in the database (lib/data.ts cancelBookingByToken), whatever the page showed.
 * At most 20 attempts per IP address an hour (specs/security.md).
 */
export async function cancelBookingAction(_previous: CancelState, formData: FormData): Promise<CancelState> {
  const ip = clientIp(await headers());
  if (ip) {
    const now = new Date();
    const bucket = rateLimitBucket(RATE_LIMITS.cancelPerIp, ip);
    if (await rateLimitReached(bucket, RATE_LIMITS.cancelPerIp, now)) return { message: RATE_LIMITS.cancelPerIp.message };
    await noteRateLimitHit(bucket, now);
  }

  const token = z.uuid().safeParse(formData.get("token"));
  if (!token.success) return { message: MESSAGES["not-found"] };

  let salon: Awaited<ReturnType<typeof getCurrentSalon>>;
  try {
    salon = await getCurrentSalon();
  } catch {
    return { message: MESSAGES.failed };
  }
  if (!salon || !isBookable(salon)) return { message: "Odpoved prek spleta trenutno ni mogoča. Pokličite salon." };

  const result = await cancelBookingByToken(salon.id, token.data);
  if (!result.ok) return { message: MESSAGES[result.reason] };

  // "Your booking is cancelled" by e-mail, after the response (the customer does not wait).
  const bookingId = result.booking.id;
  after(() => sendCancellationNotice(bookingId));

  // redirect() throws, so it must stay outside any try/catch.
  redirect(`/odpoved/${token.data}?odpovedano=1`);
}
