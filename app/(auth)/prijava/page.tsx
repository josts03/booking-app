import { safeNextPath } from "@/lib/safe-next";
import { isSuperPath } from "@/lib/super-admin";
import { FormMessage } from "../_components/auth-ui";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: PageProps<"/prijava">) {
  const params = await searchParams;
  const signedOut = params.odjava === "1";
  const next = safeNextPath(params.next);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {isSuperPath(next) ? "Prijava v nadzorno ploščo" : "Prijava v admin"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Vpišite e-naslov in geslo svojega računa.</p>
      </div>
      {signedOut && <FormMessage tone="info">Odjavljeni ste.</FormMessage>}
      <SignInForm next={next} />
    </div>
  );
}
