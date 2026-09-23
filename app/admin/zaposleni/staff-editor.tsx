"use client";

import { useActionState, useId, useState } from "react";
import { safeColor } from "@/lib/brand";
import type { Service, Staff, StaffHours, TimeOff, Weekday } from "@/lib/types";
import { buttonPrimary, buttonSecondary, card, inputClass } from "../_components/ui";
import {
  addTimeOff,
  removeTimeOff,
  saveHours,
  saveServices,
  saveStaff,
  type SimpleState,
  type StaffField,
  type StaffFormState,
} from "./actions";

/** Monday first; the value is staff_hours.weekday (0 = Sunday). */
const WEEK: { weekday: Weekday; label: string }[] = [
  { weekday: 1, label: "Ponedeljek" },
  { weekday: 2, label: "Torek" },
  { weekday: 3, label: "Sreda" },
  { weekday: 4, label: "Četrtek" },
  { weekday: 5, label: "Petek" },
  { weekday: 6, label: "Sobota" },
  { weekday: 0, label: "Nedelja" },
];

/** "09:00:00" -> "09:00", which is what <input type="time"> wants. */
const hhmm = (time: string) => time.slice(0, 5);

const sectionTitle = "text-xs font-semibold uppercase tracking-wide text-ink-muted";

/**
 * An absence with its dates already written out. The server formats them,
 * because the salon's timezone lives there and a function cannot be passed
 * across the server/client boundary.
 */
export type DatedTimeOff = TimeOff & { label: string };

/** A short status line under a form, green when it worked. */
function Result({ state }: { state: SimpleState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`text-sm font-medium ${state.ok ? "text-success" : "text-danger"}`}
    >
      {state.message}
    </p>
  );
}

// ---------- who the person is ----------

function StaffFields({ member }: { member?: Staff }) {
  const [state, action, pending] = useActionState<StaffFormState, FormData>(saveStaff, null);
  const ids = useId();
  const [color, setColor] = useState(member?.color ?? "");

  const values = state?.values;
  const errors = state?.errors ?? {};
  const initial: Record<StaffField, string> = {
    name: member?.name ?? "",
    email: member?.email ?? "",
    phone: member?.phone ?? "",
    color: member?.color ?? "",
  };

  function field(
    key: StaffField,
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
    <form action={action} noValidate className="space-y-4">
      <input type="hidden" name="id" value={member?.id ?? ""} />

      <div className="grid gap-4 sm:grid-cols-2">
        {field("name", "Ime in priimek", { type: "text", required: true, maxLength: 80 })}
        {field("phone", "Telefon", { type: "tel", autoComplete: "tel" })}
        {field("email", "E-pošta", { type: "email", autoComplete: "email" })}

        <div>
          <label htmlFor={`color-${ids}`} className="mb-1.5 block text-sm font-medium">
            Barva v koledarju
          </label>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="size-11 shrink-0 rounded-control border border-line"
              style={{ backgroundColor: safeColor(color || null) }}
            />
            <input
              id={`color-${ids}`}
              name="color"
              type="text"
              spellCheck={false}
              placeholder="#6366f1"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              aria-invalid={errors.color ? true : undefined}
              className={`${inputClass} ${errors.color ? "border-danger" : ""}`}
            />
          </div>
          {errors.color && (
            <p className="mt-1.5 text-sm font-medium text-danger">{errors.color}</p>
          )}
        </div>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={values ? values.is_active === "on" : (member?.is_active ?? true)}
          className="mt-0.5 size-6 shrink-0 accent-brand"
        />
        <span>
          <span className="block text-sm font-medium">Aktiven</span>
          <span className="block text-sm text-ink-muted">
            Neaktivnega strankam ne ponudimo, pretekli termini ostanejo.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Shranjujem …" : member ? "Shrani" : "Dodaj zaposlenega"}
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
  );
}

// ---------- weekly schedule ----------

function HoursForm({ member, hours }: { member: Staff; hours: StaffHours[] }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(saveHours, null);
  const ids = useId();

  /** The first window of that day, if the member works then. */
  const windowFor = (weekday: Weekday) =>
    hours
      .filter((h) => h.staff_id === member.id && h.weekday === weekday)
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="staff_id" value={member.id} />

      <ul className="divide-y divide-line rounded-control border border-line">
        {WEEK.map(({ weekday, label }) => {
          const window = windowFor(weekday);
          return (
            <li key={weekday} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-28 text-sm font-medium">{label}</span>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`start-${weekday}-${ids}`}>
                  {label}: začetek
                </label>
                <input
                  id={`start-${weekday}-${ids}`}
                  type="time"
                  name={`start_${weekday}`}
                  defaultValue={window ? hhmm(window.start_time) : ""}
                  className="h-11 rounded-control border border-line bg-surface px-2 text-sm tabular-nums"
                />
                <span aria-hidden="true" className="text-ink-muted">–</span>
                <label className="sr-only" htmlFor={`end-${weekday}-${ids}`}>
                  {label}: konec
                </label>
                <input
                  id={`end-${weekday}-${ids}`}
                  type="time"
                  name={`end_${weekday}`}
                  defaultValue={window ? hhmm(window.end_time) : ""}
                  className="h-11 rounded-control border border-line bg-surface px-2 text-sm tabular-nums"
                />
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-sm text-ink-muted">Prazno polje pomeni prost dan.</p>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={buttonSecondary}>
          {pending ? "Shranjujem …" : "Shrani urnik"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

// ---------- which services this member performs ----------

function ServicesForm({
  member,
  services,
  performs,
}: {
  member: Staff;
  services: Service[];
  performs: Set<string>;
}) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(saveServices, null);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="staff_id" value={member.id} />

      <ul className="flex flex-wrap gap-2">
        {services.map((service) => (
          <li key={service.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-canvas px-3 text-sm has-checked:border-brand has-checked:bg-brand-soft">
              <input
                type="checkbox"
                name="service_id"
                value={service.id}
                defaultChecked={performs.has(service.id)}
                className="size-5 accent-brand"
              />
              {service.name}
              {!service.is_active && <span className="text-ink-muted">(neaktivna)</span>}
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={buttonSecondary}>
          {pending ? "Shranjujem …" : "Shrani storitve"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

// ---------- absences ----------

function DeleteTimeOff({ id }: { id: string }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(removeTimeOff, null);
  return (
    <form action={action} className="contents">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-control px-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
      >
        {pending ? "Brišem …" : "Izbriši"}
      </button>
      {state && !state.ok && <span className="sr-only">{state.message}</span>}
    </form>
  );
}

function TimeOffForm({
  member,
  absences,
}: {
  member: Staff;
  absences: DatedTimeOff[];
}) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(addTimeOff, null);
  const ids = useId();

  return (
    <div className="space-y-3">
      {absences.length > 0 && (
        <ul className="divide-y divide-line rounded-control border border-line">
          {absences.map((absence) => (
            <li key={absence.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <span>
                <span className="font-medium">{absence.label}</span>
                {absence.reason && <span className="text-ink-muted"> · {absence.reason}</span>}
                {absence.staff_id === null && <span className="text-ink-muted"> (ves salon)</span>}
              </span>
              {/* A salon-wide closure is not this one member's to remove. */}
              {absence.staff_id !== null && <DeleteTimeOff id={absence.id} />}
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="space-y-3">
        <input type="hidden" name="staff_id" value={member.id} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor={`from-${ids}`} className="mb-1.5 block text-sm font-medium">
              Od
            </label>
            <input id={`from-${ids}`} type="date" name="from" required className={inputClass} />
          </div>
          <div>
            <label htmlFor={`to-${ids}`} className="mb-1.5 block text-sm font-medium">
              Do (vključno)
            </label>
            <input id={`to-${ids}`} type="date" name="to" required className={inputClass} />
          </div>
          <div>
            <label htmlFor={`reason-${ids}`} className="mb-1.5 block text-sm font-medium">
              Razlog
            </label>
            <input
              id={`reason-${ids}`}
              type="text"
              name="reason"
              maxLength={80}
              placeholder="Dopust"
              className={inputClass}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className={buttonSecondary}>
            {pending ? "Dodajam …" : "Dodaj odsotnost"}
          </button>
          <Result state={state} />
        </div>
      </form>
    </div>
  );
}

// ---------- the whole card ----------

export function StaffEditor({
  member,
  hours,
  services,
  performs,
  absences,
}: {
  member: Staff;
  hours: StaffHours[];
  services: Service[];
  performs: Set<string>;
  absences: DatedTimeOff[];
}) {
  return (
    <li className={`${card} p-4`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 rounded-full"
          style={{ backgroundColor: safeColor(member.color) }}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-lg font-bold">{member.name}</h2>
          {!member.is_active && (
            <span className="rounded-full bg-line px-2.5 py-0.5 text-xs font-semibold text-ink-muted">
              Neaktiven
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-5">
        <StaffFields member={member} />

        <div>
          <h3 className={sectionTitle}>Tedenski urnik</h3>
          <div className="mt-2">
            <HoursForm member={member} hours={hours} />
          </div>
        </div>

        <div>
          <h3 className={sectionTitle}>Izvaja storitve</h3>
          <div className="mt-2">
            <ServicesForm member={member} services={services} performs={performs} />
          </div>
        </div>

        <div>
          <h3 className={sectionTitle}>Odsotnosti</h3>
          <div className="mt-2">
            <TimeOffForm member={member} absences={absences} />
          </div>
        </div>
      </div>
    </li>
  );
}

/** The "add someone" card at the bottom of the list. */
export function NewStaffForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonPrimary}>
        + Nov zaposleni
      </button>
    );
  }

  return (
    <section className={`${card} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Nov zaposleni</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 px-2 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Prekliči
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Urnik in storitve nastavite, ko je oseba dodana.
      </p>
      <div className="mt-4">
        <StaffFields />
      </div>
    </section>
  );
}
