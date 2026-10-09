import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandStyle } from "@/lib/brand";
import { getCurrentSalon } from "@/lib/current-salon";
import { SalonLogo } from "../(salon)/_components/salon-logo";

export const metadata: Metadata = {
  title: "Prijava",
  robots: { index: false, follow: false },
};

/**
 * Sign-in and password pages of the salon's admin, on the salon's own
 * subdomain (the session cookie belongs to that host). Not inside (salon): a
 * suspended salon's owner must still be able to sign in.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const salon = await getCurrentSalon();
  if (!salon) notFound();

  return (
    <div style={brandStyle(salon.brand_color)} className="flex min-h-dvh flex-col bg-canvas px-gutter py-10">
      <main className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-3">
          <SalonLogo salon={salon} />
          <span className="truncate text-lg font-bold tracking-tight">{salon.name}</span>
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-card">{children}</div>
      </main>
    </div>
  );
}
