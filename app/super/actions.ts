"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSalonWithOwner, PLATFORM_MESSAGES, setSalonStatus } from "@/lib/data";
import { salonInviteEmail, sendEmail } from "@/lib/email";
import { getSuperAccess, NO_SUPER_ACCESS } from "@/lib/super-access";
import { SUBSCRIPTION_STATUS_LABELS, SUBSCRIPTION_STATUSES } from "@/lib/super-admin";
import { salonOrigin } from "@/lib/tenant";

export type SuperState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  values?: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const StatusSchema = z.object({ id: z.uuid(), status: z.enum(SUBSCRIPTION_STATUSES) });

/**
 * Switches a salon on or off (subscription_status). The answer names the salon
 * and its new status, so a click on the wrong card is noticed at once.
 */
export async function setStatusAction(_previous: SuperState, formData: FormData): Promise<SuperState> {
  const parsed = StatusSchema.safeParse({ id: text(formData, "id"), status: text(formData, "status") });
  if (!parsed.success) return { message: PLATFORM_MESSAGES.invalid };
  const access = await getSuperAccess();
  if (!access.ok) return { message: NO_SUPER_ACCESS };

  const result = await setSalonStatus(parsed.data.id, parsed.data.status);
  if (!result.ok) return { message: result.error };
  // The salon's booking page and admin read the status too.
  revalidatePath("/", "layout");
  const { label, bookable } = SUBSCRIPTION_STATUS_LABELS[result.value.subscription_status];
  return {
    ok: true,
    message: `${result.value.name}: status je zdaj »${label}« (${bookable ? "naročanje deluje" : "naročanje ne deluje"}).`,
  };
}

/** Same as the salons_slug_format check (002) and SLUG_PATTERN in lib/data.ts. */
const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const NewSalonSchema = z.object({
  name: z.string().min(1, "Vpišite ime salona.").max(80, "Ime je predolgo."),
  slug: z
    .string()
    .min(2, "Vsaj 2 znaka.")
    .max(40, "Največ 40 znakov.")
    .regex(SLUG, "Samo male črke brez šumnikov, številke in vezaj (ne na začetku ali koncu)."),
  owner_email: z.string().max(254, "Vpišite veljaven e-naslov.").pipe(z.email("Vpišite veljaven e-naslov.")),
});

/**
 * A new salon, its first user as owner, and the invitation e-mail (specs/mvp.md).
 * The e-mail is sent here, not after the response, so the platform owner sees
 * whether it went out.
 */
export async function createSalonAction(_previous: SuperState, formData: FormData): Promise<SuperState> {
  const values = {
    name: text(formData, "name"),
    slug: text(formData, "slug").toLowerCase(),
    owner_email: text(formData, "owner_email").toLowerCase(),
  };
  const parsed = NewSalonSchema.safeParse(values);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { errors, values, message: "Preverite označena polja." };
  }
  const access = await getSuperAccess();
  if (!access.ok) return { message: NO_SUPER_ACCESS, values };

  const result = await createSalonWithOwner(parsed.data);
  if (!result.ok) {
    const slugProblem = result.error === PLATFORM_MESSAGES.slugTaken || result.error === PLATFORM_MESSAGES.slugReserved;
    return slugProblem ? { errors: { slug: result.error }, values } : { message: result.error, values };
  }
  revalidatePath("/super");

  const { salon, owner, setPasswordToken } = result;
  const origin = salonOrigin(salon.slug);
  const fallback = `Lastnik naj na ${origin}/pozabljeno-geslo vpiše ${owner.email} in si nastavi geslo.`;
  if (owner.isNew && !setPasswordToken) {
    return { ok: true, message: `Salon ${salon.name} je ustvarjen, vabila pa ni bilo mogoče pripraviti. ${fallback}` };
  }
  const sent = await sendEmail({
    ...salonInviteEmail({
      salonName: salon.name,
      salonSlug: salon.slug,
      ownerEmail: owner.email,
      setPasswordToken,
      replyTo: access.user.email,
    }),
    to: owner.email,
    idempotencyKey: `invite:${salon.id}`,
  });
  if (!sent.ok) {
    // Resend's test sender delivers only to the Resend account's own address, and
    // Supabase's reset e-mails go through the same Resend, so the fallback fails too.
    const testSender = /@resend\.dev>?\s*$/i.test(process.env.EMAIL_FROM ?? "");
    const hint = testSender
      ? "Resend s testnim pošiljateljem (@resend.dev) pošilja samo na e-naslov vašega Resend računa, zato tudi pozabljeno geslo ne bo delovalo. Za vabila drugim naslovom v Resendu preverite svojo domeno."
      : fallback;
    return { ok: true, message: `Salon ${salon.name} je ustvarjen, e-pošte z vabilom pa ni bilo mogoče poslati. ${hint}` };
  }
  return {
    ok: true,
    message: owner.isNew
      ? `Salon ${salon.name} je ustvarjen. Vabilo za nastavitev gesla je poslano na ${owner.email}.`
      : `Salon ${salon.name} je ustvarjen. Račun ${owner.email} že obstaja, zato je poslano obvestilo, da ima dostop tudi do tega salona.`,
  };
}
