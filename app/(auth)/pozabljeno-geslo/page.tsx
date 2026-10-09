import Link from "next/link";
import { backLink } from "../../(salon)/_components/ui";
import { ResetRequestForm } from "./reset-request-form";

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pozabljeno geslo</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Vpišite e-naslov svojega računa. Poslali vam bomo povezavo za novo geslo.
        </p>
      </div>
      <ResetRequestForm />
      <Link href="/prijava" className={backLink}>
        ← Nazaj na prijavo
      </Link>
    </div>
  );
}
