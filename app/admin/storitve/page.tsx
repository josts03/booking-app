import { notFound } from "next/navigation";
import { getCurrentSalon } from "@/lib/current-salon";
import { getServices } from "@/lib/data";
import { pageTitle } from "../_components/ui";
import { ServiceForm } from "./service-form";
import { SERVICE_GRID_LG } from "./service-grid";

export default async function ServicesPage() {
  const salon = await getCurrentSalon();
  if (!salon) notFound();

  const services = await getServices(salon.id, { includeInactive: true });
  const categories = [...new Set(services.map((s) => s.category).filter((c): c is string => !!c))];

  return (
    <div className="space-y-5">
      <div>
        <h1 className={pageTitle}>Storitve</h1>
        <p className="mt-1 text-ink-muted">
          Uredite polja in pritisnite Shrani. Sprememba cene velja za nove rezervacije, obstoječe
          ohranijo ceno, s katero so bile narejene. Neaktivne storitve stranke ne vidijo.
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
          <span className="w-24" />
        </div>

        {services.map((service) => (
          <ServiceForm key={service.id} service={service} categories={categories} />
        ))}
      </div>

      <details className="group rounded-card border border-dashed border-line">
        <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-brand-ink">
          + Nova storitev
        </summary>
        <div className="p-3 pt-0">
          {/* key: a new empty form after every added service */}
          <ServiceForm key={services.length} categories={categories} />
        </div>
      </details>
    </div>
  );
}
