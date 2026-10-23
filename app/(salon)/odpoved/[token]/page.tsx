import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canCancel, cancelDeadline } from "@/lib/cancel";
import { getCurrentSalon, isBookable } from "@/lib/current-salon";
import { getBookingByCancelToken } from "@/lib/data";
import { formatDateTime, formatDuration, formatPrice, formatTime, formatWeekdayDate } from "@/lib/format";
import { buttonSecondary } from "../../_components/ui";
import { CancelForm } from "./cancel-form";

// The URL holds the cancel token: keep it out of search engines and other sites.
export const metadata: Metadata = {
  title: "Odpoved termina",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Opened from the link in the confirmation or reminder e-mail. Finds the
 * booking by its full cancel_token (never by id), only in the salon of this
 * host, and offers to cancel it while it is more than cancel_window_hours away.
 */
export default async function CancelPage({ params, searchParams }: PageProps<"/odpoved/[token]">) {
  const [{ token }, query] = await Promise.all([params, searchParams]);

  const salon = await getCurrentSalon();
  if (!salon) notFound();
  if (!isBookable(salon)) return null; // the layout shows the "unavailable" page

  // Looked up by the full token, only in this salon.
  const view = await getBookingByCancelToken(salon.id, token);
  if (!view) {
    return (
      <Message title="Rezervacije ni mogoče najti">
        Povezava je morda nepopolna. Odprite jo še enkrat iz e-pošte ali pokličite salon.
      </Message>
    );
  }

  const { booking, service, staffName } = view;
  const tz = salon.timezone;
  const now = new Date();

  const rows: [string, string][] = [
    ["Storitev", service ? `${service.name} · ${formatDuration(service.duration_min)}` : "—"],
    ["Zaposleni", staffName ?? "—"],
    ["Termin", `${formatWeekdayDate(booking.starts_at, tz)} ob ${formatTime(booking.starts_at, tz)}`],
    ["Cena", formatPrice(booking.price_cents)],
  ];
  const details = (
    <dl className="divide-y divide-line rounded-card border border-line bg-surface">
      {rows.map(([label, value]) => (
        <div key={label} className="px-4 py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
          <dd className="mt-0.5 font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
  const callSalon = salon.phone && (
    <>
      {" "}
      Pokličite nas na{" "}
      <a href={`tel:${salon.phone.replace(/[^\d+]/g, "")}`} className="font-medium text-brand-ink underline">
        {salon.phone}
      </a>
      .
    </>
  );
  const newBooking = (
    <Link href="/rezervacija" className={`${buttonSecondary} w-full`}>
      Nova rezervacija
    </Link>
  );

  if (booking.status === "cancelled") {
    const justNow = query.odpovedano === "1";
    return (
      <div className="space-y-6">
        <Message title={justNow ? "Termin je odpovedan" : "Ta termin je že odpovedan"}>
          {justNow ? "Hvala, ker ste nam sporočili. Termin je zdaj prost za druge stranke." : null}
        </Message>
        {details}
        {newBooking}
      </div>
    );
  }

  const active = booking.status === "pending" || booking.status === "confirmed";
  if (!active || Date.parse(booking.starts_at) <= now.getTime()) {
    return (
      <div className="space-y-6">
        <Message title="Ta termin je že mimo" />
        {details}
        {newBooking}
      </div>
    );
  }

  if (!canCancel(booking, salon.cancel_window_hours, now)) {
    return (
      <div className="space-y-6">
        <Message title="Odpoved prek spleta ni več mogoča">
          Termin je bilo mogoče odpovedati do{" "}
          {formatDateTime(cancelDeadline(booking.starts_at, salon.cancel_window_hours).toISOString(), tz)}.
          {callSalon}
        </Message>
        {details}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-title font-semibold">Odpoved termina</h1>
        <p className="mt-2 text-ink-muted">
          Ali res želite odpovedati ta termin? Odpovedi ni mogoče preklicati, za nov termin se boste morali naročiti
          znova.
        </p>
      </div>
      {details}
      <CancelForm token={booking.cancel_token} />
      <p className="text-center text-sm text-ink-muted">
        Ne želite odpovedati? Ta stran lahko preprosto zaprete.
      </p>
    </div>
  );
}

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-title font-semibold">{title}</h1>
      {children && <p className="text-ink-muted">{children}</p>}
    </div>
  );
}
