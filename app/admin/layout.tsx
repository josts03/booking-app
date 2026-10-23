import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { brandStyle } from "@/lib/brand";
import { getAdminAccess } from "@/lib/admin-access";
import { signOutAction } from "../(auth)/actions";
import { SalonLogo } from "../(salon)/_components/salon-logo";
import { AdminNav } from "./_components/admin-nav";
import { buttonSecondary } from "./_components/ui";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin shell. Phone: top bar + fixed tab bar at the bottom (thumb reach).
 * Desktop: sidebar. Only for a signed-in member of this salon
 * (lib/admin-access.ts); every admin query checks that again (lib/data.ts).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await getAdminAccess();

  if (!access.ok) {
    if (access.reason === "no-salon") notFound();
    if (access.reason === "signed-out") redirect("/prijava");
    const { salon, user } = access;
    return (
      <div style={brandStyle(salon.brand_color)} className="flex min-h-dvh items-center bg-canvas px-gutter py-10">
        <main className="mx-auto w-full max-w-sm space-y-4 rounded-card border border-line bg-surface p-6 shadow-card">
          <h1 className="text-xl font-semibold tracking-tight">Nimate dostopa</h1>
          <p className="text-ink-muted">
            Račun {user.email ?? ""} nima dostopa do salona {salon.name}. Odjavite se in se prijavite z drugim
            računom.
          </p>
          <SignOutButton className="w-full" />
        </main>
      </div>
    );
  }

  const { salon, user } = access;
  return (
    <div style={brandStyle(salon.brand_color)} className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-6 md:p-4">
        <div className="flex items-center gap-3 px-1 pt-1">
          <SalonLogo salon={salon} />
          <span className="truncate font-semibold tracking-tight">{salon.name}</span>
        </div>
        <AdminNav variant="side" isOwner={access.role === "owner"} />
        <div className="mt-auto space-y-2 border-t border-line px-1 pt-4">
          {user.email && <p className="truncate text-xs text-ink-muted">{user.email}</p>}
          <SignOutButton className="w-full" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-gutter md:hidden">
          <SalonLogo salon={salon} />
          <span className="min-w-0 flex-1 truncate font-semibold tracking-tight">{salon.name}</span>
          <SignOutButton />
        </header>

        <main className="flex-1 px-gutter py-5 pb-24 md:px-8 md:py-8 md:pb-10">{children}</main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <AdminNav variant="bottom" isOwner={access.role === "owner"} />
      </div>
    </div>
  );
}

function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={`${buttonSecondary} ${className}`}>
        Odjava
      </button>
    </form>
  );
}
