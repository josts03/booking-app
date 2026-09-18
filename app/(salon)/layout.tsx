import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandStyle } from "@/lib/brand";
import { getCurrentSalon, isBookable } from "@/lib/current-salon";
import { SalonLogo } from "./_components/salon-logo";
import { Unavailable } from "./_components/unavailable";

export async function generateMetadata(): Promise<Metadata> {
  const salon = await getCurrentSalon();
  if (!salon) return {};
  return {
    title: `Rezervacija termina — ${salon.name}`,
    description: `Naročite se pri salonu ${salon.name} v nekaj korakih.`,
  };
}

export default async function SalonLayout({ children }: { children: React.ReactNode }) {
  const salon = await getCurrentSalon();
  if (!salon) notFound();

  return (
    // The salon's own color: everything below uses bg-brand, text-brand-ink, ...
    <div style={brandStyle(salon.brand_color)} className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface px-gutter">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <SalonLogo salon={salon} />
            <span className="truncate text-lg font-bold tracking-tight">{salon.name}</span>
          </div>
          {salon.phone && (
            <a
              href={`tel:${salon.phone.replace(/\s/g, "")}`}
              className="inline-flex min-h-11 shrink-0 items-center rounded-control px-3 text-sm font-medium text-brand-ink hover:bg-brand-soft"
            >
              {salon.phone}
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-gutter py-6 sm:py-10">
        {isBookable(salon) ? children : <Unavailable salon={salon} />}
      </main>

      <footer className="border-t border-line px-gutter py-6 text-sm text-ink-muted">
        <div className="mx-auto max-w-2xl space-y-1">
          <p className="font-medium text-ink">{salon.name}</p>
          {salon.address && <p>{salon.address}</p>}
          {salon.email && <p>{salon.email}</p>}
        </div>
      </footer>
    </div>
  );
}
