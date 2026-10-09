"use client";

import { useActionState } from "react";
import { buttonPrimary } from "../../(salon)/_components/ui";
import { signInAction, type SignInState } from "../actions";
import { Field, FormMessage, inputProps } from "../_components/auth-ui";

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signInAction, null);
  const errors = state?.errors ?? {};

  // noValidate: messages come from the server, in Slovenian.
  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="next" value={next} />

      <Field label="E-naslov" name="email" error={errors.email}>
        <input
          {...inputProps("email", errors.email)}
          type="email"
          inputMode="email"
          autoComplete="username"
          defaultValue={state?.email ?? ""}
          required
        />
      </Field>

      <Field label="Geslo" name="password" error={errors.password}>
        <input {...inputProps("password", errors.password)} type="password" autoComplete="current-password" required />
      </Field>

      {state?.message && <FormMessage tone="error">{state.message}</FormMessage>}

      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Prijavljam …" : "Prijava"}
      </button>
    </form>
  );
}
