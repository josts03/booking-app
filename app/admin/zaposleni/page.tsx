import { addDays } from "date-fns";
import { notFound } from "next/navigation";
import { getCurrentSalon } from "@/lib/current-salon";
import {
  getServices,
  getStaff,
  getStaffHours,
  getStaffServices,
  getTimeOff,
} from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { TimeOff } from "@/lib/types";
import { pageTitle } from "../_components/ui";
import { NewStaffForm, StaffEditor, type DatedTimeOff } from "./staff-editor";

/** "25. 9. 2026" or, over several days, "25. 9. 2026–27. 9. 2026". ends_at is exclusive. */
function absenceDates(absence: TimeOff, timeZone: string): string {
  const first = formatDate(absence.starts_at, timeZone);
  const last = formatDate(new Date(Date.parse(absence.ends_at) - 1).toISOString(), timeZone);
  return first === last ? first : `${first}–${last}`;
}

export default async function StaffPage() {
  const salon = await getCurrentSalon();
  if (!salon) notFound();

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
          Urnik odloča, katere termine stranke sploh vidijo. Odsotnost jih za tiste
          dneve umakne.
        </p>
      </div>

      <ul className="grid gap-4 xl:grid-cols-2">
        {staff.map((member) => {
          const performs = new Set(
            links.filter((l) => l.staff_id === member.id).map((l) => l.service_id),
          );
          const absences: DatedTimeOff[] = timeOff
            .filter((t) => t.staff_id === member.id || t.staff_id === null)
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
            .map((absence) => ({ ...absence, label: absenceDates(absence, salon.timezone) }));

          return (
            <StaffEditor
              key={member.id}
              member={member}
              hours={hours}
              services={services}
              performs={performs}
              absences={absences}
            />
          );
        })}
      </ul>

      <NewStaffForm />
    </div>
  );
}
