/**
 * Free-slot engine: which start times can be booked on one day. specs/slots.md.
 *
 * A pure function. It does not read the database and never reads the clock:
 * the current time comes in as `zdaj`. Tests: lib/slots.test.ts.
 *
 * The names of the signature are the ones fixed in specs/slots.md (Slovenian):
 *   dan        local date of the salon, "YYYY-MM-DD"
 *   casovniPas the salon's time zone, e.g. "Europe/Ljubljana"
 *   urniki     staff_hours of that weekday, local wall-clock "HH:mm" or "HH:mm:ss"
 *   odsotnosti time_off that touches the day
 *   zasedeno   pending + confirmed bookings, INCLUDING their cleaning buffer
 * Intervals are half-open: [od, do).
 *
 * The rules, numbered as in the spec:
 *   1  no working hours -> no slots
 *   2  windows are local time in casovniPas, turned into instants with date-fns-tz
 *   3  time off is cut out of the windows
 *   4  bookings are cut out of the windows
 *   5  slots lie on the clock grid of korakMin (15 -> :00, :15, :30, :45), from
 *      the first grid time inside each free part (decided 9. 10. 2026: easier
 *      for customers than times like 10:40 right after a booking)
 *   6  a slot needs duration + buffer completely inside the free part
 *   7  no slot starts before zdaj + najkrajsaNajavaMin
 *   8  a slot's `do` is start + duration, WITHOUT the buffer (what the customer sees)
 *   9  sorted by start
 *   10 time zone conversions only with date-fns-tz
 */
import { addMinutes, addSeconds } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export type Okno = { start: string; end: string }; // "09:00", "17:00"
export type Interval = { od: Date; do: Date };

export type VhodTerminov = {
  dan: string; // "2026-09-21" (local date of the salon)
  casovniPas: string; // "Europe/Ljubljana"
  trajanjeMin: number; // services.duration_min
  cistilniCasMin: number; // services.buffer_after_min
  korakMin: number; // salons.slot_interval_min
  najkrajsaNajavaMin: number; // salons.min_lead_time_min
  zdaj: Date; // always a parameter, NEVER Date.now() in here
  urniki: Okno[]; // staff_hours for this weekday
  odsotnosti: Interval[]; // time_off overlapping this day
  zasedeno: Interval[]; // bookings (pending + confirmed), with buffer
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function isValidDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Refuses input that cannot be right, instead of guessing. A step of 0 would
 * loop forever; a wrong day or time format would silently give wrong slots.
 */
function validate(v: VhodTerminov): void {
  const day = new Date(`${v.dan}T00:00:00Z`);
  if (!DAY_PATTERN.test(v.dan) || !isValidDate(day) || day.toISOString().slice(0, 10) !== v.dan) {
    throw new RangeError(`dan must be a date "YYYY-MM-DD", got "${v.dan}"`);
  }
  if (!Number.isInteger(v.trajanjeMin) || v.trajanjeMin <= 0) {
    throw new RangeError(`trajanjeMin must be a positive whole number, got ${v.trajanjeMin}`);
  }
  if (!Number.isInteger(v.korakMin) || v.korakMin <= 0) {
    throw new RangeError(`korakMin must be a positive whole number, got ${v.korakMin}`);
  }
  if (!Number.isInteger(v.cistilniCasMin) || v.cistilniCasMin < 0) {
    throw new RangeError(`cistilniCasMin must be 0 or more, got ${v.cistilniCasMin}`);
  }
  if (!Number.isInteger(v.najkrajsaNajavaMin) || v.najkrajsaNajavaMin < 0) {
    throw new RangeError(`najkrajsaNajavaMin must be 0 or more, got ${v.najkrajsaNajavaMin}`);
  }
  if (!isValidDate(v.zdaj)) throw new RangeError("zdaj must be a valid Date");
  for (const okno of v.urniki) {
    if (!TIME_PATTERN.test(okno.start) || !TIME_PATTERN.test(okno.end)) {
      throw new RangeError(`urniki need "HH:mm" times, got "${okno.start}"-"${okno.end}"`);
    }
  }
  for (const interval of [...v.odsotnosti, ...v.zasedeno]) {
    if (!isValidDate(interval.od) || !isValidDate(interval.do)) {
      throw new RangeError("odsotnosti and zasedeno need valid Dates");
    }
  }
}

/** Rule 2 and 10: local wall-clock time on `dan` in `timeZone` -> instant. */
function toInstant(dan: string, time: string, timeZone: string): Date {
  const withSeconds = time.length === 5 ? `${time}:00` : time;
  const instant = fromZonedTime(`${dan}T${withSeconds}`, timeZone);
  if (!isValidDate(instant)) throw new RangeError(`Unknown time zone "${timeZone}"`);
  return instant;
}

/** Rule 5: the first time at or after `from` that lies on the local clock grid of `stepMin`. */
function firstOnGrid(from: Date, timeZone: string, stepMin: number): Date {
  const [h, m, s] = formatInTimeZone(from, timeZone, "H:m:s").split(":").map(Number);
  const rest = (h * 3600 + m * 60 + s) % (stepMin * 60);
  return rest === 0 ? from : addSeconds(from, stepMin * 60 - rest);
}

/** Rules 3 and 4: the parts of `window` that no blocked interval touches, in order. */
function freeParts(window: Interval, blocked: Interval[]): Interval[] {
  let parts = [window];
  for (const b of blocked) {
    const next: Interval[] = [];
    for (const part of parts) {
      const overlaps = b.od.getTime() < part.do.getTime() && b.do.getTime() > part.od.getTime();
      if (!overlaps) {
        next.push(part);
        continue;
      }
      if (b.od.getTime() > part.od.getTime()) next.push({ od: part.od, do: b.od });
      if (b.do.getTime() < part.do.getTime()) next.push({ od: b.do, do: part.do });
    }
    parts = next;
  }
  return parts;
}

export function prostiTermini(v: VhodTerminov): Interval[] {
  validate(v);
  if (v.urniki.length === 0) return []; // rule 1

  const earliest = addMinutes(v.zdaj, v.najkrajsaNajavaMin); // rule 7
  const needed = v.trajanjeMin + v.cistilniCasMin; // rule 6
  const blocked = [...v.odsotnosti, ...v.zasedeno]; // rules 3 and 4

  // Keyed by start time, so overlapping windows (two staff_hours rows that
  // overlap) cannot produce the same slot twice.
  const slots = new Map<number, Interval>();

  for (const okno of v.urniki) {
    const window = {
      od: toInstant(v.dan, okno.start, v.casovniPas),
      do: toInstant(v.dan, okno.end, v.casovniPas),
    };
    if (window.do.getTime() <= window.od.getTime()) {
      throw new RangeError(`An urnik must end after it starts: ${okno.start}-${okno.end}`);
    }

    for (const part of freeParts(window, blocked)) {
      // Rule 5 and 6. Steps are absolute minutes, so they stay right on DST days.
      for (
        let start = firstOnGrid(part.od, v.casovniPas, v.korakMin);
        addMinutes(start, needed).getTime() <= part.do.getTime();
        start = addMinutes(start, v.korakMin)
      ) {
        if (start.getTime() < earliest.getTime()) continue; // rule 7
        slots.set(start.getTime(), { od: start, do: addMinutes(start, v.trajanjeMin) }); // rule 8
      }
    }
  }

  return [...slots.values()].sort((a, b) => a.od.getTime() - b.od.getTime()); // rule 9
}
