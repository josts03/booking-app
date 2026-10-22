import { formatDate, formatTime } from "@/lib/format";

/**
 * "25. 9. 2026", "25. 9. 2026–27. 9. 2026", or for part of a day
 * "25. 9. 2026, 10:00–12:00". ends_at is exclusive.
 */
export function absenceDates(startsAt: string, endsAt: string, timeZone: string): string {
  const first = formatDate(startsAt, timeZone);
  const last = formatDate(new Date(Date.parse(endsAt) - 1).toISOString(), timeZone);
  const wholeDays = formatTime(startsAt, timeZone) === "00:00" && formatTime(endsAt, timeZone) === "00:00";
  if (!wholeDays) return `${first}, ${formatTime(startsAt, timeZone)}–${formatTime(endsAt, timeZone)}`;
  return first === last ? first : `${first}–${last}`;
}
