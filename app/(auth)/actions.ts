"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requestPasswordReset, setNewPassword, signInWithPassword, signOut } from "@/lib/auth";
import { getCurrentSalon } from "@/lib/current-salon";
import { getSalonRole, noteRateLimitHit, rateLimitReached } from "@/lib/data";
import { clientIp, RATE_LIMITS, rateLimitBucket } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-next";
import { isSuperAdminEmail, isSuperPath } from "@/lib/super-admin";
import { salonOrigin } from "@/lib/tenant";

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
 * With next=/super (the platform owner's dashboard, on the main domain) no
 * salon is needed: only the SUPER_ADMIN_EMAIL account stays signed in.
 *
 * At most 10 attempts per IP address in 15 minutes (specs/security.md, decision
 * 3a); Supabase Auth limits attempts as well.
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

  const ip = clientIp(await headers());
  if (ip) {
    const now = new Date();
    const bucket = rateLimitBucket(RATE_LIMITS.signInPerIp, ip);
    if (await rateLimitReached(bucket, RATE_LIMITS.signInPerIp, now)) return { message: RATE_LIMITS.signInPerIp.message, email };
    await noteRateLimitHit(bucket, now);
  }

  const next = safeNextPath(formData.get("next"));
  const toSuper = isSuperPath(next);
  try {
    const salon = toSuper ? null : await getCurrentSalon();
    if (!toSuper && !salon) return { message: FAILED, email };

    const result = await signInWithPassword(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      if (result.reason === "invalid") return { message: "E-naslov ali geslo ni pravilno.", email };
      if (result.reason === "rate-limited") {
        return { message: "Preveč poskusov. Poskusite znova čez nekaj minut.", email };
      }
      return { message: FAILED, email };
    }

    if (toSuper) {
      if (!isSuperAdminEmail(result.user.email)) {
        await signOut();
        return { message: "Ta račun nima dostopa do nadzorne plošče.", email };
      }
    } else if (!(await getSalonRole(salon!.id, result.user.id))) {
      await signOut();
      return { message: `Ta račun nima dostopa do salona ${salon!.name}.`, email };
    }
  } catch {
    return { message: FAILED, email };
  }

  // redirect() throws, so it must stay outside the try/catch.
  redirect(next);
}

/** Signs out of this salon's admin. */
export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/prijava?odjava=1");
}

// ---------- forgotten password ----------

export type ResetRequestState = {
  sent?: boolean;
  message?: string;
  errors?: { email?: string };
  email: string;
} | null;

const EmailSchema = SignInSchema.shape.email;

/**
 * Sends a reset link for this salon's sign-in. The answer is always the same
 * whether or not the account exists, so the form cannot be used to find out
 * who has one. At most 5 requests per IP address an hour: each one can send an
 * e-mail, and the e-mail quota is shared with the customers' confirmations.
 * Supabase itself also limits how often a link can be requested.
 */
export async function requestResetAction(_previous: ResetRequestState, formData: FormData): Promise<ResetRequestState> {
  const email = text(formData, "email").trim();
  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) return { errors: { email: parsed.error.issues[0]?.message }, email };

  const ip = clientIp(await headers());
  if (ip) {
    const now = new Date();
    const bucket = rateLimitBucket(RATE_LIMITS.resetPerIp, ip);
    if (await rateLimitReached(bucket, RATE_LIMITS.resetPerIp, now)) return { message: RATE_LIMITS.resetPerIp.message, email };
    await noteRateLimitHit(bucket, now);
  }

  try {
    const salon = await getCurrentSalon();
    if (!salon) return { message: FAILED, email };
    await requestPasswordReset(parsed.data, `${salonOrigin(salon.slug)}/novo-geslo`);
  } catch (error) {
    console.error(`[auth] requestReset failed: ${error instanceof Error ? error.message : "?"}`);
    return { message: FAILED, email };
  }
  return { sent: true, email };
}

export type NewPasswordField = "password" | "repeat";

export type NewPasswordState = {
  message?: string;
  /** The link must be requested again (expired, used, or not a link at all). */
  linkInvalid?: boolean;
  errors?: Partial<Record<NewPasswordField, string>>;
  /**
   * The token was used and the user is signed in by it: the next try needs no
   * token. Only a hint for which path to take; lib/auth.ts then requires a
   * session that a reset link created a few minutes ago.
   */
  verified?: boolean;
} | null;

/** Same minimum as Supabase > Authentication > Providers > Email (set it to 10 there too). */
const MIN_PASSWORD_LENGTH = 10;

const NewPasswordSchema = z
  .object({
    // bcrypt, which Supabase uses, reads at most 72 bytes.
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Geslo naj ima vsaj ${MIN_PASSWORD_LENGTH} znakov.`)
      .refine((value) => new TextEncoder().encode(value).length <= 72, "Geslo je predolgo."),
    repeat: z.string(),
  })
  .refine((value) => value.password === value.repeat, { path: ["repeat"], message: "Gesli se ne ujemata." });

/** A token_hash from the reset link: hex, as Supabase makes it. Anything else is not a link. */
const TokenHashSchema = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/);

/** Sets the new password from a reset link, then opens the admin. */
export async function newPasswordAction(previous: NewPasswordState, formData: FormData): Promise<NewPasswordState> {
  const verified = previous?.verified === true;
  const parsed = NewPasswordSchema.safeParse({ password: text(formData, "password"), repeat: text(formData, "repeat") });
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    return { errors: { password: fieldErrors.password?.[0], repeat: fieldErrors.repeat?.[0] }, verified };
  }

  const token = TokenHashSchema.safeParse(text(formData, "token_hash"));
  if (!verified && !token.success) {
    return { message: "Povezava ni veljavna. Zahtevajte novo.", linkInvalid: true };
  }

  try {
    const result = await setNewPassword(verified ? null : token.data!, parsed.data.password);
    if (!result.ok) {
      const messages = {
        "link-invalid": "Povezava je potekla ali je že bila uporabljena. Zahtevajte novo.",
        weak: "Geslo je prešibko. Izberite daljše geslo, ki ga ne uporabljate drugje.",
        same: "Novo geslo mora biti drugačno od starega.",
        failed: FAILED,
      } as const;
      return {
        message: messages[result.reason],
        linkInvalid: result.reason === "link-invalid",
        verified: result.verified || verified,
      };
    }
  } catch {
    return { message: FAILED, verified };
  }
  redirect("/admin");
}
