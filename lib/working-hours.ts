/**
 * Does one booking the salon enters by hand fit the staff member's day?
 * [start, busyEnd) with busyEnd = end + cleaning buffer must lie inside one of
 * their working windows that day and overlap no absence (their own or the
 * whole salon's). The same rule the free-slot engine uses for visitors
 * (specs/slots.md rules 2, 3 and 6); the admin may still go ahead after a
 * warning (decision of 21. 10. 2026). Overlap with other bookings is not
 * checked here: the database refuses that always (23P01).
 *
 * Pure: no database, no clock. Time zones only through date-fns-tz.
 */
import { addDays, format, getDay, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { StaffHours, TimeOff } from "./types";

export type HoursProblem = "absent" | "not-working" | null;

export interface HoursCheck {
  staffId: string;
  start: Date;
  /** End including the cleaning buffer. */
  busyEnd: Date;
  hours: Pick<StaffHours, "staff_id" | "weekday" | "start_time" | "end_time">[];
  timeOff: Pick<TimeOff, "staff_id" | "starts_at" | "ends_at">[];
  timeZone: string;
}

/** A local wall-clock time on `day` as an instant. "24:00:00" (valid in Postgres) is the next midnight. */
function localInstant(day: string, time: string, timeZone: string): Date {
  if (time.startsWith("24")) {
    return fromZonedTime(`${format(addDays(parseISO(day), 1), "yyyy-MM-dd")}T00:00:00`, timeZone);
  }
  return fromZonedTime(`${day}T${time.length === 5 ? `${time}:00` : time}`, timeZone);
}

export function workingHoursProblem(check: HoursCheck): HoursProblem {
  const { staffId, start, busyEnd, hours, timeOff, timeZone } = check;

  const absent = timeOff.some(
    (off) =>
      (off.staff_id === null || off.staff_id === staffId) &&
      Date.parse(off.starts_at) < busyEnd.getTime() &&
      Date.parse(off.ends_at) > start.getTime(),
  );
  if (absent) return "absent";

  const day = formatInTimeZone(start, timeZone, "yyyy-MM-dd");
  const weekday = getDay(parseISO(day));
  const inside = hours.some(
    (window) =>
      window.staff_id === staffId &&
      window.weekday === weekday &&
      localInstant(day, window.start_time, timeZone).getTime() <= start.getTime() &&
      busyEnd.getTime() <= localInstant(day, window.end_time, timeZone).getTime(),
  );
  return inside ? null : "not-working";
}
