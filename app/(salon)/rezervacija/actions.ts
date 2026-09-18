"use server";

import { redirect } from "next/navigation";
import { getCurrentSalon, isBookable } from "@/lib/current-salon";
import { createBooking, getFreeSlots } from "@/lib/data";
import { localDay } from "@/lib/format";

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?\d{8,15}$/;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Creates the booking. Runs on the server only (CLAUDE.md): the salon comes
 * from the request host, never from the form, and no price or end time is
 * accepted from the browser. The form only says which service, which staff
 * (or "any") and which start time.
 *
 * TODO(week 6): validate with Zod, add rate limiting and Turnstile.
 */
export async function submitBooking(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = {
    first_name: text(formData, "first_name"),
    last_name: text(formData, "last_name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    note: text(formData, "note"),
    terms: formData.get("terms") === "on" ? "on" : "",
    marketing: formData.get("marketing") === "on" ? "on" : "",
  };

  const errors: Partial<Record<FieldName, string>> = {};
  if (!values.first_name) errors.first_name = "Vpišite ime.";
  else if (values.first_name.length > 60) errors.first_name = "Ime je predolgo.";
  if (values.last_name.length > 60) errors.last_name = "Priimek je predolg.";

  const phone = values.phone.replace(/[\s\-().\/]/g, "");
  if (!PHONE.test(phone)) errors.phone = "Vpišite veljavno telefonsko številko.";

  if (!EMAIL.test(values.email) || values.email.length > 254) {
    errors.email = "Vpišite veljaven e-poštni naslov.";
  }
  if (values.note.length > 500) errors.note = "Opomba je predolga (največ 500 znakov).";
  if (!values.terms) errors.terms = "Za rezervacijo se morate strinjati s pogoji.";

  if (Object.keys(errors).length > 0) return { errors, values };

  const salon = await getCurrentSalon();
  if (!salon || !isBookable(salon)) {
    return { message: "Naročanje trenutno ni mogoče.", values };
  }

  const serviceId = text(formData, "service");
  const staffParam = text(formData, "staff");
  const start = new Date(text(formData, "time"));
  if (!serviceId || !staffParam || Number.isNaN(start.getTime())) {
    return { message: "Nekaj je šlo narobe. Začnite znova.", values, pickAnotherTime: true };
  }

  // "Anyone available": pick whoever is free at that start time.
  let staffId = staffParam;
  if (staffParam === "any") {
    const slots = await getFreeSlots({
      salon_id: salon.id,
      service_id: serviceId,
      staff_id: null,
      day: localDay(start, salon.timezone),
    });
    const match = slots.find((slot) => new Date(slot.starts_at).getTime() === start.getTime());
    if (!match) {
      return { message: "Ta termin ni več na voljo. Izberite drug.", values, pickAnotherTime: true };
    }
    staffId = match.staff_id;
  }

  const result = await createBooking({
    salon_id: salon.id,
    service_id: serviceId,
    staff_id: staffId,
    starts_at: start.toISOString(),
    first_name: values.first_name,
    last_name: values.last_name || null,
    phone,
    email: values.email,
    customer_note: values.note || null,
    marketing_consent: values.marketing === "on",
    source: "online",
  });

  if (!result.ok) {
    return { message: result.error, values, pickAnotherTime: true };
  }

  // redirect() throws, so it must stay outside any try/catch.
  redirect(`/rezervacija/potrditev/${result.booking.cancel_token}`);
}
