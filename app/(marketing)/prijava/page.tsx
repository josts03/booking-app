import type { Metadata } from "next";
import { FormShell } from "../_components/shell";
import { PRODUCT_NAME } from "../_components/ui";
import { SignInForm } from "./signin-form";

export const metadata: Metadata = {
  title: `Prijava — ${PRODUCT_NAME}`,
  description: "Prijavite se v svoj salon.",
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: PageProps<"/prijava">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <FormShell title="Prijava" lead="Vpišite se v koledar svojega salona.">
      <SignInForm next={next} />
    </FormShell>
  );
}
