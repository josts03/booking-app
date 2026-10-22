import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatformOverview, PLATFORM_TIMEZONE } from "@/lib/data";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { getSuperAccess } from "@/lib/super-access";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/super-admin";
import { salonOrigin } from "@/lib/tenant";
import type { SubscriptionStatus } from "@/lib/types";
import { buttonPrimary, card, pageTitle } from "../admin/_components/ui";
import { StatusForm } from "./super-forms";

/** Resend's free plan: 3000 e-mails a month, 100 a day. Other plans: set the variables (.env.example). */
function quota(name: "RESEND_MONTHLY_QUOTA" | "RESEND_DAILY_QUOTA", fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const WARN_AT = 0.8;

/** 1 salon, 2 salona, 3 saloni, 5 salonov. */
function salons(n: number): string {
  const rest = n % 100;
  const word = rest === 1 ? "salon" : rest === 2 ? "salona" : rest === 3 || rest === 4 ? "saloni" : "salonov";
  return `${formatNumber(n)} ${word}`;
}

const statusStyle: Record<SubscriptionStatus, string> = {
  trial: "bg-brand-soft text-brand-ink",
  active: "bg-success/10 text-success",
  past_due: "bg-warning/10 text-warning",
  suspended: "bg-line text-ink-muted",
  cancelled: "bg-line text-ink-muted",
};

function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  const ratio = used / limit;
  const warn = ratio >= WARN_AT;
  return (
    <div className={`${card} space-y-2 p-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm text-ink-muted">{label}</h2>
        <p className="text-sm text-ink-muted">
          <span className="text-2xl font-bold text-ink tabular-nums">{formatNumber(used)}</span> / {formatNumber(limit)}
        </p>
      </div>
      {/* A meter against the plan's limit; the numbers above carry the value. */}
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-brand-soft">
        <div className={`h-full rounded-full ${warn ? "bg-warning" : "bg-brand"}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      {warn && (
        <p role="status" className="text-sm font-medium text-warning">
          <span aria-hidden="true">⚠ </span>
          {ratio >= 1
            ? "Meja je dosežena: nova e-pošta se morda ne pošilja."
            : `Porabljeno ${formatPercent(ratio)} kvote Resend. Razmislite o večjem paketu.`}
        </p>
      )}
    </div>
  );
}

/** The platform owner's overview (specs/mvp.md): salons, their status and use, e-mail quota. */
export default async function SuperPage() {
  const access = await getSuperAccess();
  if (!access.ok) notFound(); // the layout handles signed-out
  const overview = await getPlatformOverview();
  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Saloni</h1>
          <p className="mt-1 text-ink-muted">
            {salons(overview.salons.length)} · stanje{" "}
            {formatDate(now.toISOString(), PLATFORM_TIMEZONE)}
          </p>
        </div>
        <Link href="/super/nov" className={buttonPrimary}>
          Nov salon
        </Link>
      </div>

      <section aria-label="Poraba e-pošte" className="grid gap-3 sm:grid-cols-2">
        <Usage label="E-pošta ta mesec" used={overview.emails_this_month} limit={quota("RESEND_MONTHLY_QUOTA", 3000)} />
        <Usage label="E-pošta danes" used={overview.emails_today} limit={quota("RESEND_DAILY_QUOTA", 100)} />
        <p className="text-xs text-ink-muted sm:col-span-2">
          Šteje potrditve, opomnike in obvestila strankam. E-pošta za prijavo (pozabljeno geslo) ni všteta.
        </p>
      </section>

      {overview.salons.length === 0 ? (
        <p className={`${card} p-5 text-ink-muted`}>Še ni nobenega salona.</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {overview.salons.map(({ salon, bookings_this_month }) => {
            const origin = salonOrigin(salon.slug);
            const status = SUBSCRIPTION_STATUS_LABELS[salon.subscription_status];
            return (
              <li key={salon.id} className={`${card} space-y-3 p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{salon.name}</h2>
                    <a href={origin} className="block truncate text-sm text-brand-ink underline">
                      {origin.replace(/^https?:\/\//, "")}
                    </a>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle[salon.subscription_status]}`}
                  >
                    {status.label}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-ink-muted">Nove rezervacije ta mesec</dt>
                    <dd className="font-semibold tabular-nums">{formatNumber(bookings_this_month)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">
                      {salon.subscription_status === "trial" && salon.trial_ends_at ? "Preizkus do" : "Ustvarjen"}
                    </dt>
                    <dd className="font-semibold">
                      {formatDate(
                        salon.subscription_status === "trial" && salon.trial_ends_at ? salon.trial_ends_at : salon.created_at,
                        PLATFORM_TIMEZONE,
                      )}
                    </dd>
                  </div>
                </dl>
                <StatusForm salonId={salon.id} salonName={salon.name} status={salon.subscription_status} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
