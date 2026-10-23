import { addDays } from "date-fns";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminAccess } from "@/lib/admin-access";
import { safeColor } from "@/lib/brand";
import { getCurrentSalon } from "@/lib/current-salon";
import {
  getServices,
  getStaff,
  getStaffHours,
  getStaffServices,
  getTimeOff,
} from "@/lib/data";
import { localDay } from "@/lib/format";
import type { StaffHours, Weekday } from "@/lib/types";
import { buttonSecondary, card, pageTitle } from "../_components/ui";
import { absenceDates } from "./absence-dates";
import { DeleteTimeOffButton, NewStaffForm, TimeOffForm } from "./staff-forms";

// Monday first; the value is staff_hours.weekday (0 = Sunday).
const WEEK: { weekday: Weekday; label: string }[] = [
  { weekday: 1, label: "Ponedeljek" },
  { weekday: 2, label: "Torek" },
  { weekday: 3, label: "Sreda" },
  { weekday: 4, label: "Četrtek" },
  { weekday: 5, label: "Petek" },
  { weekday: 6, label: "Sobota" },
  { weekday: 0, label: "Nedelja" },
];

/** "09:00:00" -> "09:00" */
const hhmm = (time: string) => time.slice(0, 5);

function dayHours(hours: StaffHours[], staffId: string, weekday: Weekday): string {
  const windows = hours
    .filter((h) => h.staff_id === staffId && h.weekday === weekday)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((h) => `${hhmm(h.start_time)}–${hhmm(h.end_time)}`);
  return windows.length ? windows.join(", ") : "Prost dan";
}


export default async function StaffPage() {
  const salon = await getCurrentSalon();
  if (!salon) notFound();
  const access = await getAdminAccess();
  const isOwner = access.ok && access.role === "owner";

  const now = new Date();
  const [staff, hours, links, services, timeOff] = await Promise.all([
    getStaff(salon.id, { includeInactive: true }),
    getStaffHours(salon.id),
    getStaffServices(salon.id),
    getServices(salon.id, { includeInactive: true }),
    getTimeOff(salon.id, now, addDays(now, 365)),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className={pageTitle}>Zaposleni</h1>
        <p className="mt-1 text-ink-muted">
          Tedenski urnik po dnevih. Barva pri imenu je barva zaposlenega v koledarju.
          {!isOwner && " Urejati jih lahko samo lastnik salona."}
        </p>
      </div>

      <ul className="grid gap-4 xl:grid-cols-2">
        {staff.map((member) => {
          const color = safeColor(member.color);
          // In the services' display order (getServices sorts by sort_order).
          const performs = services
            .filter((s) => links.some((l) => l.staff_id === member.id && l.service_id === s.id))
            .map((s) => s.name);
          const absences = timeOff.filter((t) => t.staff_id === member.id || t.staff_id === null);

          return (
            <li key={member.id} className={`${card} p-4`}>
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="text-lg font-semibold">{member.name}</h2>
                    {!member.is_active && (
                      <span className="rounded-full bg-line px-2.5 py-0.5 text-xs font-semibold text-ink-muted">
                        Neaktiven
                      </span>
                    )}
                    {isOwner && (
                      <Link href={`/admin/zaposleni/${member.id}`} className={`${buttonSecondary} ml-auto`}>
                        Uredi
                      </Link>
                    )}
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
                    {member.phone && (
                      <a href={`tel:${member.phone.replace(/\s/g, "")}`} className="inline-flex min-h-11 items-center font-medium text-brand-ink underline">
                        {member.phone}
                      </a>
                    )}
                    {member.email && (
                      <a href={`mailto:${member.email}`} className="inline-flex min-h-11 items-center break-all font-medium text-brand-ink underline">
                        {member.email}
                      </a>
                    )}
                  </p>
                </div>
              </div>

              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Tedenski urnik
              </h3>
              <dl className="mt-2 divide-y divide-line rounded-control border border-line">
                {WEEK.map(({ weekday, label }) => {
                  const text = dayHours(hours, member.id, weekday);
                  return (
                    <div key={weekday} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <dt className="font-medium">{label}</dt>
                      <dd className={text === "Prost dan" ? "text-ink-muted" : "tabular-nums"}>{text}</dd>
                    </div>
                  );
                })}
              </dl>

              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Izvaja storitve
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {performs.length === 0 && <li className="text-sm text-ink-muted">Nobene storitve.</li>}
                {performs.map((name) => (
                  <li key={name} className="rounded-full border border-line bg-canvas px-3 py-1 text-sm">
                    {name}
                  </li>
                ))}
              </ul>

              {absences.length > 0 && (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Prihodnje odsotnosti
                  </h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {absences.map((absence) => (
                      <li key={absence.id}>
                        <span className="font-medium">{absenceDates(absence.starts_at, absence.ends_at, salon.timezone)}</span>
                        {absence.reason && <span className="text-ink-muted"> · {absence.reason}</span>}
                        {absence.staff_id === null && <span className="text-ink-muted"> (ves salon)</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {isOwner && (
        <div className="grid gap-4 xl:grid-cols-2">
          <NewStaffForm />
          <section className={`${card} space-y-4 p-4`} aria-labelledby="closed-title">
            <div>
              <h2 id="closed-title" className="font-semibold">
                Salon zaprt
              </h2>
              <p className="text-sm text-ink-muted">Prazniki in dnevi, ko ne dela nihče. Stranke takrat ne vidijo prostih terminov.</p>
            </div>
            {timeOff.filter((t) => t.staff_id === null).length > 0 && (
              <ul className="divide-y divide-line">
                {timeOff
                  .filter((t) => t.staff_id === null)
                  .map((t) => {
                    const label = absenceDates(t.starts_at, t.ends_at, salon.timezone);
                    return (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span>
                          <span className="font-medium">{label}</span>
                          {t.reason && <span className="text-ink-muted"> · {t.reason}</span>}
                        </span>
                        <DeleteTimeOffButton id={t.id} label={label} />
                      </li>
                    );
                  })}
              </ul>
            )}
            <TimeOffForm staffId={null} today={localDay(now, salon.timezone)} timezone={salon.timezone} />
          </section>
        </div>
      )}
    </div>
  );
}
