import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentSalon } from "@/lib/current-salon";
import {
  getCustomer,
  getCustomerBookings,
  getServices,
  getStaff,
} from "@/lib/data";
import { formatPrice, formatTime, formatWeekdayDate, localDay } from "@/lib/format";
import type { Booking } from "@/lib/types";
import { calendarHref } from "../../_components/calendar-url";
import { StatusBadge } from "../../_components/status-badge";
import { backLink, card, pageTitle } from "../../_components/ui";
import { CustomerForm } from "./customer-form";

export default async function CustomerPage({ params }: PageProps<"/admin/stranke/[id]">) {
  const { id } = await params;

  const salon = await getCurrentSalon();
  if (!salon) notFound();
  const tz = salon.timezone;

  const customer = await getCustomer(salon.id, id);
  if (!customer) notFound();

  const [bookings, services, staff] = await Promise.all([
    getCustomerBookings(salon.id, customer.id),
    getServices(salon.id, { includeInactive: true }),
    getStaff(salon.id, { includeInactive: true }),
  ]);
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const staffName = new Map(staff.map((s) => [s.id, s.name]));

  const now = new Date();
  const isUpcoming = (b: Booking) =>
    new Date(b.starts_at) > now && (b.status === "pending" || b.status === "confirmed");
  const upcoming = bookings.filter(isUpcoming).reverse(); // soonest first
  const history = bookings.filter((b) => !isUpcoming(b)); // newest first

  const completed = bookings.filter((b) => b.status === "completed");
  const stats = [
    ["Obiski", String(completed.length)],
    ["Neprihodi", String(bookings.filter((b) => b.status === "no_show").length)],
    ["Odpovedi", String(bookings.filter((b) => b.status === "cancelled").length)],
    ["Skupaj", formatPrice(completed.reduce((sum, b) => sum + b.price_cents, 0))],
  ];

  const name = customer.anonymized_at
    ? "Anonimizirana stranka"
    : `${customer.first_name} ${customer.last_name ?? ""}`.trim();

  function row(booking: Booking) {
    return (
      <li key={booking.id}>
        <Link
          href={calendarHref({ view: "day", date: localDay(booking.starts_at, tz), booking: booking.id })}
          className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-brand-soft"
        >
          <span className="min-w-0">
            <span className="block font-medium">
              {formatWeekdayDate(booking.starts_at, tz)}, {formatTime(booking.starts_at, tz)}
            </span>
            <span className="block truncate text-sm text-ink-muted">
              {serviceName.get(booking.service_id) ?? "Storitev"} · {staffName.get(booking.staff_id) ?? "—"} ·{" "}
              {formatPrice(booking.price_cents)}
            </span>
          </span>
          <StatusBadge status={booking.status} />
        </Link>
      </li>
    );
  }

  return (
    <div className="space-y-5">
      <Link href="/admin/stranke" className={backLink}>
        <span aria-hidden="true">←</span> Vse stranke
      </Link>

      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-bold text-brand-foreground"
        >
          {customer.first_name[0]}
          {customer.last_name?.[0]}
        </span>
        <div className="min-w-0">
          <h1 className={`${pageTitle} truncate`}>{name}</h1>
          <p className="text-sm text-ink-muted">
            {customer.marketing_consent
              ? "Soglaša z obveščanjem o akcijah"
              : "Brez soglasja za obveščanje o akcijah"}
          </p>
        </div>
      </div>

      <div className={`${card} divide-y divide-line`}>
        {customer.phone && (
          <a href={`tel:${customer.phone.replace(/\s/g, "")}`} className="flex min-h-12 items-center justify-between px-4 py-2">
            <span className="text-sm text-ink-muted">Telefon</span>
            <span className="font-medium text-brand-ink underline">{customer.phone}</span>
          </a>
        )}
        {customer.email && (
          <a href={`mailto:${customer.email}`} className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
            <span className="text-sm text-ink-muted">E-pošta</span>
            <span className="break-all font-medium text-brand-ink underline">{customer.email}</span>
          </a>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className={`${card} p-4`}>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <CustomerForm customer={customer} />

      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Prihajajoči termini</h2>
          <ul className={`${card} divide-y divide-line overflow-hidden`}>{upcoming.map(row)}</ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Zgodovina</h2>
        {history.length === 0 ? (
          <p className={`${card} p-5 text-ink-muted`}>Ta stranka še nima preteklih terminov.</p>
        ) : (
          <ul className={`${card} divide-y divide-line overflow-hidden`}>{history.map(row)}</ul>
        )}
      </section>
    </div>
  );
}
