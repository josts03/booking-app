"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAccessAllowed } from "@/lib/admin-access";
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

/** "32" or "32,50" (or "32.50") euros -> cents. */
const euros = z
  .string()
  .regex(/^\d{1,5}([.,]\d{1,2})?$/, "Npr. 32 ali 32,50.")
  .transform((value) => Math.round(Number.parseFloat(value.replace(",", ".")) * 100));

const wholeMinutes = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,4}$/, `${min} do ${max} min.`)
    .transform(Number)
    .pipe(z.number().int().min(min, `${min} do ${max} min.`).max(max, `${min} do ${max} min.`));

/** Same limits as the database (services checks in 001 and 002). */
const ServiceSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  name: z.string().min(1, "Vpišite ime.").max(80, "Ime je predolgo."),
  category: z.string().max(40, "Kategorija je predolga."),
  duration: wholeMinutes(5, 600),
  buffer: wholeMinutes(0, 240),
  price: euros,
  is_active: z.enum(["on", ""]),
});

const FIELD_NAMES: ServiceField[] = ["name", "category", "duration", "buffer", "price"];

/**
 * Creates (no `id`) or updates a service of the current salon.
 * TODO(week 7): instead of adminAccessAllowed(), check the logged-in user.
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

  // A server action can be called without opening the page, so it checks itself.
  if (!adminAccessAllowed()) {
    return { message: "Nimate dostopa.", values };
  }

  const parsed = ServiceSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors as Partial<Record<string, string[]>>;
    const errors: Partial<Record<ServiceField, string>> = {};
    for (const name of FIELD_NAMES) {
      const message = fieldErrors[name]?.[0];
      if (message) errors[name] = message;
    }
    if (Object.keys(errors).length === 0) {
      // Only the hidden id was wrong: the form was tampered with or is stale.
      return { message: "Storitve ni mogoče najti. Osvežite stran.", values };
    }
    return { errors, values };
  }

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti.", values };

  const input = {
    name: parsed.data.name,
    category: parsed.data.category || null,
    duration_min: parsed.data.duration,
    buffer_after_min: parsed.data.buffer,
    price_cents: parsed.data.price,
    is_active: parsed.data.is_active === "on",
  };
  const result = parsed.data.id
    ? await updateService(salon.id, parsed.data.id, input)
    : await createService(salon.id, input);

  if (!result.ok) return { message: result.error, values };

  revalidatePath("/admin", "layout");
  return { ok: true, message: parsed.data.id ? "Shranjeno." : "Storitev je dodana.", values };
}
