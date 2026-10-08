"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSalon } from "@/lib/current-salon";
import { createService, updateService } from "@/lib/data";

export type ServiceField = "name" | "category" | "duration" | "buffer" | "price";

export type ServiceFormState = {
  ok?: boolean;
  message?: string;
  errors?: Partial<Record<ServiceField, string>>;
  values: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Creates (no `id`) or updates a service of the current salon.
 * TODO: admin login check, Zod validation (weeks 6-7).
 */
export async function saveService(
  _previous: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const values = {
    id: text(formData, "id"),
    name: text(formData, "name"),
    category: text(formData, "category"),
    duration: text(formData, "duration"),
    buffer: text(formData, "buffer"),
    price: text(formData, "price"),
    is_active: formData.get("is_active") === "on" ? "on" : "",
  };

  const errors: Partial<Record<ServiceField, string>> = {};
  if (!values.name) errors.name = "Vpišite ime.";
  else if (values.name.length > 80) errors.name = "Ime je predolgo.";
  if (values.category.length > 40) errors.category = "Kategorija je predolga.";

  const duration = /^\d+$/.test(values.duration) ? Number(values.duration) : NaN;
  if (!(duration >= 5 && duration <= 600)) errors.duration = "5 do 600 min.";

  const buffer = /^\d+$/.test(values.buffer) ? Number(values.buffer) : NaN;
  if (!(buffer >= 0 && buffer <= 240)) errors.buffer = "0 do 240 min.";

  const priceOk = /^\d+([.,]\d{1,2})?$/.test(values.price);
  const priceCents = priceOk ? Math.round(parseFloat(values.price.replace(",", ".")) * 100) : NaN;
  if (!(priceCents >= 0 && priceCents <= 1_000_000)) errors.price = "Npr. 32 ali 32,50.";

  if (Object.keys(errors).length > 0) return { errors, values };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti.", values };

  const input = {
    name: values.name,
    category: values.category || null,
    duration_min: duration,
    buffer_after_min: buffer,
    price_cents: priceCents,
    is_active: values.is_active === "on",
  };
  const result = values.id
    ? await updateService(salon.id, values.id, input)
    : await createService(salon.id, input);

  if (!result.ok) return { message: result.error, values };

  revalidatePath("/admin", "layout");
  return { ok: true, message: values.id ? "Shranjeno." : "Storitev je dodana.", values };
}
