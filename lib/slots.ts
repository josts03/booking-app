/**
 * Which start times a visitor may actually book.
 *
 * This is the one piece of real business logic in the app, so it is kept pure:
 * no database and no clock of its own. Everything it needs is handed in,
 * including `now`. That makes it the only part worth covering with tests, and
 * it is why lib/data.ts can load a whole month in five queries and then run
 * this per day in memory.
 *
 * The rules, in the order they are applied:
 *   1. the day must lie inside the salon's booking window (max_days_ahead)
 *   2. the staff member must be working that weekday (staff_hours, local time)
 *   3. the SERVICE must finish before they stop working; the cleanup buffer may
 *      run past closing time, the way it does in a real salon
 *   4. the start must be at least min_lead_time_min from now
 *   5. the occupied range (service + buffer) must not touch another booking or
 *      any time off — the same range Postgres guards with `bookings_no_overlap`
 *
 * Times: staff_hours are wall-clock in the salon's own timezone; everything
 * returned is an absolute instant. date-fns-tz does every conversion.
 */
import { addMinutes, differenceInCalendarDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type {
  Booking,
  FreeSlot,
  Salon,
  Service,
  StaffHours,
  TimeOff,
  Uuid,
  Weekday,
} from "./types";

/** What one candidate staff member brings to the calculation. */
export interface StaffAvailability {
  staff_id: Uuid;
  /** That member's whole weekly schedule; rows for other weekdays are ignored. */
  hours: StaffHours[];
  /** Their absences, plus any that close the whole salon (staff_id null). */
  timeOff: TimeOff[];
  /** Their bookings around this day. Cancelled ones are ignored here. */
  bookings: Pick<Booking, "starts_at" | "ends_at" | "buffer_min" | "status">[];
}

export interface SlotsInput {
  salon: Pick<
    Salon,
    "timezone" | "slot_interval_min" | "min_lead_time_min" | "max_days_ahead"
  >;
  service: Pick<Service, "duration_min" | "buffer_after_min">;
  /** Local calendar date in the salon's timezone, "YYYY-MM-DD". */
  day: string;
  /** One member, or several when the visitor chose "anyone available". */
  staff: StaffAvailability[];
  /** Injected so the result is reproducible in tests. */
  now: Date;
}

interface Interval {
  from: Date;
  to: Date;
}

/** Half-open [from, to): touching at the edges is not an overlap. */
function overlaps(a: Interval, b: Interval): boolean {
  return a.from < b.to && b.from < a.to;
}

/** The weekday of a "YYYY-MM-DD" date, independent of any timezone. */
function weekdayOf(day: string): Weekday | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, date));
  if (Number.isNaN(utc.getTime()) || utc.getUTCMonth() !== month - 1) return null;
  return utc.getUTCDay() as Weekday;
}

/** "09:00:00" on `day`, read as wall-clock time in `timezone`, as an instant. */
function instantAt(day: string, localTime: string, timezone: string): Date | null {
  const time = /^\d{2}:\d{2}$/.test(localTime) ? `${localTime}:00` : localTime;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) return null;
  const instant = fromZonedTime(`${day}T${time}`, timezone);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Bookings and absences block the chair; a cancelled booking does not. */
function blocked(member: StaffAvailability): Interval[] {
  const booked = member.bookings
    .filter((b) => b.status !== "cancelled" && b.status !== "no_show")
    .map((b) => ({
      from: new Date(b.starts_at),
      to: addMinutes(new Date(b.ends_at), b.buffer_min),
    }));
  const away = member.timeOff.map((t) => ({
    from: new Date(t.starts_at),
    to: new Date(t.ends_at),
  }));
  return [...booked, ...away].filter(
    (i) => !Number.isNaN(i.from.getTime()) && !Number.isNaN(i.to.getTime()),
  );
}

/**
 * Bookable start times for one service on one local day, earliest first.
 *
 * With several staff members the same start time is returned once, credited to
 * the first member in the given order — callers pass them sorted by
 * `sort_order`, so "anyone available" stays predictable rather than random.
 */
export function freeSlots(input: SlotsInput): FreeSlot[] {
  const { salon, service, day, staff, now } = input;

  const weekday = weekdayOf(day);
  if (weekday === null) return [];
  if (!(service.duration_min > 0) || !(salon.slot_interval_min > 0)) return [];

  // The salon is open for bookings from today until max_days_ahead.
  const today = toZonedTime(now, salon.timezone);
  const target = toZonedTime(
    instantAt(day, "12:00:00", salon.timezone) ?? new Date(NaN),
    salon.timezone,
  );
  if (Number.isNaN(target.getTime())) return [];
  const daysAhead = differenceInCalendarDays(target, today);
  if (daysAhead < 0 || daysAhead > salon.max_days_ahead) return [];

  const earliest = addMinutes(now, salon.min_lead_time_min);

  // Start times already taken by an earlier member, so "anyone" lists each once.
  const seen = new Set<number>();
  const slots: FreeSlot[] = [];

  for (const member of staff) {
    const busy = blocked(member);

    for (const row of member.hours.filter((h) => h.weekday === weekday)) {
      const opens = instantAt(day, row.start_time, salon.timezone);
      const closes = instantAt(day, row.end_time, salon.timezone);
      if (!opens || !closes || opens >= closes) continue;

      for (
        let start = opens;
        // The service itself must be finished by closing time.
        addMinutes(start, service.duration_min) <= closes;
        start = addMinutes(start, salon.slot_interval_min)
      ) {
        if (start < earliest) continue;

        const ends = addMinutes(start, service.duration_min);
        // What the chair is really occupied for, buffer included.
        const occupied = { from: start, to: addMinutes(ends, service.buffer_after_min) };
        if (busy.some((interval) => overlaps(occupied, interval))) continue;

        const key = start.getTime();
        if (seen.has(key)) continue;
        seen.add(key);

        slots.push({
          staff_id: member.staff_id,
          starts_at: start.toISOString(),
          ends_at: ends.toISOString(),
        });
      }
    }
  }

  return slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
