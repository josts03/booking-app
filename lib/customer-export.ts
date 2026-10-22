/**
 * The two customer exports as CSV (lib/csv.ts): the salon's whole list, and
 * one customer with every booking (a GDPR access request). Pure: data in, file
 * text out. Dates in the Slovenian notation, in the salon's time zone.
 */
import { STATUS_LABELS } from "./booking-status";
import { toCsv, type CsvValue } from "./csv";
import { formatDate, formatDateTime, formatTime } from "./format";
import { formatPhone } from "./phone";
import type { CustomerExport, CustomerSummary } from "./types";

/** 2550 -> "25,50": a number Slovenian Excel can add up (no € sign). */
function euros(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

const yesNo = (value: boolean) => (value ? "da" : "ne");
const phone = (value: string | null) => (value ? formatPhone(value) : null);

const SOURCES: Record<string, string> = { online: "spletno naročanje", admin: "vnos salona" };

export function customersCsv(rows: CustomerSummary[], timezone: string): string {
  const header = [
    "Ime",
    "Priimek",
    "Telefon",
    "E-pošta",
    "Soglasje za akcije",
    "Interna opomba",
    "Termini (brez odpovedanih)",
    "Zadnji obisk",
    "Stranka od",
  ];
  return toCsv([
    header,
    ...rows.map(({ customer: c, bookings_count, last_visit_at }): CsvValue[] => [
      c.first_name,
      c.last_name,
      phone(c.phone),
      c.email,
      yesNo(c.marketing_consent),
      c.notes,
      bookings_count,
      last_visit_at ? formatDate(last_visit_at, timezone) : null,
      formatDate(c.created_at, timezone),
    ]),
  ]);
}

export function customerCsv(data: CustomerExport, timezone: string, exportedAt: Date): string {
  const c = data.customer;
  return toCsv([
    ["Podatki stranke"],
    ["Ime", c.first_name],
    ["Priimek", c.last_name],
    ["Telefon", phone(c.phone)],
    ["E-pošta", c.email],
    ["Soglasje za obveščanje o akcijah", yesNo(c.marketing_consent)],
    ["Interna opomba salona", c.notes],
    ["Stranka od", formatDate(c.created_at, timezone)],
    ["Anonimizirana", c.anonymized_at ? formatDate(c.anonymized_at, timezone) : "ne"],
    ["Izvoženo", formatDateTime(exportedAt.toISOString(), timezone)],
    [],
    ["Termini"],
    ["Datum", "Ura", "Storitev", "Izvajalec", "Status", "Cena (€)", "Opomba stranke", "Interna opomba salona", "E-pošta za termin", "Vir"],
    ...data.bookings.map((b): CsvValue[] => [
      formatDate(b.starts_at, timezone),
      formatTime(b.starts_at, timezone),
      b.service_name,
      b.staff_name,
      STATUS_LABELS[b.status],
      euros(b.price_cents),
      b.customer_note,
      b.internal_note,
      b.contact_email,
      SOURCES[b.source] ?? b.source,
    ]),
  ]);
}
