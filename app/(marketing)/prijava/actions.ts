"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/data";

export type SignInField = "email" | "password";

export type SignInFormState = {
  message?: string;
  errors?: Partial<Record<SignInField, string>>;
  /** The e-mail is kept so the visitor does not retype it; the password never is. */
  email: string;
} | null;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Signs the salon owner in and sends them to the admin.
 *
 * `next` carries where they were heading before proxy.ts turned them away. It
 * is only honoured when it points at /admin, so a crafted link cannot bounce
 * someone off to another site after signing in.
 */
export async function submitSignIn(
  _previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");

  const errors: Partial<Record<SignInField, string>> = {};
  if (!email) errors.email = "Vpišite e-naslov.";
  if (!password) errors.password = "Vpišite geslo.";
  if (Object.keys(errors).length > 0) return { errors, email };

  const result = await signIn({ email, password });
  if (!result.ok) return { message: result.error, email };

  const next = formData.get("next");
  const target = typeof next === "string" && next.startsWith("/admin") ? next : "/admin";
  redirect(target);
}
