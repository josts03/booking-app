import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentSalon, isBookable } from "@/lib/current-salon";
import { getBookingByCancelToken, getServices, getStaff } from "@/lib/data";
import {
  formatDuration,
  formatPrice,
  formatTime,
  formatWeekdayDate,
} from "@/lib/format";
import { buttonSecondary } from "../../../_components/ui";

// The URL contains the cancel token: keep it out of search engines.
export const metadata: Metadata = {
  title: "Potrditev termina",
  robots: { index: false, follow: false },
};

export default async function ConfirmationPage({
  params,
}: PageProps<"/rezervacija/potrditev/[token]">) {
  const { token } = await params;

  const salon = await getCurrentSalon();
  if (!salon) notFound();
  if (!isBookable(salon)) return null; // the layout shows the "unavailable" page

  // Looked up by the full token, and it must belong to this salon.
  const booking = await getBookingByCancelToken(token);
  if (!booking || booking.salon_id !== salon.id) notFound();

  const [services, staff] = await Promise.all([
    getServices(salon.id, { includeInactive: true }),
    getStaff(salon.id, { includeInactive: true }),
  ]);
  const service = services.find((s) => s.id === booking.service_id);
  const member = staff.find((s) => s.id === booking.staff_id);
  const tz = salon.timezone;

  const cancelled = booking.status === "cancelled";
  const pending = booking.status === "pending";
  const title = cancelled
    ? "Ta termin je odpovedan"
    : pending
      ? "Zahtevek za termin je oddan"
      : "Termin je rezerviran";

  const rows: [string, string][] = [
    ["Storitev", service ? `${service.name} · ${formatDuration(service.duration_min)}` : "—"],
    ["Zaposleni", member?.name ?? "—"],
    [
      "Termin",
      `${formatWeekdayDate(booking.starts_at, tz)} ob ${formatTime(booking.starts_at, tz)}`,
    ],
    ["Cena", formatPrice(booking.price_cents)],
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand text-brand-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </span>
        <h1 className="mt-4 text-title font-bold">{title}</h1>
        {pending && (
          <p className="mt-2 text-ink-muted">Salon vam bo termin še potrdil.</p>
        )}
      </div>

      <dl className="divide-y divide-line rounded-card border border-line bg-surface">
        {rows.map(([label, value]) => (
          <div key={label} className="px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
            <dd className="mt-0.5 font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink">{salon.name}</p>
        {salon.address && <p>{salon.address}</p>}
        <p className="mt-3">
          Termin lahko brezplačno odpoveste ali prestavite do {salon.cancel_window_hours} ur pred
          začetkom.
          {salon.phone && (
            <>
              {" "}
              Pokličite nas na{" "}
              <a href={`tel:${salon.phone.replace(/\s/g, "")}`} className="font-medium text-brand-ink underline">
                {salon.phone}
              </a>
              .
            </>
          )}
        </p>
      </div>

      <Link href="/rezervacija" className={`${buttonSecondary} w-full`}>
        Nova rezervacija
      </Link>
    </div>
  );
}
