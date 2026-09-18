import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentSalon } from "@/lib/current-salon";
import { getCustomers } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { buttonPrimary, card, inputClass, pageTitle } from "../_components/ui";

export default async function CustomersPage({ searchParams }: PageProps<"/admin/stranke">) {
  const raw = await searchParams;
  const query = typeof raw.q === "string" ? raw.q.trim().slice(0, 60) : "";

  const salon = await getCurrentSalon();
  if (!salon) notFound();
  const tz = salon.timezone;

  const customers = await getCustomers(salon.id, { query });

  return (
    <div className="space-y-5">
      <h1 className={pageTitle}>Stranke</h1>

      <form action="/admin/stranke" role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Ime, telefon ali e-pošta"
          aria-label="Iskanje strank"
          autoComplete="off"
          className={inputClass}
        />
        <button type="submit" className={`${buttonPrimary} shrink-0`}>
          Išči
        </button>
      </form>

      <p className="text-sm text-ink-muted" aria-live="polite">
        {query
          ? `${customers.length} ${customers.length === 1 ? "zadetek" : "zadetkov"} za »${query}«`
          : `${customers.length} strank`}
        {query && (
          <>
            {" · "}
            <Link href="/admin/stranke" className="font-medium text-brand-ink underline">
              Počisti iskanje
            </Link>
          </>
        )}
      </p>

      {customers.length === 0 ? (
        <p className={`${card} p-5 text-ink-muted`}>Ni strank, ki bi ustrezale iskanju.</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {customers.map(({ customer, bookings_count, last_visit_at, next_visit_at }) => {
            const name = customer.anonymized_at
              ? "Anonimizirana stranka"
              : `${customer.first_name} ${customer.last_name ?? ""}`.trim();
            return (
              <li key={customer.id}>
                <Link
                  href={`/admin/stranke/${customer.id}`}
                  className={`${card} flex min-h-16 items-center gap-3 p-4 transition-colors hover:border-brand`}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-ink"
                  >
                    {customer.first_name[0]}
                    {customer.last_name?.[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{name}</span>
                    <span className="block truncate text-sm text-ink-muted">
                      {customer.phone ?? customer.email ?? "Brez kontakta"}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-muted">
                      {bookings_count} {bookings_count === 1 ? "obisk" : "obiskov"}
                      {last_visit_at && ` · zadnjič ${formatDate(last_visit_at, tz)}`}
                    </span>
                    {next_visit_at && (
                      <span className="mt-1.5 inline-block rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
                        Naslednji termin {formatDate(next_visit_at, tz)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
