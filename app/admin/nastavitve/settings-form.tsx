"use client";

import { useActionState, useState } from "react";
import { buttonPrimary, card, inputClass } from "../_components/ui";
import { saveSettingsAction, type SettingsState } from "./actions";

export interface SettingsDefaults {
  name: string;
  phone: string;
  email: string;
  address: string;
  brand_color: string;
  slot_interval_min: string;
  min_lead_time_hours: string;
  max_days_ahead: string;
  cancel_window_hours: string;
  reminder_hours_before: string;
  confirmation_note: string;
  require_confirmation: boolean;
}

/** The salon's settings in four groups. Checked again on the server and by the database. */
export function SettingsForm({ defaults }: { defaults: SettingsDefaults }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSettingsAction, null);
  const v = state?.values;
  const errors = state?.errors ?? {};
  const [color, setColor] = useState(v?.brand_color || defaults.brand_color);
  const value = (key: keyof Omit<SettingsDefaults, "require_confirmation">) => v?.[key] ?? defaults[key];

  const field = (
    name: keyof Omit<SettingsDefaults, "require_confirmation">,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
    hint?: string,
  ) => (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={value(name)}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={hint ? `${name}-hint` : undefined}
        className={`${inputClass} ${errors[name] ? "border-danger" : ""}`}
        {...props}
      />
      {hint && (
        <p id={`${name}-hint`} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {errors[name] && <p className="mt-1 text-xs text-danger">{errors[name]}</p>}
    </div>
  );

  return (
    <form action={action} noValidate className="space-y-5">
      <section className={`${card} space-y-4 p-4`}>
        <h2 className="font-semibold">Salon</h2>
        {field("name", "Ime salona", { type: "text", autoComplete: "organization" })}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("phone", "Telefon", { type: "tel", inputMode: "tel" })}
          {field("email", "E-pošta", { type: "email", inputMode: "email" }, "Na ta naslov odgovarjajo stranke na potrditve.")}
        </div>
        {field("address", "Naslov", { type: "text", autoComplete: "street-address" })}
      </section>

      <section className={`${card} space-y-4 p-4`}>
        <h2 className="font-semibold">Videz</h2>
        <div>
          <label htmlFor="brand_color_picker" className="mb-1 block text-sm font-medium">
            Barva salona
          </label>
          <div className="flex items-center gap-3">
            <input
              id="brand_color_picker"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-11 w-16 cursor-pointer rounded-control border border-line bg-surface"
            />
            <input
              name="brand_color"
              aria-label="Barva salona (#rrggbb)"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className={`${inputClass} max-w-32 font-mono`}
            />
          </div>
          <p className="mt-1 text-xs text-ink-muted">Gumbi in poudarki na strani za naročanje ter v e-pošti.</p>
          {errors.brand_color && <p className="mt-1 text-xs text-danger">{errors.brand_color}</p>}
        </div>
      </section>

      <section className={`${card} space-y-4 p-4`}>
        <h2 className="font-semibold">Naročanje</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="slot_interval_min" className="mb-1 block text-sm font-medium">
              Korak terminov
            </label>
            <select id="slot_interval_min" name="slot_interval_min" defaultValue={value("slot_interval_min")} className={inputClass}>
              {["5", "10", "15", "20", "30", "60"].map((m) => (
                <option key={m} value={m}>
                  na {m} min
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-muted">Pri 15 min: 9:00, 9:15, 9:30 …</p>
          </div>
          {field("min_lead_time_hours", "Najkrajša najava (ure)", { type: "text", inputMode: "numeric" }, "Koliko ur prej se mora stranka najkasneje naročiti.")}
          {field("max_days_ahead", "Koliko dni naprej", { type: "text", inputMode: "numeric" }, "Kako daleč v prihodnost se lahko naroči.")}
          {field("cancel_window_hours", "Odpoved do (ur pred terminom)", { type: "text", inputMode: "numeric" }, "Do kdaj stranka sama odpove prek povezave.")}
          {field("reminder_hours_before", "Opomnik (ur pred terminom)", { type: "text", inputMode: "numeric" }, "E-pošta stranki pred terminom.")}
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="require_confirmation"
            defaultChecked={v ? v.require_confirmation === "on" : defaults.require_confirmation}
            className="size-5 accent-brand"
          />
          Vsak spletni termin potrdi salon (do takrat „čaka potrditev“)
        </label>
      </section>

      <section className={`${card} space-y-2 p-4`}>
        <h2 className="font-semibold">Potrditvena e-pošta</h2>
        <label htmlFor="confirmation_note" className="block text-sm font-medium">
          Vaše sporočilo strankam (neobvezno)
        </label>
        <textarea
          id="confirmation_note"
          name="confirmation_note"
          rows={3}
          maxLength={500}
          defaultValue={value("confirmation_note")}
          placeholder="npr. Parkirate lahko na dvorišču za hišo."
          className={`${inputClass} h-auto py-2`}
        />
        <p className="text-xs text-ink-muted">Pokaže se v potrditvi, opomniku in obvestilu o prestavitvi. Največ 500 znakov.</p>
        {errors.confirmation_note && <p className="text-xs text-danger">{errors.confirmation_note}</p>}
      </section>

      {state?.message && (
        <p role={state.ok ? "status" : "alert"} className={`text-sm font-medium ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Shranjujem …" : "Shrani nastavitve"}
      </button>
    </form>
  );
}
