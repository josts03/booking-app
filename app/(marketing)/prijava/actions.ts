"use server";

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
 * Signs the salon owner in.
 *
 * Phase 1: lib/data.ts has no authentication, so this always comes back with a
 * message saying so — it never pretends the visitor is signed in. When Supabase
 * Auth arrives, only the body of signIn() changes; on `ok` this action will set
 * the session cookie and redirect to /admin.
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

  // Unreachable in phase 1. With Supabase Auth: set the session, then
  // redirect("/admin").
  return { email };
}
