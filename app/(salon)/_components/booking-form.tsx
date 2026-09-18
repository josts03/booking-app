"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitBooking, type FieldName, type FormState } from "../rezervacija/actions";
import { buttonPrimary } from "./ui";

interface Props {
  service: string;
  staff: string;
  time: string;
  /** Where to pick another time, shown when the chosen one is gone. */
  pickAnotherTimeHref: string;
}

const inputClass =
  "h-12 w-full rounded-control border bg-surface px-4 text-base placeholder:text-ink-muted/60";

export function BookingForm({ service, staff, time, pickAnotherTimeHref }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(submitBooking, null);
  const errors = state?.errors ?? {};
  const values = state?.values ?? {};

  function field(name: FieldName) {
    const error = errors[name];
    return {
      id: name,
      name,
      defaultValue: values[name] ?? "",
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${name}-error` : undefined,
      className: `${inputClass} ${error ? "border-danger" : "border-line"}`,
    };
  }

  // noValidate: validation messages come from the server, in Slovenian.
  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="service" value={service} />
      <input type="hidden" name="staff" value={staff} />
      <input type="hidden" name="time" value={time} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Ime" name="first_name" error={errors.first_name} required>
          <input {...field("first_name")} type="text" autoComplete="given-name" required />
        </Field>
        <Field label="Priimek" name="last_name" error={errors.last_name}>
          <input {...field("last_name")} type="text" autoComplete="family-name" />
        </Field>
      </div>

      <Field label="Telefon" name="phone" error={errors.phone} required>
        <input {...field("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder="040 123 456" required />
      </Field>

      <Field label="E-pošta" name="email" error={errors.email} required>
        <input {...field("email")} type="email" inputMode="email" autoComplete="email" required />
      </Field>

      <Field label="Opomba (neobvezno)" name="note" error={errors.note}>
        <textarea
          {...field("note")}
          rows={3}
          maxLength={500}
          className={`${field("note").className} h-auto py-3`}
        />
      </Field>

      <div className="space-y-1">
        <Checkbox name="terms" defaultChecked={values.terms === "on"} error={errors.terms}>
          Strinjam se s pogoji poslovanja in obdelavo osebnih podatkov za namen rezervacije.{" "}
          <span className="text-ink-muted">(obvezno)</span>
        </Checkbox>
        <Checkbox name="marketing" defaultChecked={values.marketing === "on"}>
          Želim prejemati obvestila o akcijah in novostih.{" "}
          <span className="text-ink-muted">(neobvezno)</span>
        </Checkbox>
      </div>

      {state?.message && (
        <div role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-4 text-danger">
          <p>{state.message}</p>
          {state.pickAnotherTime && (
            <Link href={pickAnotherTimeHref} className="mt-2 inline-block font-semibold underline">
              Izberite drug termin
            </Link>
          )}
        </div>
      )}

      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Rezerviram …" : "Potrdi rezervacijo"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {error && (
        <p id={`${name}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Checkbox({
  name,
  error,
  defaultChecked,
  children,
}: {
  name: string;
  error?: string;
  defaultChecked: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* The whole row is the tap target (min 44 px). */}
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${name}-error` : undefined}
          className="mt-0.5 size-6 shrink-0 accent-brand"
        />
        <span className="text-sm">{children}</span>
      </label>
      {error && (
        <p id={`${name}-error`} className="pl-9 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
