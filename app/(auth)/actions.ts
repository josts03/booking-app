"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signInWithPassword, signOut } from "@/lib/auth";
import { getCurrentSalon } from "@/lib/current-salon";
import { getSalonRole } from "@/lib/data";
import { safeNextPath } from "@/lib/safe-next";

export type SignInField = "email" | "password";

export type SignInState = {
  message?: string;
  errors?: Partial<Record<SignInField, string>>;
  /** The e-mail is kept so it need not be typed again; the password never is. */
  email: string;
} | null;

const SignInSchema = z.object({
  email: z.string().trim().max(254, "Vpišite veljaven e-naslov.").pipe(z.email("Vpišite veljaven e-naslov.")),
  password: z.string().min(1, "Vpišite geslo.").max(200, "Geslo je predolgo."),
});

const FAILED = "Prijava trenutno ni mogoča. Poskusite znova čez nekaj minut.";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Signs in to the admin of the salon on this host. A wrong e-mail and a wrong
 * password get the same sentence, so the form does not reveal who has an
 * account. Someone with a valid account who is not a member of THIS salon is
 * signed out again at once.
 *
 * TODO(week 11): limit attempts per e-mail and IP (rate_limits, specs/security.md).
 */
export async function signInAction(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = text(formData, "email").trim();
  const parsed = SignInSchema.safeParse({ email, password: text(formData, "password") });
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    return {
      errors: { email: fieldErrors.email?.[0], password: fieldErrors.password?.[0] },
      email,
    };
  }

  let salonId: string;
  let salonName: string;
  try {
    const salon = await getCurrentSalon();
    if (!salon) return { message: FAILED, email };
    ({ id: salonId, name: salonName } = salon);

    const result = await signInWithPassword(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      if (result.reason === "invalid") return { message: "E-naslov ali geslo ni pravilno.", email };
      if (result.reason === "rate-limited") {
        return { message: "Preveč poskusov. Poskusite znova čez nekaj minut.", email };
      }
      return { message: FAILED, email };
    }

    if (!(await getSalonRole(salonId, result.user.id))) {
      await signOut();
      return { message: `Ta račun nima dostopa do salona ${salonName}.`, email };
    }
  } catch {
    return { message: FAILED, email };
  }

  // redirect() throws, so it must stay outside the try/catch.
  redirect(safeNextPath(formData.get("next")));
}

/** Signs out of this salon's admin. */
export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/prijava?odjava=1");
}
