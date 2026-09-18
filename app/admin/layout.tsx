import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandStyle } from "@/lib/brand";
import { getCurrentSalon } from "@/lib/current-salon";
import { SalonLogo } from "../(salon)/_components/salon-logo";
import { AdminNav } from "./_components/admin-nav";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin shell. Phone: top bar + fixed tab bar at the bottom (thumb reach).
 * Desktop: sidebar. NO LOGIN YET: /admin is open to everyone.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const salon = await getCurrentSalon();
  if (!salon) notFound();

  return (
    <div style={brandStyle(salon.brand_color)} className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-6 md:p-4">
        <div className="flex items-center gap-3 px-1 pt-1">
          <SalonLogo salon={salon} />
          <span className="truncate font-bold tracking-tight">{salon.name}</span>
        </div>
        <AdminNav variant="side" />
      </aside>

      <div className="flex min-w-0 flex-col">
        <p className="bg-warning/10 px-gutter py-1 text-center text-xs font-medium text-warning">
          Prijava še ni vklopljena: ta stran je trenutno odprta vsem.
        </p>

        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-gutter md:hidden">
          <SalonLogo salon={salon} />
          <span className="truncate font-bold tracking-tight">{salon.name}</span>
        </header>

        <main className="flex-1 px-gutter py-5 pb-24 md:px-8 md:py-8 md:pb-10">{children}</main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <AdminNav variant="bottom" />
      </div>
    </div>
  );
}
