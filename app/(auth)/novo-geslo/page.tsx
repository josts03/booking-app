import type { Metadata } from "next";
import Link from "next/link";
import { buttonSecondary } from "../../(salon)/_components/ui";
import { FormMessage } from "../_components/auth-ui";
import { NewPasswordForm } from "./new-password-form";

// The URL holds a one-time token: never send it on to another site.
export const metadata: Metadata = {
  title: "Novo geslo",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Opened from the reset e-mail: /novo-geslo?token_hash=...&type=recovery.
 * Opening the page does not use the token; sending the form does (lib/auth.ts).
 */
export default async function NewPasswordPage({ searchParams }: PageProps<"/novo-geslo">) {
  const { token_hash: tokenHash, type } = await searchParams;
  const hasLink = typeof tokenHash === "string" && tokenHash.length > 0 && type === "recovery";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo geslo</h1>
        {hasLink && <p className="mt-1 text-sm text-ink-muted">Izberite novo geslo za svoj račun.</p>}
      </div>
      {hasLink ? (
        <NewPasswordForm tokenHash={tokenHash} />
      ) : (
        <>
          <FormMessage tone="error">Ta povezava ni veljavna. Zahtevajte novo.</FormMessage>
          <Link href="/pozabljeno-geslo" className={`${buttonSecondary} w-full`}>
            Zahtevaj novo povezavo
          </Link>
        </>
      )}
    </div>
  );
}
