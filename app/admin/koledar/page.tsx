import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, format, getDay, isValid, parseISO, startOfWeek } from "date-fns";
import { sl } from "date-fns/locale";
import { fromZonedTime } from "date-fns-tz";
import { safeColor } from "@/lib/brand";
import { getCurrentSalon } from "@/lib/current-salon";
import {
  getBooking,
  getBookings,
  getCustomers,
  getServices,
  getStaff,
  getStaffHours,
  getTimeOff,
} from "@/lib/data";
import { formatTime, localDay, localMinutes } from "@/lib/format";
import type { Staff } from "@/lib/types";
import { BookingSheet } from "../_components/booking-sheet";
import {
  CalendarGrid,
  type CalendarBooking,
  type CalendarColumn,
  type CalendarLane,
} from "../_components/calendar-grid";
import { calendarHref, type CalendarView } from "../_components/calendar-url";
import { statusLabel } from "../_components/status-badge";
import { buttonSecondary, pageTitle } from "../_components/ui";

const DAY_FORMAT = "yyyy-MM-dd";
const WEEKDAY_SHORT = ["Ned", "Pon", "Tor", "Sre", "Čet", "Pet", "Sob"];

function isDay(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value)) && format(parseISO(value), DAY_FORMAT) === value;
}

/** "09:00:00" -> 540 */
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function CalendarPage({ searchParams }: PageProps<"/admin/koledar">) {
  const raw = await searchParams;
  const param = (key: string) => (typeof raw[key] === "string" ? raw[key] : undefined);

  const salon = await getCurrentSalon();
  if (!salon) notFound();
  const tz = salon.timezone;

  const today = localDay(new Date(), tz);
  const view: CalendarView = param("view") === "week" ? "week" : "day";
  const dateParam = param("date");
  const date = isDay(dateParam) ? dateParam : today;

  const monday = startOfWeek(parseISO(date), { weekStartsOn: 1 });
  const days =
    view === "day"
      ? [date]
      : Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), DAY_FORMAT));
  const rangeStart = fromZonedTime(`${days[0]}T00:00:00`, tz);
  const rangeEnd = fromZonedTime(`${format(addDays(parseISO(days[days.length - 1]), 1), DAY_FORMAT)}T00:00:00`, tz);

  const [staffList, services, bookings, timeOff, hours, customers] = await Promise.all([
    getStaff(salon.id, { includeInactive: true }),
    getServices(salon.id, { includeInactive: true }),
    getBookings(salon.id, rangeStart, rangeEnd),
    getTimeOff(salon.id, rangeStart, rangeEnd),
    getStaffHours(salon.id),
    getCustomers(salon.id),
  ]);

  const activeStaff = staffList.filter((s) => s.is_active);
  const filterStaff = activeStaff.find((s) => s.id === param("staff"));
  const visibleStaff: Staff[] = filterStaff ? [filterStaff] : activeStaff;
  const visibleIds = new Set(visibleStaff.map((s) => s.id));

  const serviceById = new Map(services.map((s) => [s.id, s]));
  const customerById = new Map(customers.map((c) => [c.customer.id, c.customer]));
  const staffById = new Map(staffList.map((s) => [s.id, s]));

  const state = { view, date, staff: filterStaff?.id };
  const shown = bookings.filter((b) => b.status !== "cancelled" && visibleIds.has(b.staff_id));

  // ---- visible time range: the working hours and every booking, in whole hours ----
  const weekdays = new Set(days.map((d) => getDay(parseISO(d))));
  const rows = hours.filter((h) => visibleIds.has(h.staff_id) && weekdays.has(h.weekday));
  const edges = [
    ...rows.flatMap((h) => [toMinutes(h.start_time), toMinutes(h.end_time)]),
    ...shown.flatMap((b) => [localMinutes(b.starts_at, tz), localMinutes(b.ends_at, tz)]),
  ];
  const axisStart = edges.length ? Math.floor(Math.min(...edges) / 60) * 60 : 8 * 60;
  const axisEnd = edges.length ? Math.ceil(Math.max(...edges) / 60) * 60 : 18 * 60;

  // ---- one lane = one staff member on one day ----
  function buildLane(member: Staff, day: string): CalendarLane {
    const dayStart = fromZonedTime(`${day}T00:00:00`, tz);
    const dayEnd = fromZonedTime(`${format(addDays(parseISO(day), 1), DAY_FORMAT)}T00:00:00`, tz);

    const open = hours
      .filter((h) => h.staff_id === member.id && h.weekday === getDay(parseISO(day)))
      .map((h): [number, number] => [toMinutes(h.start_time), toMinutes(h.end_time)]);

    const off = timeOff
      .filter((t) => t.staff_id === null || t.staff_id === member.id)
      .filter((t) => parseISO(t.starts_at) < dayEnd && parseISO(t.ends_at) > dayStart)
      .map((t) => ({
        startMin: parseISO(t.starts_at) <= dayStart ? 0 : localMinutes(t.starts_at, tz),
        endMin: parseISO(t.ends_at) >= dayEnd ? 24 * 60 : localMinutes(t.ends_at, tz),
        label: t.reason ?? "Odsoten",
      }));

    const laneBookings: CalendarBooking[] = shown
      .filter((b) => b.staff_id === member.id && localDay(b.starts_at, tz) === day)
      .map((b) => {
        const customer = customerById.get(b.customer_id);
        const customerName = customer
          ? `${customer.first_name} ${customer.last_name ?? ""}`.trim()
          : "Neznana stranka";
        const serviceName = serviceById.get(b.service_id)?.name ?? "Storitev";
        const time = `${formatTime(b.starts_at, tz)}–${formatTime(b.ends_at, tz)}`;
        return {
          id: b.id,
          startMin: localMinutes(b.starts_at, tz),
          endMin: localMinutes(b.ends_at, tz),
          customer: customerName,
          service: serviceName,
          time,
          label: `${customerName}, ${serviceName}, ${time}, ${member.name}, ${statusLabel(b.status)}`,
          status: b.status,
          href: calendarHref({ ...state, booking: b.id }),
          selected: b.id === param("booking"),
        };
      });

    return { key: `${member.id}-${day}`, color: safeColor(member.color), open, off, bookings: laneBookings };
  }

  const columns: CalendarColumn[] =
    view === "day"
      ? visibleStaff.map((member) => ({
          key: member.id,
          label: member.name,
          isToday: date === today,
          lanes: [buildLane(member, date)],
        }))
      : days.map((day) => ({
          key: day,
          label: WEEKDAY_SHORT[getDay(parseISO(day))],
          sublabel: `${Number(day.slice(8))}. ${Number(day.slice(5, 7))}.`,
          isToday: day === today,
          lanes: visibleStaff.map((member) => buildLane(member, day)),
        }));

  // ---- the open booking (details sheet) ----
  const openBooking = param("booking") ? await getBooking(salon.id, param("booking")!) : null;

  // ---- toolbar ----
  const step = view === "day" ? 1 : 7;
  const previous = format(addDays(parseISO(date), -step), DAY_FORMAT);
  const next = format(addDays(parseISO(date), step), DAY_FORMAT);
  const title =
    view === "day"
      ? capitalize(format(parseISO(date), "EEEE, d. M. yyyy", { locale: sl }))
      : `${format(monday, "d. M.")} – ${format(addDays(monday, 6), "d. M. yyyy")}`;

  const navButton = "inline-flex size-11 items-center justify-center rounded-control border border-line bg-surface text-xl leading-none hover:border-ink-muted";
  const chip = (active: boolean) =>
    `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium ${
      active ? "border-ink bg-ink text-canvas" : "border-line bg-surface hover:border-ink-muted"
    }`;

  return (
    <div className="space-y-4">
      <h1 className={pageTitle}>Koledar</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Link href={calendarHref({ ...state, date: previous })} className={navButton} aria-label={view === "day" ? "Prejšnji dan" : "Prejšnji teden"}>
            ‹
          </Link>
          <Link href={calendarHref({ ...state, date: today })} className={buttonSecondary}>
            Danes
          </Link>
          <Link href={calendarHref({ ...state, date: next })} className={navButton} aria-label={view === "day" ? "Naslednji dan" : "Naslednji teden"}>
            ›
          </Link>
        </div>

        <div className="ml-auto flex overflow-hidden rounded-control border border-line bg-surface text-sm font-semibold" role="group" aria-label="Pogled">
          {(["day", "week"] as const).map((option) => (
            <Link
              key={option}
              href={calendarHref({ ...state, view: option })}
              aria-current={view === option ? "true" : undefined}
              className={`flex min-h-11 items-center px-4 ${view === option ? "bg-ink text-canvas" : "hover:bg-brand-soft"}`}
            >
              {option === "day" ? "Dan" : "Teden"}
            </Link>
          ))}
        </div>
      </div>

      <p className="text-lg font-semibold" aria-live="polite">
        {title}
      </p>

      <div className="-mx-gutter flex gap-2 overflow-x-auto px-gutter md:mx-0 md:px-0" role="group" aria-label="Zaposleni">
        <Link href={calendarHref({ ...state, staff: undefined })} aria-current={!filterStaff ? "true" : undefined} className={chip(!filterStaff)}>
          Vsi
        </Link>
        {activeStaff.map((member) => (
          <Link
            key={member.id}
            href={calendarHref({ ...state, staff: member.id })}
            aria-current={filterStaff?.id === member.id ? "true" : undefined}
            className={chip(filterStaff?.id === member.id)}
          >
            <span aria-hidden="true" className="size-3 rounded-full" style={{ backgroundColor: safeColor(member.color) }} />
            {member.name}
          </Link>
        ))}
      </div>

      {visibleStaff.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-5 text-ink-muted">
          Salon še nima aktivnih zaposlenih.
        </p>
      ) : (
        <CalendarGrid
          columns={columns}
          axisStart={axisStart}
          axisEnd={axisEnd}
          nowMin={days.includes(today) ? localMinutes(new Date(), tz) : null}
          minColumnWidth={view === "day" ? "8.5rem" : `${Math.max(6, visibleStaff.length * 3.75)}rem`}
          emptyLabel="V tem obdobju ni terminov."
        />
      )}

      <p className="text-sm text-ink-muted">
        Odpovedani termini niso prikazani. Sivo je izven delovnega časa, črtkano pa odsotnost.
      </p>

      {openBooking && (
        <BookingSheet
          booking={openBooking}
          service={serviceById.get(openBooking.service_id)}
          staff={staffById.get(openBooking.staff_id)}
          customer={customerById.get(openBooking.customer_id)}
          timezone={tz}
          closeHref={calendarHref(state)}
        />
      )}
    </div>
  );
}
