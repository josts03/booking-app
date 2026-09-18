/**
 * Slovenian display formats (CLAUDE.md): "21. 9. 2026, 14:30", "32 €", "1 h 30 min".
 * Time zone conversions only through date-fns-tz.
 */
import { formatInTimeZone } from "date-fns-tz";
import { sl } from "date-fns/locale";

/** Non-breaking space, so "32 €" never wraps between number and sign. */
const NBSP = String.fromCharCode(0xa0);

/** 1234567 -> "12.345,67" style grouping: dot between thousands. */
export function formatNumber(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 3200 -> "32 €", 3250 -> "32,50 €", 123400 -> "1.234 €" */
export function formatPrice(cents: number): string {
  const euros = cents / 100;
  const [whole, decimals] = (Number.isInteger(euros) ? String(euros) : euros.toFixed(2)).split(".");
  return `${formatNumber(Number(whole))}${decimals ? `,${decimals}` : ""}${NBSP}€`;
}

/** 0.624 -> "62 %" */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}${NBSP}%`;
}

/** 45 -> "45 min", 90 -> "1 h 30 min", 120 -> "2 h" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}${NBSP}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}${NBSP}h` : `${hours}${NBSP}h ${rest}${NBSP}min`;
}

/** "21. 9. 2026" */
export function formatDate(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, "d. M. yyyy");
}

/** "14:30" */
export function formatTime(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, "HH:mm");
}

/** "Torek, 22. 9. 2026" */
export function formatWeekdayDate(iso: string, timeZone: string): string {
  const text = formatInTimeZone(iso, timeZone, "EEEE, d. M. yyyy", { locale: sl });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The salon-local calendar date of an instant, "YYYY-MM-DD". */
export function localDay(iso: string | Date, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, "yyyy-MM-dd");
}

/** "21. 9. 2026, 14:30" */
export function formatDateTime(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, "d. M. yyyy, HH:mm");
}

/** Minutes since local midnight of an instant in the salon's timezone (14:30 -> 870). */
export function localMinutes(iso: string | Date, timeZone: string): number {
  const [hours, minutes] = formatInTimeZone(iso, timeZone, "HH:mm").split(":").map(Number);
  return hours * 60 + minutes;
}
