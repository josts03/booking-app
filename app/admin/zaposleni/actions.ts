"use server";

import { fromZonedTime } from "date-fns-tz";
import { revalidatePath } from "next/cache";
import { getSignedInStaff, NOT_SIGNED_IN } from "@/lib/auth";
import { getCurrentSalon } from "@/lib/current-salon";
import {
  createStaff,
  createTimeOff,
  deleteTimeOff,
  setStaffHours,
  setStaffServices,
  updateStaff,
} from "@/lib/data";
import type { StaffHoursInput, Weekday } from "@/lib/types";

export type StaffField = "name" | "email" | "phone" | "color";

export type StaffFormState = {
  ok?: boolean;
  message?: string;
  errors?: Partial<Record<StaffField, string>>;
  values: Record<string, string>;
} | null;

/** Shared by the schedule, services and absence forms: one message, no fields. */
export type SimpleState = { ok?: boolean; message: string } | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

// ---------- staff member ----------

/**
 * Creates (no `id`) or updates one staff member.
 */
export async function saveStaff(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const values = {
    id: text(formData, "id"),
    name: text(formData, "name"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    color: text(formData, "color"),
    is_active: formData.get("is_active") === "on" ? "on" : "",
  };

  const errors: Partial<Record<StaffField, string>> = {};
  if (!values.name) errors.name = "Vpišite ime.";
  else if (values.name.length > 80) errors.name = "Ime je predolgo.";
  if (values.color && !/^#[0-9a-f]{6}$/i.test(values.color)) errors.color = "Npr. #6366f1.";
  if (Object.keys(errors).length > 0) return { errors, values };

  // Checked here too. proxy.ts and the admin layout already turn strangers away,
  // but a server action is its own endpoint and can be posted to directly, so it
  // must not rely on a page having run first.
  const staff = await getSignedInStaff();
  if (!staff) return { message: NOT_SIGNED_IN, values };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti.", values };

  const input = {
    name: values.name,
    email: values.email || null,
    phone: values.phone || null,
    color: values.color || null,
    is_active: values.is_active === "on",
  };
  const result = values.id
    ? await updateStaff(salon.id, values.id, input)
    : await createStaff(salon.id, input);

  if (!result.ok) return { message: result.error, values };

  revalidatePath("/admin", "layout");
  return {
    ok: true,
    message: values.id ? "Shranjeno." : "Zaposleni je dodan.",
    values,
  };
}

// ---------- weekly schedule ----------

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/**
 * Replaces one member's whole week. A day with both fields empty is a free day;
 * filling in only one of the two is a mistake and stops the whole save, so a
 * half-written week can never reach the database.
 */
export async function saveHours(
  _previous: SimpleState,
  formData: FormData,
): Promise<SimpleState> {
  const staffId = text(formData, "staff_id");
  if (!staffId) return { message: "Zaposlenega ni mogoče najti." };

  const hours: StaffHoursInput[] = [];
  for (const weekday of WEEKDAYS) {
    const start = text(formData, `start_${weekday}`);
    const end = text(formData, `end_${weekday}`);
    if (!start && !end) continue;
    if (!start || !end) {
      return { message: "Pri vsakem delovnem dnevu izpolnite oba časa." };
    }
    if (start >= end) {
      return { message: "Konec mora biti za začetkom." };
    }
    hours.push({ weekday, start_time: start, end_time: end });
  }

  // Checked here too: a server action is its own endpoint and can be posted to
  // without ever loading the admin page that normally guards it.
  const staff = await getSignedInStaff();
  if (!staff) return { message: NOT_SIGNED_IN };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti." };

  const saved = await setStaffHours(salon.id, staffId, hours);
  if (saved === null) return { message: "Urnika ni mogoče shraniti. Preverite vnos." };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Urnik je shranjen." };
}

// ---------- which services this member performs ----------

export async function saveServices(
  _previous: SimpleState,
  formData: FormData,
): Promise<SimpleState> {
  const staffId = text(formData, "staff_id");
  if (!staffId) return { message: "Zaposlenega ni mogoče najti." };

  // Checked here too: a server action is its own endpoint and can be posted to
  // without ever loading the admin page that normally guards it.
  const staff = await getSignedInStaff();
  if (!staff) return { message: NOT_SIGNED_IN };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti." };

  const serviceIds = formData
    .getAll("service_id")
    .filter((value): value is string => typeof value === "string");

  await setStaffServices(salon.id, staffId, serviceIds);

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Storitve so shranjene." };
}

// ---------- absences ----------

/**
 * Adds an absence. The form gives local calendar dates; `ends_at` is stored
 * exclusive, so a one-day absence runs to 00:00 of the following day.
 */
export async function addTimeOff(
  _previous: SimpleState,
  formData: FormData,
): Promise<SimpleState> {
  const staffValue = text(formData, "staff_id");
  const from = text(formData, "from");
  const to = text(formData, "to");
  const reason = text(formData, "reason");

  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!isDate(from) || !isDate(to)) return { message: "Izberite oba datuma." };
  if (to < from) return { message: "Konec ne more biti pred začetkom." };

  // Checked here too: a server action is its own endpoint and can be posted to
  // without ever loading the admin page that normally guards it.
  const staff = await getSignedInStaff();
  if (!staff) return { message: NOT_SIGNED_IN };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti." };

  // Exclusive end: add one day to the last absent day.
  const endDay = new Date(`${to}T00:00:00Z`);
  endDay.setUTCDate(endDay.getUTCDate() + 1);
  const endDate = endDay.toISOString().slice(0, 10);

  const result = await createTimeOff(salon.id, {
    // "salon" closes the whole salon: staff_id stays null.
    staff_id: staffValue === "salon" ? null : staffValue,
    starts_at: fromZonedTime(`${from}T00:00:00`, salon.timezone).toISOString(),
    ends_at: fromZonedTime(`${endDate}T00:00:00`, salon.timezone).toISOString(),
    reason: reason || null,
  });
  if (!result.ok) return { message: result.error };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Odsotnost je dodana." };
}

export async function removeTimeOff(
  _previous: SimpleState,
  formData: FormData,
): Promise<SimpleState> {
  const id = text(formData, "id");
  // Checked here too: a server action is its own endpoint and can be posted to
  // without ever loading the admin page that normally guards it.
  const staff = await getSignedInStaff();
  if (!staff) return { message: NOT_SIGNED_IN };

  const salon = await getCurrentSalon();
  if (!salon) return { message: "Salona ni mogoče najti." };

  const removed = await deleteTimeOff(salon.id, id);
  if (!removed) return { message: "Odsotnosti ni mogoče izbrisati." };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Odsotnost je izbrisana." };
}
