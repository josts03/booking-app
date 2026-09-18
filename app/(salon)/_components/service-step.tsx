import Link from "next/link";
import { formatDuration, formatPrice } from "@/lib/format";
import type { Service } from "@/lib/types";
import { flowHref } from "./flow-url";
import { choiceCard } from "./ui";

const NO_CATEGORY = "Storitve";

/** Step 1: services grouped by category, each with duration and price. */
export function ServiceStep({ services }: { services: Service[] }) {
  // Map keeps first-seen order; `services` already arrive sorted by sort_order.
  const groups = new Map<string, Service[]>();
  for (const service of services) {
    const key = service.category ?? NO_CATEGORY;
    groups.set(key, [...(groups.get(key) ?? []), service]);
  }

  return (
    <section className="space-y-6">
      <h1 className="text-title font-bold">Izberite storitev</h1>

      {services.length === 0 && (
        <p className="rounded-card border border-line bg-surface p-5 text-ink-muted">
          Salon trenutno nima storitev za spletno naročanje.
        </p>
      )}

      {[...groups].map(([category, items]) => (
        <div key={category}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {category}
          </h2>
          <ul className="space-y-3">
            {items.map((service) => (
              <li key={service.id}>
                <Link href={flowHref({ service: service.id })} className={`${choiceCard} justify-between`}>
                  <span>
                    <span className="block font-semibold">{service.name}</span>
                    {service.description && (
                      <span className="mt-0.5 block text-sm text-ink-muted">
                        {service.description}
                      </span>
                    )}
                    <span className="mt-1 block text-sm text-ink-muted">
                      {formatDuration(service.duration_min)}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold">{formatPrice(service.price_cents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
