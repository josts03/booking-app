"use client";

import { useActionState } from "react";
import { buttonPrimary } from "../../(salon)/_components/ui";
import { requestResetAction, type ResetRequestState } from "../actions";
import { Field, FormMessage, inputProps } from "../_components/auth-ui";

export function ResetRequestForm() {
  const [state, formAction, pending] = useActionState<ResetRequestState, FormData>(requestResetAction, null);

  if (state?.sent) {
    return (
      <FormMessage tone="info">
        Če račun s tem e-naslovom obstaja, smo nanj poslali povezavo za novo geslo. Povezava velja eno uro. Preverite
        tudi mapo z vsiljeno pošto.
      </FormMessage>
    );
  }

  const error = state?.errors?.email;
  return (
    <form action={formAction} noValidate className="space-y-5">
      <Field label="E-naslov" name="email" error={error}>
        <input
          {...inputProps("email", error)}
          type="email"
          inputMode="email"
          autoComplete="email"
          defaultValue={state?.email ?? ""}
          required
        />
      </Field>

      {state?.message && <FormMessage tone="error">{state.message}</FormMessage>}

      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Pošiljam …" : "Pošlji povezavo"}
      </button>
    </form>
  );
}
