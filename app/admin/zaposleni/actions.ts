"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdminAccess, NO_ADMIN_ACCESS, OWNER_ONLY } from "@/lib/admin-access";
import { addTimeOff, createStaff, deleteTimeOff, setStaffHours, updateStaff } from "@/lib/data";
import { absenceRange, checkWeek, MAX_WINDOWS_PER_DAY, WEEKDAYS, type WeekInput } from "@/lib/schedule";
import type { AffectedBooking, Weekday } from "@/lib/types";

export type ManageState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Future bookings that no longer fit: the salon moves them by hand. */
  affected?: AffectedBooking[];
  values?: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** The signed-in owner's salon, or the sentence to show instead. */
async function ownerSalon(): Promise<{ salonId: string; timezone: string } | { message: string }> {
  const access = await getAdminAccess();
  if (!access.ok) return { message: NO_ADMIN_ACCESS };
  if (access.role !== "owner") return { message: OWNER_ONLY };
  return { salonId: access.salon.id, timezone: access.salon.timezone };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

const StaffSchema = z.object({
  name: z.string().min(1, "Vpišite ime.").max(60, "Ime je predolgo."),
  color: z.string().regex(HEX, "Izberite barvo."),
  email: z.union([z.literal(""), z.string().max(254).pipe(z.email("Vpišite veljaven e-naslov."))]),
  phone: z.string().max(40, "Številka je predolga."),
});

/** A new staff member; then their page opens to set the week. */
export async function createStaffAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const values = { name: text(formData, "name"), color: text(formData, "color") };
  const parsed = StaffSchema.pick({ name: true, color: true }).safeParse(values);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message, values };
  const owner = await ownerSalon();
  if ("message" in owner) return { message: owner.message, values };

  const result = await createStaff(owner.salonId, parsed.data);
  if (!result.ok) return { message: result.error, values };
  revalidatePath("/admin", "layout");
  redirect(`/admin/zaposleni/${result.value.id}`);
}

/** Name, color, contact, active. */
export async function saveStaffAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const values = {
    id: text(formData, "id"),
    name: text(formData, "name"),
    color: text(formData, "color"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    is_active: formData.get("is_active") === "on" ? "on" : "",
  };
  const id = z.uuid().safeParse(values.id);
  const parsed = StaffSchema.safeParse(values);
  if (!id.success) return { message: "Zaposlenega ni mogoče najti. Osvežite stran.", values };
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { errors, values };
  }
  const owner = await ownerSalon();
  if ("message" in owner) return { message: owner.message, values };

  const result = await updateStaff(owner.salonId, id.data, {
    name: parsed.data.name,
    color: parsed.data.color,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    is_active: values.is_active === "on",
  });
  if (!result.ok) return { message: result.error, values };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Shranjeno.", values };
}

/**
 * The whole week from the form: for every weekday "work-<d>" (on/off) and up to
 * three windows "start-<d>-<i>" / "end-<d>-<i>". Checked by lib/schedule.ts,
 * saved in one step (replace_staff_hours, 007).
 */
export async function saveHoursAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const id = z.uuid().safeParse(text(formData, "id"));
  if (!id.success) return { message: "Zaposlenega ni mogoče najti. Osvežite stran." };

  const values: Record<string, string> = {};
  const week: WeekInput = {};
  for (const day of WEEKDAYS) {
    const works = formData.get(`work-${day}`) === "on";
    values[`work-${day}`] = works ? "on" : "";
    const windows = [];
    for (let i = 0; i < MAX_WINDOWS_PER_DAY; i++) {
      const start = text(formData, `start-${day}-${i}`);
      const end = text(formData, `end-${day}-${i}`);
      values[`start-${day}-${i}`] = start;
      values[`end-${day}-${i}`] = end;
      if (start || end) windows.push({ start, end });
    }
    if (works) week[day as Weekday] = windows.length ? windows : [{ start: "", end: "" }];
  }
  const checked = checkWeek(week);
  if (!checked.ok) {
    return { errors: Object.fromEntries(Object.entries(checked.errors).map(([d, e]) => [`day-${d}`, e])), values };
  }

  const owner = await ownerSalon();
  if ("message" in owner) return { message: owner.message, values };
  const result = await setStaffHours(owner.salonId, id.data, checked.rows);
  if (!result.ok) return { message: result.error, values };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Urnik je shranjen. Prosti termini so že posodobljeni.", affected: result.affected, values };
}

/** An absence of the staff member in "staff", or of the whole salon when "staff" is empty. */
export async function addTimeOffAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const partial = formData.get("partial") === "on";
  const values = {
    staff: text(formData, "staff"),
    first: text(formData, "first"),
    last: text(formData, "last") || text(formData, "first"),
    from: partial ? text(formData, "from") : "",
    to: partial ? text(formData, "to") : "",
    partial: partial ? "on" : "",
    reason: text(formData, "reason"),
  };
  const staff = values.staff ? z.uuid().safeParse(values.staff) : null;
  if (staff && !staff.success) return { message: "Zaposlenega ni mogoče najti. Osvežite stran.", values };
  if (values.reason.length > 200) return { message: "Opomba je predolga.", values };

  const owner = await ownerSalon();
  if ("message" in owner) return { message: owner.message, values };
  const range = absenceRange(
    { firstDay: values.first, lastDay: partial ? values.first : values.last, from: values.from || undefined, to: values.to || undefined },
    owner.timezone,
  );
  if (!range.ok) return { message: range.error, values };

  const result = await addTimeOff(owner.salonId, {
    staff_id: staff?.data ?? null,
    starts_at: range.starts_at,
    ends_at: range.ends_at,
    reason: values.reason || null,
  });
  if (!result.ok) return { message: result.error, values };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Odsotnost je dodana. Prosti termini so že posodobljeni.", affected: result.affected };
}

export async function deleteTimeOffAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const id = z.uuid().safeParse(text(formData, "id"));
  if (!id.success) return { message: "Odsotnosti ni mogoče najti. Osvežite stran." };
  const owner = await ownerSalon();
  if ("message" in owner) return { message: owner.message };
  const result = await deleteTimeOff(owner.salonId, id.data);
  if (!result.ok) return { message: result.error };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Odsotnost je izbrisana." };
}
