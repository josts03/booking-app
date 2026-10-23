import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { brandStyle } from "@/lib/brand";
import { getCurrentSalon } from "@/lib/current-salon";
import { requestHost, subdomainOf } from "@/lib/tenant";
import { SalonLogo } from "../(salon)/_components/salon-logo";
import { TermiLogo } from "../_components/termi-logo";

export const metadata: Metadata = {
  title: "Prijava",
  robots: { index: false, follow: false },
};

/**
 * Sign-in and password pages of the salon's admin, on the salon's own
 * subdomain (the session cookie belongs to that host). Not inside (salon): a
 * suspended salon's owner must still be able to sign in.
 *
 * On the main domain without a salon (production has no "test" salon there)
 * the pages show the platform's logo and brand color (globals.css :root): the
 * platform owner signs in there for /super.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const salon = await getCurrentSalon();
  if (!salon) {
    if (subdomainOf(requestHost(await headers()) ?? "")) notFound();
    return (
      <div className="flex min-h-dvh flex-col bg-canvas px-gutter py-10">
        <main className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex justify-center">
            <TermiLogo className="h-8 w-auto" />
          </div>
          <div className="rounded-card border border-line bg-surface p-6 shadow-card">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div style={brandStyle(salon.brand_color)} className="flex min-h-dvh flex-col bg-canvas px-gutter py-10">
      <main className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-3">
          <SalonLogo salon={salon} />
          <span className="truncate text-lg font-semibold tracking-tight">{salon.name}</span>
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-card">{children}</div>
      </main>
    </div>
  );
}
