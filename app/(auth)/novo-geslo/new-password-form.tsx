"use client";

import Link from "next/link";
import { useActionState } from "react";
import { buttonPrimary, buttonSecondary } from "../../(salon)/_components/ui";
import { newPasswordAction, type NewPasswordState } from "../actions";
import { Field, FormMessage, inputProps } from "../_components/auth-ui";

export function NewPasswordForm({ tokenHash }: { tokenHash: string }) {
  const [state, formAction, pending] = useActionState<NewPasswordState, FormData>(newPasswordAction, null);
  const errors = state?.errors ?? {};

  if (state?.linkInvalid) {
    return (
      <div className="space-y-5">
        <FormMessage tone="error">{state.message}</FormMessage>
        <Link href="/pozabljeno-geslo" className={`${buttonSecondary} w-full`}>
          Zahtevaj novo povezavo
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="token_hash" value={tokenHash} />

      <Field label="Novo geslo (vsaj 10 znakov)" name="password" error={errors.password}>
        <input {...inputProps("password", errors.password)} type="password" autoComplete="new-password" required />
      </Field>

      <Field label="Ponovite geslo" name="repeat" error={errors.repeat}>
        <input {...inputProps("repeat", errors.repeat)} type="password" autoComplete="new-password" required />
      </Field>

      {state?.message && <FormMessage tone="error">{state.message}</FormMessage>}

      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Shranjujem …" : "Shrani geslo"}
      </button>
    </form>
  );
}
