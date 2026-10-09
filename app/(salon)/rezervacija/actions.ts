"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentSalon, isBookable } from "@/lib/current-salon";
import { BOOKING_MESSAGES, createBooking, getFreeSlots } from "@/lib/data";
import { localDay } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";

export type FieldName = "first_name" | "last_name" | "phone" | "email" | "note" | "terms";

export type FormState = {
  /** A friendly sentence for the visitor. Never technical details. */
  message?: string;
  errors?: Partial<Record<FieldName, string>>;
  /** What the visitor typed, so the form can be filled in again. */
  values: Record<string, string>;
  /** Set when the chosen time is gone: where to pick another one. */
  pickAnotherTime?: boolean;
} | null;

/** What the visitor typed. Messages are shown next to the fields. */
const ContactSchema = z.object({
  first_name: z.string().trim().min(1, "Vpišite ime.").max(60, "Ime je predolgo."),
  last_name: z.string().trim().max(60, "Priimek je predolg."),
  // Stored as E.164 ("+38640123456"), so the same person is always the same customer.
  phone: z
    .string()
    .trim()
    .max(40, "Vpišite veljavno telefonsko številko, npr. 040 123 456.")
    .transform((value, ctx) => {
      const phone = normalizePhone(value);
      if (!phone) {
        ctx.addIssue({ code: "custom", message: "Vpišite veljavno telefonsko številko, npr. 040 123 456." });
        return z.NEVER;
      }
      return phone;
    }),
  email: z
    .string()
    .trim()
    .max(254, "Vpišite veljaven e-poštni naslov.")
    .pipe(z.email("Vpišite veljaven e-poštni naslov.")),
  note: z.string().trim().max(500, "Opomba je predolga (največ 500 znakov)."),
  terms: z.literal("on", { error: "Za rezervacijo se morate strinjati s pogoji." }),
  marketing: z.enum(["on", ""]),
});

/** The hidden fields: which service, who ("any" or a staff id) and when. */
const ChoiceSchema = z.object({
  service: z.uuid(),
  staff: z.union([z.uuid(), z.literal("any")]),
  time: z.iso.datetime({ offset: true }),
});

const FIELD_NAMES: FieldName[] = ["first_name", "last_name", "phone", "email", "note", "terms"];

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Creates the booking. Runs on the server only (CLAUDE.md): the salon comes
 * from the request host, never from the form, and no price or end time is
 * accepted from the browser. The form only says which service, which staff
 * (or "any") and which start time; lib/data.ts createBooking checks all of it
 * again against the database.
 *
 * TODO(week 11): rate limiting and Turnstile (specs/security.md).
 */
export async function submitBooking(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = {
    first_name: text(formData, "first_name").trim(),
    last_name: text(formData, "last_name").trim(),
    phone: text(formData, "phone").trim(),
    email: text(formData, "email").trim(),
    note: text(formData, "note").trim(),
    terms: text(formData, "terms") === "on" ? "on" : "",
    marketing: text(formData, "marketing") === "on" ? "on" : "",
  };

  const contact = ContactSchema.safeParse(values);
  if (!contact.success) {
    const fieldErrors = z.flattenError(contact.error).fieldErrors as Partial<Record<string, string[]>>;
    const errors: Partial<Record<FieldName, string>> = {};
    for (const name of FIELD_NAMES) {
      const message = fieldErrors[name]?.[0];
      if (message) errors[name] = message;
    }
    return { errors, values };
  }

  // A database outage must not throw away what the visitor typed: every read
  // here returns a friendly sentence instead of reaching the error page.
  let salon: Awaited<ReturnType<typeof getCurrentSalon>>;
  try {
    salon = await getCurrentSalon();
  } catch {
    return { message: BOOKING_MESSAGES.failed, values };
  }
  if (!salon || !isBookable(salon)) {
    return { message: "Naročanje trenutno ni mogoče.", values };
  }

  const choice = ChoiceSchema.safeParse({
    service: text(formData, "service"),
    staff: text(formData, "staff"),
    time: text(formData, "time"),
  });
  if (!choice.success) {
    return { message: "Nekaj je šlo narobe. Začnite znova.", values, pickAnotherTime: true };
  }

  const { service, staff, time } = choice.data;
  const start = new Date(time);

  // "Anyone available": everyone free at that start time, in display order. If
  // the first is taken in the meantime, the next one gets the booking.
  let candidates = [staff];
  if (staff === "any") {
    let slots: Awaited<ReturnType<typeof getFreeSlots>>;
    try {
      slots = await getFreeSlots({
        salon_id: salon.id,
        service_id: service,
        staff_id: null,
        day: localDay(start, salon.timezone),
      });
    } catch {
      return { message: BOOKING_MESSAGES.failed, values };
    }
    candidates = slots.filter((slot) => Date.parse(slot.starts_at) === start.getTime()).map((slot) => slot.staff_id);
    if (candidates.length === 0) {
      return { message: BOOKING_MESSAGES.unavailable, values, pickAnotherTime: true };
    }
  }

  let lastError: string = BOOKING_MESSAGES.unavailable;
  for (const staffId of candidates) {
    const result = await createBooking({
      salon_id: salon.id,
      service_id: service,
      staff_id: staffId,
      starts_at: start.toISOString(),
      first_name: contact.data.first_name,
      last_name: contact.data.last_name || null,
      phone: contact.data.phone,
      email: contact.data.email,
      customer_note: contact.data.note || null,
      marketing_consent: contact.data.marketing === "on",
      source: "online",
    });
    if (result.ok) {
      // redirect() throws, so it must stay outside any try/catch.
      redirect(`/rezervacija/potrditev/${result.booking.cancel_token}`);
    }
    lastError = result.error;
    // Only a time that is gone is worth trying with the next person; anything else is final.
    if (result.error !== BOOKING_MESSAGES.taken && result.error !== BOOKING_MESSAGES.unavailable) break;
  }

  return { message: lastError, values, pickAnotherTime: true };
}
