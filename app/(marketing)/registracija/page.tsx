import type { Metadata } from "next";
import { headers } from "next/headers";
import { FormShell } from "../_components/shell";
import { PRODUCT_NAME } from "../_components/ui";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: `Ustvarite svoj salon — ${PRODUCT_NAME}`,
  description:
    "Ustvarite stran za spletno naročanje v nekaj minutah. 14 dni brezplačno, brez kartice.",
};

/**
 * The host salons live under. ROOT_DOMAIN is authoritative in production; in
 * development it is unset, so the current host ("localhost:3000") is used and
 * the preview matches what actually works: `salon.localhost:3000`.
 */
async function getRootDomain(): Promise<string> {
  const configured = process.env.ROOT_DOMAIN?.trim();
  if (configured) return configured.toLowerCase();
  const host = (await headers()).get("host") ?? "";
  return host.toLowerCase() || "domena.si";
}

export default async function SignupPage() {
  const rootDomain = await getRootDomain();

  return (
    <FormShell
      title="Ustvarite svoj salon"
      lead="V nekaj minutah dobite stran, na kateri se stranke naročijo same."
    >
      <SignupForm rootDomain={rootDomain} />
    </FormShell>
  );
}
