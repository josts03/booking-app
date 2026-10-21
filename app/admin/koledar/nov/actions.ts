"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { getAdminAccess, NO_ADMIN_ACCESS } from "@/lib/admin-access";
import { createManualBooking } from "@/lib/data";
import { sendBookingConfirmation } from "@/lib/notifications";
import { normalizePhone } from "@/lib/phone";
import type { ManualBookingInput } from "@/lib/types";
import { calendarHref } from "../../_components/calendar-url";

export type NewBookingField = "first_name" | "last_name" | "phone" | "email" | "service" | "staff" | "date" | "time" | "note";

export type NewBookingState = {
  message?: string;
  /** Outside working hours or during an absence: "force" saves it anyway. */
  outsideHours?: boolean;
  errors?: Partial<Record<NewBookingField, string>>;
  values: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const PlaceSchema = z.object({
  service: z.uuid("Izberite storitev."),
  staff: z.uuid("Izberite zaposlenega."),
  date: z.iso.date("Izberite dan."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Vpišite uro, npr. 14:30."),
  note: z.string().max(1000, "Opomba je predolga."),
});

/** A new customer typed in by the salon: phone required (it identifies the customer), e-mail optional. */
const NewCustomerSchema = z.object({
  first_name: z.string().min(1, "Vpišite ime.").max(60, "Ime je predolgo."),
  last_name: z.string().max(60, "Priimek je predolg."),
  phone: z
    .string()
    .max(40, "Vpišite veljavno številko, npr. 040 123 456.")
    .transform((value, ctx) => {
      const phone = normalizePhone(value);
      if (!phone) {
        ctx.addIssue({ code: "custom", message: "Vpišite veljavno številko, npr. 040 123 456." });
        return z.NEVER;
      }
      return phone;
    }),
  email: z.union([z.literal(""), z.string().max(254).pipe(z.email("Vpišite veljaven e-naslov."))]),
});

/**
 * A booking entered by the salon (phone call, walk-in, afterwards). Checks
 * everything on the server: access, input (Zod), and in lib/data.ts that the
 * service, staff and customer belong to this salon, the price from the
 * database and the overlap rule, which is never skipped. Outside working
 * hours the form asks first. Afterwards the calendar opens on that day with
 * the new booking selected.
 */
export async function createBookingAction(_previous: NewBookingState, formData: FormData): Promise<NewBookingState> {
  const values = {
    customer_id: text(formData, "customer_id"),
    first_name: text(formData, "first_name"),
    last_name: text(formData, "last_name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    service: text(formData, "service"),
    staff: text(formData, "staff"),
    date: text(formData, "date"),
    time: text(formData, "time"),
    note: text(formData, "note"),
    notify: formData.get("notify") === "on" ? "on" : "",
  };

  const errors: Partial<Record<NewBookingField, string>> = {};
  const place = PlaceSchema.safeParse(values);
  if (!place.success) {
    for (const issue of place.error.issues) errors[issue.path[0] as NewBookingField] ??= issue.message;
  }

  let customer: ManualBookingInput["customer"] | null = null;
  if (values.customer_id) {
    const id = z.uuid().safeParse(values.customer_id);
    if (id.success) customer = { id: id.data };
    else return { message: "Stranke ni mogoče najti. Izberite jo znova.", values };
  } else {
    const typed = NewCustomerSchema.safeParse(values);
    if (typed.success) {
      customer = {
        first_name: typed.data.first_name,
        last_name: typed.data.last_name || null,
        phone: typed.data.phone,
        email: typed.data.email || null,
      };
    } else {
      for (const issue of typed.error.issues) errors[issue.path[0] as NewBookingField] ??= issue.message;
    }
  }
  if (Object.keys(errors).length > 0 || !place.success || !customer) return { errors, values };

  const access = await getAdminAccess();
  if (!access.ok) return { message: NO_ADMIN_ACCESS, values };
  const { salon } = access;

  const startsAt = fromZonedTime(`${place.data.date}T${place.data.time}:00`, salon.timezone);
  const result = await createManualBooking(
    salon.id,
    {
      service_id: place.data.service,
      staff_id: place.data.staff,
      starts_at: startsAt.toISOString(),
      customer,
      customer_note: null,
      internal_note: place.data.note || null,
    },
    { allowOutsideHours: formData.get("force") === "1" },
  );
  if (!result.ok) return { message: result.error, outsideHours: result.outsideHours, values };

  // A confirmation only goes out if the customer has an e-mail (lib/notifications.ts checks).
  const bookingId = result.booking.id;
  if (values.notify === "on") after(() => sendBookingConfirmation(bookingId));
  revalidatePath("/admin", "layout");
  // redirect() throws, so it must stay outside any try/catch.
  redirect(calendarHref({ view: "day", date: place.data.date, booking: bookingId }));
}
