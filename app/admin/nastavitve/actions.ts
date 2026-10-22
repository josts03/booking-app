"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAccess, NO_ADMIN_ACCESS, OWNER_ONLY } from "@/lib/admin-access";
import { updateSalonSettings } from "@/lib/data";

export type SettingsState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  values?: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const whole = (min: number, max: number, message: string) =>
  z
    .string()
    .regex(/^\d{1,5}$/, message)
    .transform(Number)
    .pipe(z.number().int().min(min, message).max(max, message));

/** Same limits as the database (002_constraints.sql, 007) and lib/data.ts. */
const SettingsSchema = z.object({
  name: z.string().min(1, "Vpišite ime salona.").max(80, "Ime je predolgo."),
  phone: z.string().max(40, "Številka je predolga."),
  email: z.union([z.literal(""), z.string().max(254).pipe(z.email("Vpišite veljaven e-naslov."))]),
  address: z.string().max(200, "Naslov je predolg."),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Izberite barvo."),
  slot_interval_min: z.enum(["5", "10", "15", "20", "30", "60"], { error: "Izberite korak." }).transform(Number),
  min_lead_time_hours: whole(0, 720, "0 do 720 ur."),
  max_days_ahead: whole(1, 365, "1 do 365 dni."),
  cancel_window_hours: whole(0, 720, "0 do 720 ur."),
  reminder_hours_before: whole(0, 168, "0 do 168 ur."),
  confirmation_note: z.string().max(500, "Največ 500 znakov."),
});

/** The salon's own settings, for its owner. The public booking page follows at once. */
export async function saveSettingsAction(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const keys = [
    "name", "phone", "email", "address", "brand_color", "slot_interval_min", "min_lead_time_hours",
    "max_days_ahead", "cancel_window_hours", "reminder_hours_before", "confirmation_note",
  ] as const;
  const values: Record<string, string> = Object.fromEntries(keys.map((k) => [k, text(formData, k)]));
  values.require_confirmation = formData.get("require_confirmation") === "on" ? "on" : "";

  const parsed = SettingsSchema.safeParse(values);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { errors, values, message: "Preverite označena polja." };
  }

  const access = await getAdminAccess();
  if (!access.ok) return { message: NO_ADMIN_ACCESS, values };
  if (access.role !== "owner") return { message: OWNER_ONLY, values };

  const d = parsed.data;
  const result = await updateSalonSettings(access.salon.id, {
    name: d.name,
    phone: d.phone || null,
    email: d.email || null,
    address: d.address || null,
    brand_color: d.brand_color,
    slot_interval_min: d.slot_interval_min,
    min_lead_time_min: d.min_lead_time_hours * 60,
    max_days_ahead: d.max_days_ahead,
    cancel_window_hours: d.cancel_window_hours,
    require_confirmation: values.require_confirmation === "on",
    reminder_hours_before: d.reminder_hours_before,
    confirmation_note: d.confirmation_note || null,
  });
  if (!result.ok) return { message: result.error, values };
  // The booking pages, the e-mails and the admin all read these.
  revalidatePath("/", "layout");
  return { ok: true, message: "Nastavitve so shranjene. Stran za naročanje jih že upošteva.", values };
}
