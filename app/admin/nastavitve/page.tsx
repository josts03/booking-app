import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentSalon } from "@/lib/current-salon";
import { formatDate } from "@/lib/format";
import type { SubscriptionStatus } from "@/lib/types";
import { card, pageTitle } from "../_components/ui";
import { SettingsForm } from "./settings-form";

/** Slovenian names for salons.subscription_status. */
const SUBSCRIPTION_LABEL: Record<SubscriptionStatus, string> = {
  trial: "Preizkusno obdobje",
  active: "Aktivna",
  past_due: "Zapadlo plačilo",
  suspended: "Začasno ustavljena",
  cancelled: "Preklicana",
};

/** The host salons live under; in development the current one. */
async function getRootDomain(): Promise<string> {
  const configured = process.env.ROOT_DOMAIN?.trim();
  if (configured) return configured.toLowerCase();
  const host = (await headers()).get("host") ?? "";
  return host.toLowerCase() || "domena.si";
}

export default async function SettingsPage() {
  const salon = await getCurrentSalon();
  if (!salon) notFound();
  const rootDomain = await getRootDomain();
  const bookingHost = `${salon.slug}.${rootDomain}`;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className={pageTitle}>Nastavitve</h1>
        <p className="mt-1 text-ink-muted">
          Podatki salona, videz in pravila naročanja.
        </p>
      </div>

      <SettingsForm salon={salon} />

      {/* Read-only: these belong to the platform, not to the salon owner. */}
      <section className={`${card} p-5`}>
        <h2 className="text-lg font-bold">Naročnina in naslov</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Tega ni mogoče spremeniti tukaj. Za spremembo nam pišite.
        </p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink-muted">Spletni naslov</dt>
            <dd className="mt-0.5 font-medium">
              <a
                href={`//${bookingHost}`}
                className="break-all text-brand-ink underline underline-offset-4"
              >
                {bookingHost}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Lastna domena</dt>
            <dd className="mt-0.5 font-medium">
              {salon.custom_domain ?? <span className="text-ink-muted">ni nastavljena</span>}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Naročnina</dt>
            <dd className="mt-0.5 font-medium">
              {SUBSCRIPTION_LABEL[salon.subscription_status]}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">
              {salon.subscription_status === "trial" ? "Preizkus traja do" : "Salon ustvarjen"}
            </dt>
            <dd className="mt-0.5 font-medium">
              {salon.subscription_status === "trial" && salon.trial_ends_at
                ? formatDate(salon.trial_ends_at, salon.timezone)
                : formatDate(salon.created_at, salon.timezone)}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
