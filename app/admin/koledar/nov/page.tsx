import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentSalon } from "@/lib/current-salon";
import { getCustomer, getCustomers, getServices, getStaff, getStaffServices } from "@/lib/data";
import { localDay } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { calendarHref } from "../../_components/calendar-url";
import { backLink, buttonSecondary, card, inputClass, pageTitle } from "../../_components/ui";
import { NewBookingForm } from "./new-booking-form";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESULTS = 8;

/**
 * A booking entered by the salon. First the customer: search the existing ones
 * (name, phone or e-mail) or type in a new one; then service, staff, day and
 * time. The calendar fills in what it knows (?date, ?time, ?staff). The search
 * is a plain GET form, so it works without JavaScript and keeps the prefill.
 */
export default async function NewBookingPage({ searchParams }: PageProps<"/admin/koledar/nov">) {
  const raw = await searchParams;
  const param = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");

  const salon = await getCurrentSalon();
  if (!salon) notFound();

  const date = DAY.test(param("date")) ? param("date") : localDay(new Date(), salon.timezone);
  const time = TIME.test(param("time")) ? param("time") : "";
  const query = param("q").slice(0, 60);
  const customerId = UUID.test(param("customer")) ? param("customer") : "";

  const [services, staffList, links, chosen, found] = await Promise.all([
    getServices(salon.id),
    getStaff(salon.id, { includeInactive: true }),
    getStaffServices(salon.id),
    customerId ? getCustomer(salon.id, customerId) : Promise.resolve(null),
    query.trim().length >= 2 ? getCustomers(salon.id, { query }) : Promise.resolve(null),
  ]);
  const staff = staffList.filter((member) => member.is_active).map((member) => ({ id: member.id, name: member.name }));
  const performers: Record<string, string[]> = {};
  for (const link of links) (performers[link.service_id] ??= []).push(link.staff_id);
  const staffParam = staff.some((member) => member.id === param("staff")) ? param("staff") : "";
  const serviceParam = services.some((service) => service.id === param("service"))
    ? param("service")
    : (services.find((service) => !staffParam || performers[service.id]?.includes(staffParam))?.id ?? "");

  /** This page with the prefill kept and some values changed. */
  const href = (changes: Record<string, string>) => {
    const params = new URLSearchParams();
    const current = { date, time, staff: staffParam, service: serviceParam, q: query, customer: customerId, ...changes };
    for (const [key, value] of Object.entries(current)) if (value) params.set(key, value);
    return `/admin/koledar/nov?${params.toString()}`;
  };
  const customerName = (c: { first_name: string; last_name: string | null }) => `${c.first_name} ${c.last_name ?? ""}`.trim();

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href={calendarHref({ view: "day", date, staff: staffParam || undefined })} className={backLink}>
        ← Koledar
      </Link>
      <h1 className={pageTitle}>Nov termin</h1>

      <section className={`${card} space-y-3 p-4`} aria-labelledby="customer-title">
        <h2 id="customer-title" className="font-semibold">
          Stranka
        </h2>
        {chosen ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{customerName(chosen)}</p>
              <p className="truncate text-sm text-ink-muted">
                {[chosen.phone ? formatPhone(chosen.phone) : null, chosen.email].filter(Boolean).join(" · ") || "Brez kontakta"}
              </p>
            </div>
            <Link href={href({ customer: "" })} className={buttonSecondary}>
              Zamenjaj
            </Link>
          </div>
        ) : (
          <>
            <form action="/admin/koledar/nov" method="get" className="flex gap-2" role="search">
              {date && <input type="hidden" name="date" value={date} />}
              {time && <input type="hidden" name="time" value={time} />}
              {staffParam && <input type="hidden" name="staff" value={staffParam} />}
              {serviceParam && <input type="hidden" name="service" value={serviceParam} />}
              <label htmlFor="q" className="sr-only">
                Poišči stranko
              </label>
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={query}
                placeholder="Ime ali telefon obstoječe stranke"
                className={inputClass}
              />
              <button type="submit" className={buttonSecondary}>
                Išči
              </button>
            </form>
            {found && (
              <ul className="divide-y divide-line">
                {found.slice(0, MAX_RESULTS).map(({ customer }) => (
                  <li key={customer.id}>
                    <Link href={href({ customer: customer.id, q: "" })} className="flex min-h-11 flex-col justify-center py-2 hover:bg-brand-soft">
                      <span className="font-medium">{customerName(customer)}</span>
                      <span className="text-sm text-ink-muted">{customer.phone ? formatPhone(customer.phone) : "brez telefona"}</span>
                    </Link>
                  </li>
                ))}
                {found.length === 0 && <li className="py-2 text-sm text-ink-muted">Ni najdenih strank. Vpišite novo spodaj.</li>}
                {found.length > MAX_RESULTS && (
                  <li className="py-2 text-sm text-ink-muted">Najdenih je več strank. Iskanje zožite.</li>
                )}
              </ul>
            )}
            <p className="text-sm text-ink-muted">Ali vpišite novo stranko spodaj.</p>
          </>
        )}
      </section>

      <NewBookingForm
        // A different customer or prefill: a fresh form.
        key={`${customerId}-${date}-${time}-${staffParam}`}
        services={services.map(({ id, name, category, duration_min, price_cents }) => ({ id, name, category, duration_min, price_cents }))}
        staff={staff}
        performers={performers}
        customer={chosen ? { id: chosen.id, name: customerName(chosen), hasEmail: Boolean(chosen.email) } : null}
        defaults={{ date, time, staff: staffParam, service: serviceParam }}
      />
    </div>
  );
}
