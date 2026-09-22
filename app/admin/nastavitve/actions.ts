"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSalon } from "@/lib/current-salon";
import { updateSalon } from "@/lib/data";

export type SettingsField =
  | "name"
  | "phone"
  | "email"
  | "address"
  | "timezone"
  | "brand_color"
  | "logo_url"
  | "slot_interval_min"
  | "min_lead_time_min"
  | "max_days_ahead"
  | "cancel_window_hours"
  | "reminder_hours_before";

export type SettingsFormState = {
  ok?: boolean;
  message?: string;
  errors?: Partial<Record<SettingsField, string>>;
  values: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Whole numbers only; anything else becomes NaN and fails the range check. */
function whole(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : NaN;
}

/** Same ranges as SALON_LIMITS in lib/data.ts and the CHECKs in specs/schema.sql. */
const RANGES: Record<string, [number, number, string]> = {
  slot_interval_min: [5, 60, "5 do 60 min."],
  min_lead_time_min: [0, 10080, "0 do 10080 min (7 dni)."],
  max_days_ahead: [1, 365, "1 do 365 dni."],
  cancel_window_hours: [0, 168, "0 do 168 ur (7 dni)."],
  reminder_hours_before: [0, 168, "0 do 168 ur (7 dni)."],
};

/**
 * Saves the salon's own settings.
 * TODO: admin login check, Zod validation (weeks 6-7).
 */
export async function saveSettings(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const values = {
    name: text(formData, "name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    address: text(formData, "address"),
    timezone: text(formData, "timezone"),
    brand_color: text(formData, "brand_color"),
    logo_url: text(formData, "logo_url"),
    slot_interval_min: text(formData, "slot_interval_min"),
    min_lead_time_min: text(formData, "min_lead_time_min"),
    max_days_ahead: text(formData, "max_days_ahead"),
    cancel_window_hours: text(formData, "cancel_window_hours"),
    reminder_hours_before: text(formData, "reminder_hours_before"),
    require_confirmation: formData.get("require_confirmation") === "on" ? "on" : "",
  };

  const errors: Partial<Record<SettingsField, string>> = {};
  if (!values.name) errors.name = "Vpišite ime salona.";
  else if (values.name.length > 80) errors.name = "Ime je predolgo.";
  if (!values.timezone) errors.timezone = "Izberite časovni pas.";
  if (values.brand_color && !/^#[0-9a-f]{6}$/i.test(values.brand_color)) {
    errors.brand_color = "Npr. #0f766e.";
  }

  const numbers: Record<string, number> = {};
  for (const [key, [min, max, hint]] of Object.entries(RANGES)) {
    const parsed = whole(values[key as keyof typeof values]);
    if (!(parsed >= min && parsed <= max)) errors[key as SettingsField] = hint;
    numbers[key] = parsed;
  }

  if (Object.keys(errors).length > 0) return { errors, values };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti.", values };

  const result = await updateSalon(salon.id, {
    name: values.name,
    phone: values.phone || null,
    email: values.email || null,
    address: values.address || null,
    timezone: values.timezone,
    logo_url: values.logo_url || null,
    brand_color: values.brand_color || null,
    slot_interval_min: numbers.slot_interval_min,
    min_lead_time_min: numbers.min_lead_time_min,
    max_days_ahead: numbers.max_days_ahead,
    cancel_window_hours: numbers.cancel_window_hours,
    require_confirmation: values.require_confirmation === "on",
    reminder_hours_before: numbers.reminder_hours_before,
  });

  if (!result.ok) return { message: result.error, values };

  // The brand color and the name are in the admin layout and on every salon
  // page, so the whole tree is refreshed.
  revalidatePath("/", "layout");
  return { ok: true, message: "Nastavitve so shranjene.", values };
}
