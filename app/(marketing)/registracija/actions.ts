"use server";

import { createSalon, isSlugAvailable } from "@/lib/data";

export type SignupField = "name" | "slug" | "email" | "phone";

export type SignupFormState = {
  ok?: boolean;
  /** Set on success: the slug the salon got, for the "your address" link. */
  slug?: string;
  message?: string;
  errors?: Partial<Record<SignupField, string>>;
  values: Record<string, string>;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Registers a new salon from the public form.
 * TODO: rate limiting, e-mail confirmation and the owner's account (weeks 6-7).
 */
export async function signUp(
  _previous: SignupFormState,
  formData: FormData,
): Promise<SignupFormState> {
  const values = {
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
  };

  const errors: Partial<Record<SignupField, string>> = {};
  if (!values.name) errors.name = "Vpišite ime salona.";
  if (!values.slug) errors.slug = "Vpišite spletni naslov.";
  if (!values.email) errors.email = "Vpišite e-naslov.";
  if (Object.keys(errors).length > 0) return { errors, values };

  const result = await createSalon({
    name: values.name,
    slug: values.slug,
    email: values.email,
    phone: values.phone || null,
  });

  if (!result.ok) {
    return result.field
      ? { errors: { [result.field]: result.error }, values }
      : { message: result.error, values };
  }

  return {
    ok: true,
    slug: result.salon.slug,
    message: "Salon je ustvarjen.",
    values,
  };
}

/** Live check while typing, so the visitor is not surprised after submitting. */
export async function checkSlug(slug: string): Promise<boolean> {
  return isSlugAvailable(slug);
}
