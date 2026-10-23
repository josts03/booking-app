import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSuperAccess } from "@/lib/super-access";
import { signOutAction } from "../(auth)/actions";
import { buttonSecondary } from "../admin/_components/ui";
import { TermiLogo } from "../_components/termi-logo";

export const metadata: Metadata = {
  title: "Nadzorna plošča",
  robots: { index: false, follow: false },
};

/**
 * The platform owner's dashboard (specs/mvp.md), on the main domain only. For
 * anyone but SUPER_ADMIN_EMAIL it does not exist (404), so it does not even
 * reveal itself. Every page, action and query checks again (lib/super-access.ts,
 * lib/data.ts superOnly).
 */
export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const access = await getSuperAccess();
  if (!access.ok) {
    if (access.reason === "signed-out") redirect("/prijava?next=/super");
    notFound();
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-gutter md:px-8">
          <Link href="/super" className="inline-flex min-h-11 shrink-0 items-center">
            <TermiLogo className="h-6 w-auto" />
          </Link>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">Nadzorna plošča</span>
          {access.user.email && (
            <span className="hidden truncate text-xs text-ink-muted sm:block">{access.user.email}</span>
          )}
          <form action={signOutAction}>
            <button type="submit" className={buttonSecondary}>
              Odjava
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-gutter py-5 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
