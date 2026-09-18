import type { Salon } from "@/lib/types";

/** Shown instead of the booking flow when the salon's subscription is not active. */
export function Unavailable({ salon }: { salon: Salon }) {
  return (
    <div className="rounded-card border border-line bg-surface p-6 text-center">
      <h1 className="text-2xl font-bold">Naročanje trenutno ni mogoče</h1>
      <p className="mt-3 text-ink-muted">
        Spletno naročanje pri salonu {salon.name} je začasno izklopljeno.
        {salon.phone ? " Za termin nas pokličite." : " Poskusite znova kasneje."}
      </p>
      {salon.phone && (
        <a
          href={`tel:${salon.phone.replace(/\s/g, "")}`}
          className="mt-5 inline-flex min-h-12 items-center justify-center rounded-control bg-brand px-6 font-semibold text-brand-foreground"
        >
          {salon.phone}
        </a>
      )}
    </div>
  );
}
