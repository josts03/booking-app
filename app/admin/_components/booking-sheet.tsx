import Link from "next/link";
import { safeColor } from "@/lib/brand";
import { formatDateTime, formatDuration, formatPrice, formatTime, formatWeekdayDate } from "@/lib/format";
import type { Booking, Customer, Service, Staff } from "@/lib/types";
import { BookingActions } from "./booking-actions";
import { SheetShell } from "./sheet-shell";
import { StatusBadge } from "./status-badge";
import { buttonPrimary, buttonSecondary } from "./ui";

/** Details of one booking, opened by clicking it in the calendar. */
export function BookingSheet({
  booking,
  service,
  staff,
  customer,
  timezone,
  closeHref,
}: {
  booking: Booking;
  service: Service | undefined;
  staff: Staff | undefined;
  customer: Customer | undefined;
  timezone: string;
  closeHref: string;
}) {
  const customerName = customer
    ? `${customer.first_name} ${customer.last_name ?? ""}`.trim()
    : "Neznana stranka";

  const rows: [string, React.ReactNode][] = [
    [
      "Termin",
      `${formatWeekdayDate(booking.starts_at, timezone)}, ${formatTime(booking.starts_at, timezone)}–${formatTime(booking.ends_at, timezone)}`,
    ],
    [
      "Zaposleni",
      staff ? (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 rounded-full"
            style={{ backgroundColor: safeColor(staff.color) }}
          />
          {staff.name}
        </span>
      ) : (
        "—"
      ),
    ],
    ["Stranka", customerName],
  ];
  if (customer?.phone) {
    rows.push([
      "Telefon",
      <a key="tel" href={`tel:${customer.phone.replace(/\s/g, "")}`} className="font-medium text-brand-ink underline">
        {customer.phone}
      </a>,
    ]);
  }
  if (customer?.email) {
    rows.push([
      "E-pošta",
      <a key="mail" href={`mailto:${customer.email}`} className="break-all font-medium text-brand-ink underline">
        {customer.email}
      </a>,
    ]);
  }
  rows.push(["Cena", formatPrice(booking.price_cents)]);
  if (booking.customer_note) rows.push(["Opomba stranke", booking.customer_note]);
  rows.push(["Vir", `${booking.source}, ustvarjeno ${formatDateTime(booking.created_at, timezone)}`]);

  return (
    <SheetShell closeHref={closeHref} titleId="booking-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="booking-title" className="text-xl font-bold">
            {service?.name ?? "Storitev"}
          </h2>
          {service && (
            <p className="text-sm text-ink-muted">
              {formatDuration(service.duration_min)}
              {booking.buffer_min > 0 && ` + ${formatDuration(booking.buffer_min)} čiščenje`}
            </p>
          )}
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <dl className="mt-4 divide-y divide-line">
        {rows.map(([label, value]) => (
          <div key={label} className="py-2.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
            <dd className="mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      <BookingActions booking={booking} />

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Link href={closeHref} className={buttonSecondary}>
          Zapri
        </Link>
        {customer ? (
          <Link href={`/admin/stranke/${customer.id}`} className={buttonPrimary}>
            Kartica stranke
          </Link>
        ) : (
          <span />
        )}
      </div>
    </SheetShell>
  );
}
