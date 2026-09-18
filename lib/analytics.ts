/**
 * Admin analytics. A pure function: it does not read the database and does not
 * call Date.now(); the caller passes the data and `now`.
 *
 * Period: the last `weeks` calendar weeks (Monday to Sunday) up to `now`, so the
 * current week is partial. Only bookings that already started are counted.
 * All dates are the salon's local dates; instants go through date-fns-tz.
 */
import {
  addDays,
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  getDay,
  parseISO,
  startOfWeek,
} from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { localDay } from "./format";
import type { Booking, StaffHours, TimeOff } from "./types";

export interface AnalyticsInput {
  bookings: Booking[];
  /** Weekly hours of the staff that count towards occupancy (active staff). */
  staffHours: StaffHours[];
  timeOff: TimeOff[];
  timezone: string;
  weeks: number;
  now: Date;
}

export interface WeekStat {
  /** Monday of the week, "YYYY-MM-DD" (local date). */
  week_start: string;
  /** Not cancelled. */
  bookings: number;
  revenue_cents: number;
}

export interface Analytics {
  /** Bookings that took place or were no-shows. Cancelled ones are not counted. */
  bookings: number;
  /** Sum of the price of completed bookings. */
  revenue_cents: number;
  /** Booked minutes / working minutes so far, 0..1 (null without working hours). */
  occupancy: number | null;
  /** No-shows / (completed + no-shows), 0..1 (null without any of them). */
  no_show_rate: number | null;
  completed: number;
  no_shows: number;
  /** Oldest first; the last one is the current (partial) week. */
  weeks: WeekStat[];
}

const DAY_FORMAT = "yyyy-MM-dd";

export function computeAnalytics(input: AnalyticsInput): Analytics {
  const { bookings, staffHours, timeOff, timezone, weeks, now } = input;

  const today = localDay(now, timezone);
  const thisMonday = startOfWeek(parseISO(today), { weekStartsOn: 1 });
  const firstMonday = addDays(thisMonday, -(weeks - 1) * 7);
  const periodStart = fromZonedTime(`${format(firstMonday, DAY_FORMAT)}T00:00:00`, timezone);

  const weekStats = new Map<string, WeekStat>();
  for (let i = 0; i < weeks; i++) {
    const key = format(addDays(firstMonday, i * 7), DAY_FORMAT);
    weekStats.set(key, { week_start: key, bookings: 0, revenue_cents: 0 });
  }

  let counted = 0;
  let revenue = 0;
  let bookedMinutes = 0;
  let completed = 0;
  let noShows = 0;

  for (const booking of bookings) {
    const start = parseISO(booking.starts_at);
    if (start < periodStart || start >= now || booking.status === "cancelled") continue;

    const monday = startOfWeek(parseISO(localDay(booking.starts_at, timezone)), {
      weekStartsOn: 1,
    });
    const stat = weekStats.get(format(monday, DAY_FORMAT));
    if (!stat) continue;

    counted += 1;
    stat.bookings += 1;
    bookedMinutes += differenceInMinutes(parseISO(booking.ends_at), start);
    if (booking.status === "completed") {
      completed += 1;
      revenue += booking.price_cents;
      stat.revenue_cents += booking.price_cents;
    } else if (booking.status === "no_show") {
      noShows += 1;
    }
  }

  // Working minutes from the start of the period until now, minus time off.
  let availableMinutes = 0;
  const dayCount = differenceInCalendarDays(parseISO(today), firstMonday) + 1;
  for (let i = 0; i < dayCount; i++) {
    const date = addDays(firstMonday, i);
    const day = format(date, DAY_FORMAT);
    for (const hours of staffHours) {
      if (hours.weekday !== getDay(date)) continue;
      const from = fromZonedTime(`${day}T${hours.start_time}`, timezone);
      const windowEnd = fromZonedTime(`${day}T${hours.end_time}`, timezone);
      const to = windowEnd > now ? now : windowEnd; // the day is not over yet
      if (to <= from) continue;

      let minutes = differenceInMinutes(to, from);
      for (const off of timeOff) {
        if (off.staff_id !== null && off.staff_id !== hours.staff_id) continue;
        const overlapFrom = Math.max(from.getTime(), parseISO(off.starts_at).getTime());
        const overlapTo = Math.min(to.getTime(), parseISO(off.ends_at).getTime());
        if (overlapTo > overlapFrom) minutes -= (overlapTo - overlapFrom) / 60_000;
      }
      availableMinutes += Math.max(0, minutes);
    }
  }

  return {
    bookings: counted,
    revenue_cents: revenue,
    occupancy: availableMinutes > 0 ? bookedMinutes / availableMinutes : null,
    no_show_rate: completed + noShows > 0 ? noShows / (completed + noShows) : null,
    completed,
    no_shows: noShows,
    weeks: [...weekStats.values()],
  };
}
