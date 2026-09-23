import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSignedInStaff } from "@/lib/auth";
import { brandStyle } from "@/lib/brand";
import { getCurrentSalon } from "@/lib/current-salon";
import { SalonLogo } from "../(salon)/_components/salon-logo";
import { AdminNav } from "./_components/admin-nav";
import { SignOutButton } from "./_components/sign-out";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin shell. Phone: top bar + fixed tab bar at the bottom (thumb reach).
 * Desktop: sidebar.
 *
 * This is the check that matters. proxy.ts already turned signed-out visitors
 * away, but that was an optimistic guess from a cookie; here we ask Supabase
 * who the user is and whether they are active staff of THIS salon, so someone
 * signed in to salon A cannot open salon B by changing the subdomain.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const salon = await getCurrentSalon();
  if (!salon) notFound();

  const staff = await getSignedInStaff();
  if (!staff) redirect("/prijava");

  return (
    <div style={brandStyle(salon.brand_color)} className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-6 md:p-4">
        <div className="flex items-center gap-3 px-1 pt-1">
          <SalonLogo salon={salon} />
          <span className="truncate font-bold tracking-tight">{salon.name}</span>
        </div>
        <AdminNav variant="side" />
        <div className="mt-auto border-t border-line pt-3">
          <p className="truncate px-3 text-sm font-medium">{staff.name}</p>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-gutter md:hidden">
          <SalonLogo salon={salon} />
          <span className="truncate font-bold tracking-tight">{salon.name}</span>
          <SignOutButton className="ml-auto" />
        </header>

        <main className="flex-1 px-gutter py-5 pb-24 md:px-8 md:py-8 md:pb-10">{children}</main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <AdminNav variant="bottom" />
      </div>
    </div>
  );
}
