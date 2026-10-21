"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { getAdminAccess, NO_ADMIN_ACCESS } from "@/lib/admin-access";
import { changeBookingStatus, rescheduleBooking } from "@/lib/data";
import { localDay } from "@/lib/format";
import { sendBookingConfirmation, sendCancellationNotice, sendRescheduleNotice } from "@/lib/notifications";
import { calendarHref } from "../_components/calendar-url";

export type BookingActionState = {
  ok?: boolean;
  message?: string;
  /** Outside working hours or during an absence: the admin may go ahead after confirming. */
  outsideHours?: boolean;
  values?: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const DONE: Record<string, string> = {
  confirmed: "Termin je potrjen.",
  completed: "Termin je označen kot opravljen.",
  no_show: "Termin je označen kot neprihod.",
  cancelled: "Termin je odpovedan.",
};

const StatusSchema = z.object({
  id: z.uuid(),
  to: z.enum(["confirmed", "completed", "no_show", "cancelled"]),
});

/**
 * Changes a booking's status from its sheet in the calendar. The salon comes
 * from the host and the signed-in member (lib/admin-access.ts), the rules from
 * lib/booking-status.ts, checked again in lib/data.ts. With "notify" the
 * customer gets an e-mail after the response: the real confirmation when a
 * waiting booking is confirmed, or "the salon cancelled" on a cancellation.
 */
export async function changeStatusAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const parsed = StatusSchema.safeParse({ id: text(formData, "id"), to: text(formData, "to") });
  if (!parsed.success) return { message: "Tega pri tem terminu ni mogoče narediti." };
  const notify = formData.get("notify") === "on";

  const access = await getAdminAccess();
  if (!access.ok) return { message: NO_ADMIN_ACCESS };

  const { id, to } = parsed.data;
  const result = await changeBookingStatus(access.salon.id, id, to);
  if (!result.ok) return { message: result.error };

  if (notify && to === "cancelled") after(() => sendCancellationNotice(id, undefined, "salon"));
  if (notify && to === "confirmed" && result.previous === "pending") after(() => sendBookingConfirmation(id));

  revalidatePath("/admin", "layout");
  return { ok: true, message: DONE[to] };
}

const MoveSchema = z.object({
  id: z.uuid(),
  date: z.iso.date("Izberite dan."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Vpišite uro, npr. 14:30."),
  staff: z.uuid("Izberite zaposlenega."),
  view: z.enum(["day", "week"]),
});

/**
 * Moves a booking to another day, time and/or staff member. The new local time
 * is turned into an instant in the salon's time zone (date-fns-tz). Outside
 * working hours it first asks (`outsideHours`); "force" is the admin's yes.
 * Afterwards the calendar opens on the new day with the booking selected.
 */
export async function rescheduleAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const values = {
    id: text(formData, "id"),
    date: text(formData, "date"),
    time: text(formData, "time"),
    staff: text(formData, "staff"),
    view: text(formData, "view") === "week" ? "week" : "day",
    notify: formData.get("notify") === "on" ? "on" : "",
  };
  const parsed = MoveSchema.safeParse(values);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Preverite vnos.", values };

  const access = await getAdminAccess();
  if (!access.ok) return { message: NO_ADMIN_ACCESS, values };
  const { salon } = access;

  const { id, date, time, staff, view } = parsed.data;
  const startsAt = fromZonedTime(`${date}T${time}:00`, salon.timezone);
  const result = await rescheduleBooking(
    salon.id,
    id,
    { starts_at: startsAt.toISOString(), staff_id: staff },
    { allowOutsideHours: formData.get("force") === "1" },
  );
  if (!result.ok) return { message: result.error, outsideHours: result.outsideHours, values };

  if (values.notify === "on") after(() => sendRescheduleNotice(id));
  revalidatePath("/admin", "layout");
  // redirect() throws, so it must stay outside any try/catch.
  redirect(calendarHref({ view, date: localDay(result.booking.starts_at, salon.timezone), booking: id }));
}
