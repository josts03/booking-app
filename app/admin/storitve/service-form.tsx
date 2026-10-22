"use client";

import { useActionState } from "react";
import type { Service } from "@/lib/types";
import { buttonPrimary, inputClass } from "../_components/ui";
import { saveService, type ServiceField, type ServiceFormState } from "./actions";
import { SERVICE_GRID_LG } from "./service-grid";

/** 3200 -> "32", 3250 -> "32,50" */
function priceText(cents: number): string {
  const euros = cents / 100;
  return Number.isInteger(euros) ? String(euros) : euros.toFixed(2).replace(".", ",");
}

/**
 * One row of the services table, and at the same time a form: edit the fields
 * and press "Shrani". Phone: stacked card with visible labels. Large screen:
 * one table row (the labels stay for screen readers, the page shows a header),
 * with "Kdo izvaja" on a line of its own below. `labelsVisible`: the new
 * service's form, which is not under the header, shows its labels everywhere.
 */
export function ServiceForm({
  service,
  categories,
  staff,
  performers,
  labelsVisible = false,
}: {
  service?: Service;
  categories: string[];
  /** Active staff members, for "who performs it". */
  staff: { id: string; name: string }[];
  /** Ids of the staff who perform this service now. */
  performers: string[];
  labelsVisible?: boolean;
}) {
  const [state, action, pending] = useActionState<ServiceFormState, FormData>(saveService, null);
  const values = state?.values;
  const errors = state?.errors ?? {};

  const initial = {
    name: service?.name ?? "",
    category: service?.category ?? "",
    duration: String(service?.duration_min ?? 30),
    buffer: String(service?.buffer_after_min ?? 0),
    price: service ? priceText(service.price_cents) : "",
  };
  const value = (key: keyof typeof initial) => values?.[key] ?? initial[key];
  const active = values ? values.is_active === "on" : (service?.is_active ?? true);

  function field(
    name: ServiceField,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
  ) {
    const error = errors[name];
    return (
      <div>
        <label className="block">
          <span className={`mb-1 block text-xs font-medium text-ink-muted ${labelsVisible ? "" : "lg:sr-only"}`}>{label}</span>
          <input
            name={name}
            defaultValue={value(name)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${name}-error-${service?.id ?? "new"}` : undefined}
            className={`${inputClass} ${error ? "border-danger" : ""}`}
            {...props}
          />
        </label>
        {error && (
          <p id={`${name}-error-${service?.id ?? "new"}`} className="mt-1 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  const listId = `categories-${service?.id ?? "new"}`;

  return (
    <form
      action={action}
      noValidate
      className={`grid grid-cols-2 gap-3 rounded-card border border-line bg-surface p-4 lg:p-3 ${labelsVisible ? "lg:items-end" : "lg:items-start"} ${SERVICE_GRID_LG} ${
        service && !active ? "opacity-70" : ""
      }`}
    >
      <input type="hidden" name="id" value={service?.id ?? ""} />

      <div className="col-span-2 lg:col-span-1">
        {field("name", "Ime", { type: "text", autoComplete: "off", required: true })}
      </div>
      <div className="col-span-2 lg:col-span-1">
        {field("category", "Kategorija", { type: "text", autoComplete: "off", list: listId })}
        <datalist id={listId}>
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </div>
      {field("duration", "Trajanje (min)", { type: "text", inputMode: "numeric", required: true })}
      {field("buffer", "Čiščenje (min)", { type: "text", inputMode: "numeric" })}
      {field("price", "Cena (€)", { type: "text", inputMode: "decimal", required: true })}

      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={active}
          className="size-6 accent-brand"
        />
        Aktivna
      </label>

      <fieldset className="col-span-2 lg:col-span-full">
        <legend className="mb-1 text-xs font-medium text-ink-muted">Kdo izvaja</legend>
        <div className="flex flex-wrap gap-2">
          {staff.length === 0 && <span className="text-sm text-ink-muted">Najprej dodajte zaposlene.</span>}
          {staff.map((member) => (
            <label
              key={member.id}
              className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-canvas px-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
            >
              <input
                type="checkbox"
                name="staff"
                value={member.id}
                defaultChecked={service ? performers.includes(member.id) : true}
                className="size-5 accent-brand"
              />
              {member.name}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Last in the form (after "Kdo izvaja"), but on large screens at the end of the first row, under no header. */}
      <button type="submit" disabled={pending} className={`${buttonPrimary} col-span-2 lg:col-span-1 lg:col-start-7 lg:row-start-1`}>
        {pending ? "Shranjujem …" : service ? "Shrani" : "Dodaj"}
      </button>

      {(state?.message) && (
        <p
          role="status"
          className={`col-span-2 text-sm font-medium lg:col-span-full ${state.ok ? "text-success" : "text-danger"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
