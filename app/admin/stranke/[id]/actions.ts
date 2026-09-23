"use server";

import { revalidatePath } from "next/cache";
import { getSignedInStaff, NOT_SIGNED_IN } from "@/lib/auth";
import { getCurrentSalon } from "@/lib/current-salon";
import { anonymizeCustomer, updateCustomer } from "@/lib/data";

export type CustomerField = "first_name" | "last_name" | "phone" | "email" | "notes";

export type CustomerFormState = {
  ok?: boolean;
  message?: string;
  errors?: Partial<Record<CustomerField, string>>;
  values: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Saves the salon's own record of a customer.
 */
export async function saveCustomer(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const values = {
    id: text(formData, "id"),
    first_name: text(formData, "first_name"),
    last_name: text(formData, "last_name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    notes: text(formData, "notes"),
    marketing_consent: formData.get("marketing_consent") === "on" ? "on" : "",
  };

  const errors: Partial<Record<CustomerField, string>> = {};
  if (!values.first_name) errors.first_name = "Vpišite ime.";
  else if (values.first_name.length > 80) errors.first_name = "Ime je predolgo.";
  if (values.last_name.length > 80) errors.last_name = "Priimek je predolg.";
  if (values.notes.length > 2000) errors.notes = "Opomba je predolga.";
  if (Object.keys(errors).length > 0) return { errors, values };

  // Checked here too. proxy.ts and the admin layout already turn strangers away,
  // but a server action is its own endpoint and can be posted to directly, so it
  // must not rely on a page having run first.
  const staff = await getSignedInStaff();
  if (!staff) return { message: NOT_SIGNED_IN, values };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti.", values };

  const result = await updateCustomer(salon.id, values.id, {
    first_name: values.first_name,
    last_name: values.last_name || null,
    phone: values.phone || null,
    email: values.email || null,
    notes: values.notes || null,
    marketing_consent: values.marketing_consent === "on",
  });
  if (!result.ok) return { message: result.error, values };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Shranjeno.", values };
}

/**
 * GDPR erasure. The row stays, so past bookings and the salon's numbers remain
 * correct, but every personal column is cleared and cannot be recovered.
 */
export async function eraseCustomer(
  _previous: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const id = text(formData, "id");
  const values = { id };

  // Checked here too. proxy.ts and the admin layout already turn strangers away,
  // but a server action is its own endpoint and can be posted to directly, so it
  // must not rely on a page having run first.
  const staff = await getSignedInStaff();
  if (!staff) return { message: NOT_SIGNED_IN, values };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti.", values };

  const result = await anonymizeCustomer(salon.id, id);
  if (!result.ok) return { message: result.error, values };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Osebni podatki so izbrisani.", values };
}
