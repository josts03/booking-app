/**
 * Weekly working hours and absences as the salon enters them, checked before
 * they reach the database. Pure: no database, no clock.
 *
 * Working hours stay local wall-clock times ("09:00", staff_hours.start_time is
 * a Postgres `time`), never instants: "9 to 5" means 9 to 5 in winter and in
 * summer. Absences are periods of real time, so they become instants in the
 * salon's time zone, only through date-fns-tz.
 */
import { addDays, format, isValid, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import type { StaffHours, Weekday } from "./types";

/** One working window of a day, local time "HH:MM". */
export interface TimeWindow {
  start: string;
  end: string;
}

export const MAX_WINDOWS_PER_DAY = 3;
export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0]; // Monday first, 0 = Sunday

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type WeekInput = Partial<Record<Weekday, TimeWindow[]>>;
export type HoursRow = Pick<StaffHours, "weekday" | "start_time" | "end_time">;

export type WeekCheck =
  | { ok: true; rows: HoursRow[] }
  | { ok: false; errors: Partial<Record<Weekday, string>> };

/**
 * A whole week of one staff member. Per day at most three windows, each with
 * its start before its end, and no two overlapping (touching is fine: 9–12 and
 * 12–17). A day without windows is a day off.
 */
export function checkWeek(week: WeekInput): WeekCheck {
  const errors: Partial<Record<Weekday, string>> = {};
  const rows: HoursRow[] = [];

  for (const weekday of WEEKDAYS) {
    const windows = week[weekday] ?? [];
    if (windows.length > MAX_WINDOWS_PER_DAY) {
      errors[weekday] = `Največ ${MAX_WINDOWS_PER_DAY} okna na dan.`;
      continue;
    }
    if (windows.some((w) => !HHMM.test(w.start) || !HHMM.test(w.end))) {
      errors[weekday] = "Vpišite uri, npr. 09:00 in 17:00.";
      continue;
    }
    if (windows.some((w) => w.start >= w.end)) {
      errors[weekday] = "Konec mora biti za začetkom.";
      continue;
    }
    const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
    if (sorted.some((w, i) => i > 0 && w.start < sorted[i - 1].end)) {
      errors[weekday] = "Delovna okna se prekrivajo.";
      continue;
    }
    for (const w of sorted) rows.push({ weekday, start_time: `${w.start}:00`, end_time: `${w.end}:00` });
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, rows };
}

/** staff_hours rows of one staff member as the editor shows them: per weekday, sorted, "HH:MM". */
export function weekFromHours(hours: HoursRow[]): Record<Weekday, TimeWindow[]> {
  const week = Object.fromEntries(WEEKDAYS.map((d) => [d, [] as TimeWindow[]])) as Record<Weekday, TimeWindow[]>;
  for (const h of [...hours].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    // "24:00:00" (valid in Postgres) cannot be typed into a time field; it shows as the last minute.
    const end = h.end_time.startsWith("24") ? "23:59" : h.end_time.slice(0, 5);
    week[h.weekday].push({ start: h.start_time.slice(0, 5), end });
  }
  return week;
}

/**
 * An absence as the salon enters it: whole days from `firstDay` to `lastDay`
 * (both included), or part of one day `from`–`to`.
 */
export interface AbsenceInput {
  firstDay: string;
  lastDay: string;
  from?: string;
  to?: string;
}

export type AbsenceCheck = { ok: true; starts_at: string; ends_at: string } | { ok: false; error: string };

const MAX_ABSENCE_DAYS = 366;

function isDay(value: string): boolean {
  return DAY.test(value) && isValid(parseISO(value)) && format(parseISO(value), "yyyy-MM-dd") === value;
}

/** The absence as [starts_at, ends_at) instants in the salon's time zone. */
export function absenceRange(input: AbsenceInput, timeZone: string): AbsenceCheck {
  const { firstDay, lastDay, from, to } = input;
  if (!isDay(firstDay) || !isDay(lastDay)) return { ok: false, error: "Izberite dan." };
  if (lastDay < firstDay) return { ok: false, error: "Zadnji dan ne more biti pred prvim." };

  if (from || to) {
    if (firstDay !== lastDay) return { ok: false, error: "Ure lahko vpišete samo za en dan." };
    if (!from || !to || !HHMM.test(from) || !HHMM.test(to)) return { ok: false, error: "Vpišite uri, npr. 10:00 in 12:00." };
    if (from >= to) return { ok: false, error: "Konec mora biti za začetkom." };
    return {
      ok: true,
      starts_at: fromZonedTime(`${firstDay}T${from}:00`, timeZone).toISOString(),
      ends_at: fromZonedTime(`${firstDay}T${to}:00`, timeZone).toISOString(),
    };
  }

  const dayAfterLast = format(addDays(parseISO(lastDay), 1), "yyyy-MM-dd");
  const days = (Date.parse(`${dayAfterLast}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_ABSENCE_DAYS) return { ok: false, error: "Odsotnost je lahko dolga največ eno leto." };
  return {
    ok: true,
    starts_at: fromZonedTime(`${firstDay}T00:00:00`, timeZone).toISOString(),
    ends_at: fromZonedTime(`${dayAfterLast}T00:00:00`, timeZone).toISOString(),
  };
}
