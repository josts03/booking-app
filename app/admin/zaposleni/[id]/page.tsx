import { addDays } from "date-fns";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/admin-access";
import { safeColor } from "@/lib/brand";
import { getServices, getStaff, getStaffHours, getStaffServices, getTimeOff } from "@/lib/data";
import { localDay } from "@/lib/format";
import { weekFromHours } from "@/lib/schedule";
import { backLink, card, pageTitle } from "../../_components/ui";
import { absenceDates } from "../absence-dates";
import { DeleteTimeOffButton, StaffDetailsForm, TimeOffForm, WeekForm } from "../staff-forms";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One staff member, for the salon's owner: details, the weekly hours and the
 * absences. Every change takes effect on the booking page at once. A staff
 * member's account sees the read-only list instead (decision 4a).
 */
export default async function StaffEditPage({ params }: PageProps<"/admin/zaposleni/[id]">) {
  const { id } = await params;
  const access = await getAdminAccess();
  if (!access.ok) notFound(); // the admin layout handles signed-out and non-members
  if (access.role !== "owner") redirect("/admin/zaposleni");
  const { salon } = access;
  if (!UUID.test(id)) notFound();

  const now = new Date();
  const [staffList, hours, links, services, timeOff] = await Promise.all([
    getStaff(salon.id, { includeInactive: true }),
    getStaffHours(salon.id),
    getStaffServices(salon.id),
    getServices(salon.id, { includeInactive: true }),
    getTimeOff(salon.id, now, addDays(now, 730)),
  ]);
  const member = staffList.find((s) => s.id === id);
  if (!member) notFound();

  const performs = services.filter((s) => links.some((l) => l.staff_id === member.id && l.service_id === s.id));
  const absences = timeOff.filter((t) => t.staff_id === member.id);
  const today = localDay(now, salon.timezone);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/admin/zaposleni" className={backLink}>
        ← Zaposleni
      </Link>
      <h1 className={`${pageTitle} flex items-center gap-3`}>
        <span aria-hidden="true" className="size-4 rounded-full" style={{ backgroundColor: safeColor(member.color) }} />
        {member.name}
      </h1>

      <StaffDetailsForm
        // A fresh form after a save that changed the data.
        key={`${member.name}-${member.color}-${member.is_active}`}
        staff={{
          id: member.id,
          name: member.name,
          color: safeColor(member.color),
          email: member.email,
          phone: member.phone,
          is_active: member.is_active,
        }}
      />

      <WeekForm staffId={member.id} week={weekFromHours(hours.filter((h) => h.staff_id === member.id))} timezone={salon.timezone} />

      <section className={`${card} space-y-4 p-4`} aria-labelledby="absences-title">
        <div>
          <h2 id="absences-title" className="font-semibold">
            Dopusti in odsotnosti
          </h2>
          <p className="text-sm text-ink-muted">Takrat stranke pri {member.name} ne vidijo prostih terminov.</p>
        </div>
        {absences.length > 0 ? (
          <ul className="divide-y divide-line">
            {absences.map((t) => {
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
        ) : (
          <p className="text-sm text-ink-muted">Ni prihodnjih odsotnosti.</p>
        )}
        <TimeOffForm staffId={member.id} today={today} timezone={salon.timezone} />
      </section>

      <section className={`${card} space-y-2 p-4`} aria-labelledby="services-title">
        <h2 id="services-title" className="font-semibold">
          Izvaja storitve
        </h2>
        <ul className="flex flex-wrap gap-2">
          {performs.length === 0 && <li className="text-sm text-ink-muted">Nobene storitve.</li>}
          {performs.map((s) => (
            <li key={s.id} className="rounded-full border border-line bg-canvas px-3 py-1 text-sm">
              {s.name}
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-muted">
          Kdo izvaja katero storitev, nastavite na strani{" "}
          <Link href="/admin/storitve" className="font-medium text-brand-ink underline">
            Storitve
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
