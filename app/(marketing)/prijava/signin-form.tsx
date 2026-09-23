"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import {
  buttonPrimary,
  errorClass,
  inputClass,
  labelClass,
  TRIAL_HREF,
} from "../_components/ui";
import { submitSignIn, type SignInFormState } from "./actions";

/**
 * Sign-in form for salon owners. It is the finished screen for a feature whose
 * server half does not exist yet: submitting always answers that sign-in is not
 * switched on (see lib/data.ts signIn), so nobody is led to believe otherwise.
 */
export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<SignInFormState, FormData>(submitSignIn, null);
  const ids = useId();

  return (
    <form action={action} noValidate className="space-y-5">
      <input type="hidden" name="next" value={next ?? ""} />

      <div>
        <label className="block" htmlFor={`email-${ids}`}>
          <span className={labelClass}>E-naslov</span>
        </label>
        <input
          id={`email-${ids}`}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state?.email ?? ""}
          aria-invalid={state?.errors?.email ? true : undefined}
          className={`${inputClass} ${state?.errors?.email ? "border-danger" : ""}`}
        />
        {state?.errors?.email && <p className={errorClass}>{state.errors.email}</p>}
      </div>

      <div>
        <label className="block" htmlFor={`password-${ids}`}>
          <span className={labelClass}>Geslo</span>
        </label>
        <input
          id={`password-${ids}`}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state?.errors?.password ? true : undefined}
          className={`${inputClass} ${state?.errors?.password ? "border-danger" : ""}`}
        />
        {state?.errors?.password && <p className={errorClass}>{state.errors.password}</p>}
      </div>

      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Prijavljam …" : "Prijava"}
      </button>

      {state?.message && (
        <p role="alert" className="rounded-control bg-warning/10 p-3 text-sm font-medium text-warning">
          {state.message}
        </p>
      )}

      <p className="text-sm text-ink-muted">
        Še nimate salona?{" "}
        <Link href={TRIAL_HREF} className="font-medium text-brand-ink underline underline-offset-4">
          Ustvarite ga brezplačno
        </Link>
        .
      </p>
    </form>
  );
}
