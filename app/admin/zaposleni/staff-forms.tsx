"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { formatTime, formatWeekdayDate, localDay } from "@/lib/format";
import { MAX_WINDOWS_PER_DAY, WEEKDAYS, type TimeWindow } from "@/lib/schedule";
import type { AffectedBooking, Weekday } from "@/lib/types";
import { calendarHref } from "../_components/calendar-url";
import { STAFF_COLORS } from "../_components/staff-colors";
import { buttonPrimary, buttonSecondary, card, inputClass } from "../_components/ui";
import {
  addTimeOffAction,
  createStaffAction,
  deleteTimeOffAction,
  saveHoursAction,
  saveStaffAction,
  type ManageState,
} from "./actions";

const DAY_NAMES: Record<Weekday, string> = {
  1: "Ponedeljek",
  2: "Torek",
  3: "Sreda",
  4: "Četrtek",
  5: "Petek",
  6: "Sobota",
  0: "Nedelja",
};

function Message({ state }: { state: ManageState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`text-sm font-medium ${state.ok ? "text-success" : "text-danger"}`}>
      {state.message}
    </p>
  );
}

/** Bookings that no longer fit after a change (decision 3a): listed with a link, never changed automatically. */
export function AffectedList({ affected, timezone }: { affected?: AffectedBooking[]; timezone: string }) {
  if (!affected || affected.length === 0) return null;
  return (
    <div className="space-y-2 rounded-control border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="font-medium text-warning">
        Ti termini zdaj niso v delovnem času ali padejo v odsotnost. Prestavite ali odpovejte jih v koledarju:
      </p>
      <ul className="space-y-1">
        {affected.map((b) => (
          <li key={b.id}>
            <Link
              href={calendarHref({ view: "day", date: localDay(b.starts_at, timezone), booking: b.id })}
              className="font-medium text-brand-ink underline"
            >
              {formatWeekdayDate(b.starts_at, timezone)}, {formatTime(b.starts_at, timezone)}–{formatTime(b.ends_at, timezone)}
            </Link>{" "}
            · {b.customer_name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColorPicker({ name, value, onChange }: { name: string; value: string; onChange: (color: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium">Barva v koledarju</legend>
      <div className="flex flex-wrap gap-2">
        {STAFF_COLORS.map((color) => (
          <label key={color} className="relative flex size-11 cursor-pointer items-center justify-center">
            <input
              type="radio"
              name={name}
              value={color}
              checked={value === color}
              onChange={() => onChange(color)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="size-8 rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:ring-2 peer-focus-visible:ring-brand"
              style={{ backgroundColor: color }}
            />
            <span className="sr-only">{color}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function NewStaffForm() {
  const [state, action, pending] = useActionState<ManageState, FormData>(createStaffAction, null);
  const [color, setColor] = useState<string>(state?.values?.color || STAFF_COLORS[2]);
  return (
    <form action={action} noValidate className={`${card} space-y-4 p-4`}>
      <h2 className="font-semibold">Dodaj zaposlenega</h2>
      <div>
        <label htmlFor="new-name" className="mb-1 block text-sm font-medium">
          Ime
        </label>
        <input id="new-name" name="name" type="text" autoComplete="off" defaultValue={state?.values?.name ?? ""} className={inputClass} />
      </div>
      <ColorPicker name="color" value={color} onChange={setColor} />
      <Message state={state} />
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Dodajam …" : "Dodaj in nastavi urnik"}
      </button>
    </form>
  );
}

export function StaffDetailsForm({
  staff,
}: {
  staff: { id: string; name: string; color: string; email: string | null; phone: string | null; is_active: boolean };
}) {
  const [state, action, pending] = useActionState<ManageState, FormData>(saveStaffAction, null);
  const values = state?.values;
  const [color, setColor] = useState(values?.color || staff.color);
  const errors = state?.errors ?? {};
  const field = (name: "name" | "phone" | "email", label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <label htmlFor={`staff-${name}`} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={`staff-${name}`}
        name={name}
        defaultValue={values?.[name] ?? staff[name] ?? ""}
        aria-invalid={errors[name] ? true : undefined}
        className={`${inputClass} ${errors[name] ? "border-danger" : ""}`}
        {...props}
      />
      {errors[name] && <p className="mt-1 text-xs text-danger">{errors[name]}</p>}
    </div>
  );

  return (
    <form action={action} noValidate className={`${card} space-y-4 p-4`}>
      <input type="hidden" name="id" value={staff.id} />
      <h2 className="font-semibold">Osnovni podatki</h2>
      {field("name", "Ime", { type: "text", autoComplete: "off" })}
      <ColorPicker name="color" value={color} onChange={setColor} />
      <div className="grid gap-4 sm:grid-cols-2">
        {field("phone", "Telefon (neobvezno)", { type: "tel", inputMode: "tel", autoComplete: "off" })}
        {field("email", "E-pošta (neobvezno)", { type: "email", inputMode: "email", autoComplete: "off" })}
      </div>
      <p className="text-xs text-ink-muted">Telefona in e-pošte zaposlenega stranke ne vidijo.</p>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={values ? values.is_active === "on" : staff.is_active}
          className="size-5 accent-brand"
        />
        Aktiven (stranke ga lahko izberejo, viden je v koledarju)
      </label>
      <Message state={state} />
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Shranjujem …" : "Shrani"}
      </button>
    </form>
  );
}

/**
 * The week, Monday first. A day either "works" with one to three windows or is
 * a day off. Saved as a whole (one step in the database).
 */
export function WeekForm({ staffId, week, timezone }: { staffId: string; week: Record<Weekday, TimeWindow[]>; timezone: string }) {
  const [state, action, pending] = useActionState<ManageState, FormData>(saveHoursAction, null);
  const [days, setDays] = useState(() =>
    Object.fromEntries(
      WEEKDAYS.map((d) => [d, { works: week[d].length > 0, windows: week[d].length ? week[d] : [{ start: "09:00", end: "17:00" }] }]),
    ) as Record<Weekday, { works: boolean; windows: TimeWindow[] }>,
  );
  const errors = state?.errors ?? {};
  const update = (day: Weekday, change: Partial<{ works: boolean; windows: TimeWindow[] }>) =>
    setDays((current) => ({ ...current, [day]: { ...current[day], ...change } }));

  return (
    <form action={action} noValidate className={`${card} space-y-3 p-4`}>
      <input type="hidden" name="id" value={staffId} />
      <div>
        <h2 className="font-semibold">Tedenski urnik</h2>
        <p className="text-sm text-ink-muted">Ure so lokalni čas salona. Velja vsak teden, poleti in pozimi.</p>
      </div>
      <ul className="divide-y divide-line rounded-control border border-line">
        {WEEKDAYS.map((day) => {
          const { works, windows } = days[day];
          return (
            <li key={day} className="space-y-2 p-3">
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span className="font-medium">{DAY_NAMES[day]}</span>
                <span className="flex items-center gap-2 text-sm">
                  {works ? "Dela" : "Prost dan"}
                  <input
                    type="checkbox"
                    name={`work-${day}`}
                    checked={works}
                    onChange={(event) => update(day, { works: event.target.checked })}
                    className="size-5 accent-brand"
                  />
                </span>
              </label>
              {works && (
                <>
                  {windows.map((w, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="time"
                        step={300}
                        name={`start-${day}-${i}`}
                        aria-label={`${DAY_NAMES[day]}, začetek ${i + 1}`}
                        value={w.start}
                        onChange={(event) => update(day, { windows: windows.map((x, j) => (j === i ? { ...x, start: event.target.value } : x)) })}
                        className={inputClass}
                      />
                      <span aria-hidden="true">–</span>
                      <input
                        type="time"
                        step={300}
                        name={`end-${day}-${i}`}
                        aria-label={`${DAY_NAMES[day]}, konec ${i + 1}`}
                        value={w.end}
                        onChange={(event) => update(day, { windows: windows.map((x, j) => (j === i ? { ...x, end: event.target.value } : x)) })}
                        className={inputClass}
                      />
                      {windows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => update(day, { windows: windows.filter((_, j) => j !== i) })}
                          className="inline-flex size-11 shrink-0 items-center justify-center rounded-button border border-line text-lg"
                          aria-label={`Odstrani okno ${i + 1}`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {windows.length < MAX_WINDOWS_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => update(day, { windows: [...windows, { start: "", end: "" }] })}
                      className="inline-flex min-h-11 items-center text-sm font-medium text-brand-ink"
                    >
                      + dodaj okno (npr. po malici)
                    </button>
                  )}
                </>
              )}
              {errors[`day-${day}`] && <p className="text-sm text-danger">{errors[`day-${day}`]}</p>}
            </li>
          );
        })}
      </ul>
      <Message state={state} />
      <AffectedList affected={state?.affected} timezone={timezone} />
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Shranjujem …" : "Shrani urnik"}
      </button>
    </form>
  );
}

/** A new absence: whole days (first to last) or part of one day. `staffId` null: the whole salon is closed. */
export function TimeOffForm({ staffId, today, timezone }: { staffId: string | null; today: string; timezone: string }) {
  const [state, action, pending] = useActionState<ManageState, FormData>(addTimeOffAction, null);
  const [partial, setPartial] = useState(state?.values?.partial === "on");
  const v = state?.values;
  return (
    <form action={action} noValidate className="space-y-3">
      <input type="hidden" name="staff" value={staffId ?? ""} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">{partial ? "Dan" : "Od dne"}</span>
          <input type="date" name="first" min={today} defaultValue={v?.first ?? today} className={inputClass} />
        </label>
        {!partial && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Do dne (vključno)</span>
            <input type="date" name="last" min={today} defaultValue={v?.last ?? today} className={inputClass} />
          </label>
        )}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="partial" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="size-5 accent-brand" />
        Samo del dneva
      </label>
      {partial && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Od ure</span>
            <input type="time" step={300} name="from" defaultValue={v?.from ?? "10:00"} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Do ure</span>
            <input type="time" step={300} name="to" defaultValue={v?.to ?? "12:00"} className={inputClass} />
          </label>
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">Opomba (vidi jo samo salon)</span>
        <input type="text" name="reason" maxLength={200} defaultValue={v?.reason ?? ""} placeholder={staffId ? "npr. dopust" : "npr. praznik"} className={inputClass} />
      </label>
      <Message state={state} />
      <AffectedList affected={state?.affected} timezone={timezone} />
      <button type="submit" disabled={pending} className={`${buttonSecondary} w-full`}>
        {pending ? "Dodajam …" : staffId ? "Dodaj odsotnost" : "Dodaj zaprtje salona"}
      </button>
    </form>
  );
}

export function DeleteTimeOffButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<ManageState, FormData>(deleteTimeOffAction, null);
  const [asking, setAsking] = useState(false);
  if (state?.ok) return <span className="text-sm text-success">Izbrisano</span>;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {asking ? (
        <>
          <button type="button" onClick={() => setAsking(false)} className={buttonSecondary}>
            Ne
          </button>
          <button type="submit" disabled={pending} className={`${buttonSecondary} border-danger text-danger`}>
            Da, izbriši
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={buttonSecondary} aria-label={`Izbriši odsotnost ${label}`}>
          Izbriši
        </button>
      )}
      {state?.message && !state.ok && <span className="text-sm text-danger">{state.message}</span>}
    </form>
  );
}
