import { notFound } from "next/navigation";
import { getAdminAccess } from "@/lib/admin-access";
import { getCurrentSalon } from "@/lib/current-salon";
import { getServices, getStaff, getStaffServices } from "@/lib/data";
import { formatDuration, formatPrice } from "@/lib/format";
import { card, pageTitle } from "../_components/ui";
import { ServiceForm } from "./service-form";
import { SERVICE_GRID_LG } from "./service-grid";

export default async function ServicesPage() {
  const salon = await getCurrentSalon();
  if (!salon) notFound();

  const [services, staffList, links, access] = await Promise.all([
    getServices(salon.id, { includeInactive: true }),
    getStaff(salon.id, { includeInactive: true }),
    getStaffServices(salon.id),
    getAdminAccess(),
  ]);
  const categories = [...new Set(services.map((s) => s.category).filter((c): c is string => !!c))];
  const staff = staffList.filter((m) => m.is_active).map((m) => ({ id: m.id, name: m.name }));
  const performersOf = (serviceId: string) => links.filter((l) => l.service_id === serviceId).map((l) => l.staff_id);

  // A staff member's account: the list only (decision of 22. 10. 2026).
  if (!(access.ok && access.role === "owner")) {
    const names = new Map(staffList.map((m) => [m.id, m.name]));
    return (
      <div className="space-y-5">
        <div>
          <h1 className={pageTitle}>Storitve</h1>
          <p className="mt-1 text-ink-muted">Storitve lahko ureja samo lastnik salona.</p>
        </div>
        <ul className="space-y-3">
          {services.map((service) => (
            <li key={service.id} className={`${card} p-4 ${service.is_active ? "" : "opacity-70"}`}>
              <p className="font-semibold">{service.name}</p>
              <p className="text-sm text-ink-muted">
                {formatDuration(service.duration_min)} · {formatPrice(service.price_cents)}
                {service.is_active ? "" : " · neaktivna"}
              </p>
              <p className="mt-1 text-sm">{performersOf(service.id).map((id) => names.get(id)).filter(Boolean).join(", ") || "Nihče"}</p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className={pageTitle}>Storitve</h1>
        <p className="mt-1 text-ink-muted">
          Uredite polja in pritisnite Shrani. Sprememba cene velja za nove rezervacije, obstoječe
          ohranijo ceno, s katero so bile narejene. Neaktivne storitve stranke ne vidijo. Kdor nima
          kljukice pri „Kdo izvaja“, te storitve pri njem ni mogoče rezervirati.
        </p>
      </div>

      <div className="space-y-3">
        {/* Header of the table, large screens only. */}
        <div
          aria-hidden="true"
          className={`hidden gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted lg:grid ${SERVICE_GRID_LG}`}
        >
          <span>Ime</span>
          <span>Kategorija</span>
          <span>Trajanje (min)</span>
          <span>Čiščenje (min)</span>
          <span>Cena (€)</span>
          <span>Stanje</span>
          <span />
        </div>

        {services.map((service) => (
          <ServiceForm key={service.id} service={service} categories={categories} staff={staff} performers={performersOf(service.id)} />
        ))}
      </div>

      <details className="group rounded-card border border-dashed border-line">
        <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-brand-ink">
          + Nova storitev
        </summary>
        <div className="p-3 pt-0">
          {/* key: a new empty form after every added service */}
          <ServiceForm key={services.length} categories={categories} staff={staff} performers={[]} labelsVisible />
        </div>
      </details>
    </div>
  );
}
