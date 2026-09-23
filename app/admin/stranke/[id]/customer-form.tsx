"use client";

import { useActionState, useId, useState } from "react";
import type { Customer } from "@/lib/types";
import { buttonPrimary, buttonSecondary, card, inputClass } from "../../_components/ui";
import {
  eraseCustomer,
  saveCustomer,
  type CustomerField,
  type CustomerFormState,
} from "./actions";

const dangerButton =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-danger px-4 text-sm font-semibold text-danger transition-colors hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60";

/** The salon's own record of a customer, plus the GDPR erasure. */
export function CustomerForm({ customer }: { customer: Customer }) {
  const [state, action, pending] = useActionState<CustomerFormState, FormData>(saveCustomer, null);
  const [eraseState, eraseAction, erasePending] = useActionState<CustomerFormState, FormData>(
    eraseCustomer,
    null,
  );
  const ids = useId();
  const [confirming, setConfirming] = useState(false);

  // An erased customer has nothing left to edit.
  if (customer.anonymized_at) {
    return (
      <section className={`${card} p-5`}>
        <h2 className="text-lg font-bold">Podatki stranke</h2>
        <p className="mt-2 text-ink-muted">
          Osebni podatki te stranke so bili izbrisani na zahtevo (GDPR). Termini
          ostanejo v zgodovini, ker salon potrebuje svoje številke, imena in
          kontakta pa ni več mogoče obnoviti.
        </p>
      </section>
    );
  }

  const values = state?.values;
  const errors = state?.errors ?? {};

  const initial: Record<CustomerField, string> = {
    first_name: customer.first_name,
    last_name: customer.last_name ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    notes: customer.notes ?? "",
  };

  function field(
    key: CustomerField,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
  ) {
    const error = errors[key];
    return (
      <div>
        <label htmlFor={`${key}-${ids}`} className="mb-1.5 block text-sm font-medium">
          {label}
        </label>
        <input
          id={`${key}-${ids}`}
          name={key}
          defaultValue={values?.[key] ?? initial[key]}
          aria-invalid={error ? true : undefined}
          className={`${inputClass} ${error ? "border-danger" : ""}`}
          {...props}
        />
        {error && <p className="mt-1.5 text-sm font-medium text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <>
      <section className={`${card} p-5`}>
        <h2 className="text-lg font-bold">Podatki stranke</h2>
        <form action={action} noValidate className="mt-5 space-y-5">
          <input type="hidden" name="id" value={customer.id} />

          <div className="grid gap-5 sm:grid-cols-2">
            {field("first_name", "Ime", { type: "text", required: true, maxLength: 80 })}
            {field("last_name", "Priimek", { type: "text", maxLength: 80 })}
            {field("phone", "Telefon", { type: "tel", autoComplete: "tel" })}
            {field("email", "E-pošta", { type: "email", autoComplete: "email" })}
          </div>

          <div>
            <label htmlFor={`notes-${ids}`} className="mb-1.5 block text-sm font-medium">
              Interna opomba
            </label>
            <textarea
              id={`notes-${ids}`}
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={values?.notes ?? initial.notes}
              placeholder="Vidi samo salon. Npr. barva, alergije, želje."
              className={`${inputClass} h-auto py-2`}
            />
            {errors.notes && (
              <p className="mt-1.5 text-sm font-medium text-danger">{errors.notes}</p>
            )}
          </div>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="marketing_consent"
              defaultChecked={
                values ? values.marketing_consent === "on" : customer.marketing_consent
              }
              className="mt-0.5 size-6 shrink-0 accent-brand"
            />
            <span>
              <span className="block text-sm font-medium">Soglaša z obveščanjem o akcijah</span>
              <span className="block text-sm text-ink-muted">
                Brez soglasja stranki ne pošiljamo oglasnih sporočil.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={pending} className={buttonPrimary}>
              {pending ? "Shranjujem …" : "Shrani"}
            </button>
            {state?.message && (
              <p
                role="status"
                className={`text-sm font-medium ${state.ok ? "text-success" : "text-danger"}`}
              >
                {state.message}
              </p>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-card border border-danger/30 bg-surface p-5">
        <h2 className="text-lg font-bold">Izbris osebnih podatkov</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Na zahtevo stranke (GDPR). Ime, telefon, e-pošta in opombe se
          nepovratno izbrišejo. Termini ostanejo v zgodovini brez imena, da
          ostanejo vaše številke pravilne.
        </p>

        {confirming ? (
          <form action={eraseAction} className="mt-4 space-y-3">
            <input type="hidden" name="id" value={customer.id} />
            <p className="text-sm font-medium">
              Res izbrišem osebne podatke? Tega ni mogoče razveljaviti.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={erasePending} className={dangerButton}>
                {erasePending ? "Brišem …" : "Da, izbriši"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={erasePending}
                className={buttonSecondary}
              >
                Prekliči
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`${dangerButton} mt-4`}
          >
            Izbriši osebne podatke
          </button>
        )}

        {eraseState?.message && !eraseState.ok && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {eraseState.message}
          </p>
        )}
      </section>
    </>
  );
}
