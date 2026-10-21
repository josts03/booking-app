"use client";

import { useActionState, useState } from "react";
import { formatDuration, formatPrice } from "@/lib/format";
import { buttonPrimary, buttonSecondary, inputClass } from "../../_components/ui";
import { createBookingAction, type NewBookingField, type NewBookingState } from "./actions";

export interface FormService {
  id: string;
  name: string;
  category: string | null;
  duration_min: number;
  price_cents: number;
}

interface Props {
  services: FormService[];
  staff: { id: string; name: string }[];
  /** service id -> ids of the staff who perform it */
  performers: Record<string, string[]>;
  /** An existing customer chosen above, or null: then a new one is typed in. */
  customer: { id: string; name: string; hasEmail: boolean } | null;
  defaults: { date: string; time: string; staff: string; service: string };
}

function FieldError({ name, error }: { name: string; error?: string }) {
  return error ? (
    <p id={`${name}-error`} className="mt-1 text-xs text-danger">
      {error}
    </p>
  ) : null;
}

/**
 * The salon's form for a booking entered by hand. The staff list follows the
 * chosen service (only who performs it). Everything is checked again on the
 * server; outside working hours the server asks and "Vseeno shrani" confirms.
 */
export function NewBookingForm({ services, staff, performers, customer, defaults }: Props) {
  const [state, action, pending] = useActionState<NewBookingState, FormData>(createBookingAction, null);
  const values = state?.values;
  const errors: Partial<Record<NewBookingField, string>> = state?.errors ?? {};

  const [serviceId, setServiceId] = useState(values?.service ?? defaults.service ?? services[0]?.id ?? "");
  const allowed = staff.filter((member) => performers[serviceId]?.includes(member.id));
  const [chosenStaff, setChosenStaff] = useState(values?.staff ?? defaults.staff);
  const staffId = allowed.some((member) => member.id === chosenStaff) ? chosenStaff : (allowed[0]?.id ?? "");

  const input = (name: NewBookingField, props: React.InputHTMLAttributes<HTMLInputElement>, label: string) => (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={values?.[name] ?? ""}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
        className={`${inputClass} ${errors[name] ? "border-danger" : ""}`}
        {...props}
      />
      <FieldError name={name} error={errors[name]} />
    </div>
  );

  const categories = [...new Set(services.map((s) => s.category ?? "Ostalo"))];

  return (
    <form action={action} noValidate className="space-y-5">
      {customer ? (
        <input type="hidden" name="customer_id" value={customer.id} />
      ) : (
        <fieldset className="space-y-4 rounded-card border border-line bg-surface p-4">
          <legend className="px-1 text-sm font-semibold">Nova stranka</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {input("first_name", { type: "text", autoComplete: "off", required: true }, "Ime *")}
            {input("last_name", { type: "text", autoComplete: "off" }, "Priimek")}
          </div>
          {input("phone", { type: "tel", inputMode: "tel", autoComplete: "off", placeholder: "040 123 456", required: true }, "Telefon *")}
          {input("email", { type: "email", inputMode: "email", autoComplete: "off" }, "E-pošta (neobvezno)")}
        </fieldset>
      )}

      <fieldset className="space-y-4 rounded-card border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-semibold">Termin</legend>
        <div>
          <label htmlFor="service" className="mb-1 block text-sm font-medium">
            Storitev
          </label>
          <select
            id="service"
            name="service"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
            className={inputClass}
          >
            {categories.map((category) => (
              <optgroup key={category} label={category}>
                {services
                  .filter((s) => (s.category ?? "Ostalo") === category)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {formatDuration(s.duration_min)} · {formatPrice(s.price_cents)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <FieldError name="service" error={errors.service} />
        </div>

        <div>
          <label htmlFor="staff" className="mb-1 block text-sm font-medium">
            Zaposleni
          </label>
          <select
            id="staff"
            name="staff"
            value={staffId}
            onChange={(event) => setChosenStaff(event.target.value)}
            className={inputClass}
          >
            {allowed.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          {allowed.length === 0 && <p className="mt-1 text-xs text-danger">Te storitve ne izvaja nihče.</p>}
          <FieldError name="staff" error={errors.staff} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="date" className="mb-1 block text-sm font-medium">
              Dan
            </label>
            <input id="date" name="date" type="date" defaultValue={values?.date ?? defaults.date} required className={inputClass} />
            <FieldError name="date" error={errors.date} />
          </div>
          <div>
            <label htmlFor="time" className="mb-1 block text-sm font-medium">
              Ura
            </label>
            <input id="time" name="time" type="time" step={300} defaultValue={values?.time ?? defaults.time} required className={inputClass} />
            <FieldError name="time" error={errors.time} />
          </div>
        </div>

        <div>
          <label htmlFor="note" className="mb-1 block text-sm font-medium">
            Interna opomba (stranka je ne vidi)
          </label>
          <textarea
            id="note"
            name="note"
            rows={2}
            maxLength={1000}
            defaultValue={values?.note ?? ""}
            className={`${inputClass} h-auto py-2`}
          />
          <FieldError name="note" error={errors.note} />
        </div>
      </fieldset>

      {(!customer || customer.hasEmail) && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="notify"
            defaultChecked={values ? values.notify === "on" : true}
            className="size-5 accent-brand"
          />
          Pošlji stranki potrditev po e-pošti{!customer && " (če ste vpisali e-pošto)"}
        </label>
      )}

      {state?.outsideHours ? (
        <div className="space-y-3 rounded-control border border-warning/40 bg-warning/10 p-4">
          <p className="font-medium text-warning">{state.message} Vseeno shranim termin?</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="submit" disabled={pending} className={buttonSecondary}>
              Preveri znova
            </button>
            <button type="submit" name="force" value="1" disabled={pending} className={buttonPrimary}>
              Vseeno shrani
            </button>
          </div>
        </div>
      ) : (
        <>
          {state?.message && (
            <p role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger">
              {state.message}
            </p>
          )}
          <button type="submit" disabled={pending || allowed.length === 0} className={`${buttonPrimary} w-full`}>
            {pending ? "Shranjujem …" : "Shrani termin"}
          </button>
        </>
      )}
    </form>
  );
}
