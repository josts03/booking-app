import type { Metadata } from "next";
import { FormShell } from "../_components/shell";
import { PRODUCT_NAME } from "../_components/ui";
import { SignInForm } from "./signin-form";

export const metadata: Metadata = {
  title: `Prijava — ${PRODUCT_NAME}`,
  description: "Prijavite se v svoj salon.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <FormShell
      title="Prijava"
      lead="Vpišite se v koledar svojega salona."
      footer={
        <p className="rounded-control bg-warning/10 p-3 text-warning">
          Prijava še ni vklopljena: v fazi 1 baze in računov še ni, zato je{" "}
          <code className="font-mono">/admin</code> odprt vsem.
        </p>
      }
    >
      <SignInForm />
    </FormShell>
  );
}
