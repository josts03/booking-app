"use client";

import { useActionState, useId, useState } from "react";
import type { Salon } from "@/lib/types";
import { buttonPrimary, card, inputClass } from "../_components/ui";
import { saveSettings, type SettingsField, type SettingsFormState } from "./actions";

/**
 * Time zones offered in the picker. The salon's own zone is added if it is not
 * here, so an unusual value is never silently replaced.
 */
const TIMEZONES = [
  "Europe/Ljubljana",
  "Europe/Zagreb",
  "Europe/Vienna",
  "Europe/Budapest",
  "Europe/Belgrade",
  "Europe/Rome",
  "Europe/Berlin",
  "UTC",
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${card} p-5`}>
      <h2 className="text-lg font-bold">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * Every column of `salons` the owner may change, in three groups: who the salon
 * is, how it looks, and the rules the booking page follows. The numbers at the
 * bottom are the ones that decide which slots visitors are offered.
 */
export function SettingsForm({ salon }: { salon: Salon }) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(saveSettings, null);
  const ids = useId();
  const [color, setColor] = useState(salon.brand_color ?? "");

  const values = state?.values;
  const errors = state?.errors ?? {};

  const initial: Record<SettingsField | "require_confirmation", string> = {
    name: salon.name,
    phone: salon.phone ?? "",
    email: salon.email ?? "",
    address: salon.address ?? "",
    timezone: salon.timezone,
    brand_color: salon.brand_color ?? "",
    logo_url: salon.logo_url ?? "",
    slot_interval_min: String(salon.slot_interval_min),
    min_lead_time_min: String(salon.min_lead_time_min),
    max_days_ahead: String(salon.max_days_ahead),
    cancel_window_hours: String(salon.cancel_window_hours),
    reminder_hours_before: String(salon.reminder_hours_before),
    require_confirmation: salon.require_confirmation ? "on" : "",
  };
  const value = (key: SettingsField) => values?.[key] ?? initial[key];

  function field(
    key: SettingsField,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
    hint?: string,
  ) {
    const error = errors[key];
    const describedBy = error ? `${key}-error-${ids}` : hint ? `${key}-hint-${ids}` : undefined;
    return (
      <div>
        <label htmlFor={`${key}-${ids}`} className="mb-1.5 block text-sm font-medium">
          {label}
        </label>
        <input
          id={`${key}-${ids}`}
          name={key}
          defaultValue={value(key)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${inputClass} ${error ? "border-danger" : ""}`}
          {...props}
        />
        {error ? (
          <p id={`${key}-error-${ids}`} className="mt-1.5 text-sm font-medium text-danger">
            {error}
          </p>
        ) : (
          hint && (
            <p id={`${key}-hint-${ids}`} className="mt-1.5 text-sm text-ink-muted">
              {hint}
            </p>
          )
        )}
      </div>
    );
  }

  const zones = TIMEZONES.includes(salon.timezone) ? TIMEZONES : [salon.timezone, ...TIMEZONES];

  return (
    <form action={action} noValidate className="space-y-5">
      <Section title="Salon" description="Podatki, ki jih vidijo stranke na strani za naročanje.">
        {field("name", "Ime salona", { type: "text", required: true, maxLength: 80 })}
        {field("phone", "Telefon", { type: "tel", autoComplete: "tel" })}
        {field("email", "E-naslov", { type: "email", autoComplete: "email" })}
        {field("address", "Naslov", { type: "text", autoComplete: "street-address" })}
      </Section>

      <Section title="Videz" description="Barva salona velja na strani za naročanje in v adminu.">
        <div>
          <label htmlFor={`brand_color-${ids}`} className="mb-1.5 block text-sm font-medium">
            Barva salona
          </label>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="size-11 shrink-0 rounded-control border border-line"
              style={{ background: /^#[0-9a-f]{6}$/i.test(color) ? color : "var(--color-canvas)" }}
            />
            <input
              id={`brand_color-${ids}`}
              name="brand_color"
              type="text"
              inputMode="text"
              spellCheck={false}
              placeholder="#0f766e"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              aria-invalid={errors.brand_color ? true : undefined}
              className={`${inputClass} ${errors.brand_color ? "border-danger" : ""}`}
            />
          </div>
          {errors.brand_color ? (
            <p className="mt-1.5 text-sm font-medium text-danger">{errors.brand_color}</p>
          ) : (
            <p className="mt-1.5 text-sm text-ink-muted">Prazno = privzeta barva platforme.</p>
          )}
        </div>
        {field("logo_url", "Povezava do logotipa", { type: "url", inputMode: "url" },
          "Prazno = začetnici imena salona.")}
      </Section>

      <Section
        title="Naročanje"
        description="Pravila, po katerih se strankam ponudijo prosti termini."
      >
        <div>
          <label htmlFor={`timezone-${ids}`} className="mb-1.5 block text-sm font-medium">
            Časovni pas
          </label>
          <select
            id={`timezone-${ids}`}
            name="timezone"
            defaultValue={value("timezone")}
            aria-invalid={errors.timezone ? true : undefined}
            className={`${inputClass} ${errors.timezone ? "border-danger" : ""}`}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          {errors.timezone && (
            <p className="mt-1.5 text-sm font-medium text-danger">{errors.timezone}</p>
          )}
        </div>

        {field("slot_interval_min", "Razmik med termini (min)",
          { type: "text", inputMode: "numeric", required: true },
          "Na koliko minut se ponudi nov začetek.")}

        {field("min_lead_time_min", "Najkrajši čas vnaprej (min)",
          { type: "text", inputMode: "numeric", required: true },
          "Koliko prej se stranka še lahko naroči.")}

        {field("max_days_ahead", "Koliko dni vnaprej",
          { type: "text", inputMode: "numeric", required: true },
          "Kako daleč v prihodnost je koledar odprt.")}

        {field("cancel_window_hours", "Rok za odpoved (ur)",
          { type: "text", inputMode: "numeric", required: true },
          "Do kdaj pred terminom stranka lahko odpove.")}

        {field("reminder_hours_before", "Opomnik (ur prej)",
          { type: "text", inputMode: "numeric", required: true },
          "0 = brez opomnika.")}

        <label className="flex items-start gap-3 sm:col-span-2">
          <input
            type="checkbox"
            name="require_confirmation"
            defaultChecked={
              values ? values.require_confirmation === "on" : salon.require_confirmation
            }
            className="mt-0.5 size-6 shrink-0 accent-brand"
          />
          <span>
            <span className="block text-sm font-medium">Rezervacije potrdim ročno</span>
            <span className="block text-sm text-ink-muted">
              Nova rezervacija dobi status &bdquo;čaka potrditev&ldquo; namesto potrjene.
            </span>
          </span>
        </label>
      </Section>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Shranjujem …" : "Shrani nastavitve"}
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
