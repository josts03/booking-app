import Link from "next/link";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  parseISO,
} from "date-fns";
import { sl } from "date-fns/locale";
import { getFreeSlotsByDay } from "@/lib/data";
import { formatTime, localDay } from "@/lib/format";
import type { Salon, Service } from "@/lib/types";
import { flowHref } from "./flow-url";

const WEEKDAYS = ["Pon", "Tor", "Sre", "Čet", "Pet", "Sob", "Ned"];
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface Props {
  salon: Salon;
  service: Service;
  /** A staff id, or "any". */
  staff: string;
  monthParam?: string;
  dayParam?: string;
}

/**
 * Step 3: month calendar (days without free times are disabled) and, for the
 * selected day, a grid of free start times.
 *
 * Dates here are plain calendar dates ("YYYY-MM-DD") in the salon's timezone;
 * only instants (slot start times) go through date-fns-tz.
 */
export async function DateTimeStep({ salon, service, staff, monthParam, dayParam }: Props) {
  const tz = salon.timezone;
  const staffId = staff === "any" ? null : staff;

  const today = localDay(new Date(), tz);
  const lastBookable = format(addDays(parseISO(today), salon.max_days_ahead), "yyyy-MM-dd");
  const firstMonth = today.slice(0, 7);
  const lastMonth = lastBookable.slice(0, 7);

  const validDay = dayParam && DAY_PATTERN.test(dayParam) ? dayParam : undefined;
  const requestedMonth =
    monthParam && MONTH_PATTERN.test(monthParam) ? monthParam : validDay?.slice(0, 7);
  const month =
    requestedMonth && requestedMonth >= firstMonth && requestedMonth <= lastMonth
      ? requestedMonth
      : firstMonth;

  const monthStart = parseISO(`${month}-01`);
  const daysOfMonth = eachDayOfInterval({ start: monthStart, end: endOfMonth(monthStart) }).map(
    (date) => format(date, "yyyy-MM-dd"),
  );

  // Free slots for every bookable day of this month (engine: lib/slots.ts).
  // One call for the whole month on purpose: asking day by day would be around
  // ninety database round trips for a single page view.
  const bookableDays = daysOfMonth.filter((day) => day >= today && day <= lastBookable);
  const slotsByDay = await getFreeSlotsByDay({
    salon_id: salon.id,
    service_id: service.id,
    staff_id: staffId,
    days: bookableDays,
  });

  const hasAnyFreeDay = [...slotsByDay.values()].some((slots) => slots.length > 0);
  const selectedDay = validDay && slotsByDay.get(validDay)?.length ? validDay : undefined;
  // With "anyone", several staff can share a start time: show each time once.
  const times = selectedDay
    ? [...new Set(slotsByDay.get(selectedDay)!.map((slot) => slot.starts_at))]
    : [];

  const previousMonth = month > firstMonth ? format(addDays(monthStart, -1), "yyyy-MM") : undefined;
  const nextMonth = month < lastMonth ? format(addDays(endOfMonth(monthStart), 1), "yyyy-MM") : undefined;
  const monthHref = (target: string) => flowHref({ service: service.id, staff, month: target });

  const leadingBlanks = (getDay(monthStart) + 6) % 7; // weeks start on Monday

  return (
    <section className="space-y-6">
      <h1 className="text-title font-bold">Izberite dan in uro</h1>

      <div className="rounded-card border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <MonthLink href={previousMonth && monthHref(previousMonth)} label="Prejšnji mesec">
            ‹
          </MonthLink>
          <h2 className="font-semibold" aria-live="polite">
            {capitalize(format(monthStart, "LLLL yyyy", { locale: sl }))}
          </h2>
          <MonthLink href={nextMonth && monthHref(nextMonth)} label="Naslednji mesec">
            ›
          </MonthLink>
        </div>

        <ul className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-ink-muted" aria-hidden="true">
          {WEEKDAYS.map((weekday) => (
            <li key={weekday} className="py-1">
              {weekday}
            </li>
          ))}
        </ul>

        <ul className="grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <li key={`blank-${i}`} aria-hidden="true" />
          ))}
          {daysOfMonth.map((day) => {
            const free = (slotsByDay.get(day)?.length ?? 0) > 0;
            const selected = day === selectedDay;
            const label = capitalize(format(parseISO(day), "EEEE, d. M. yyyy", { locale: sl }));
            const base =
              "flex h-11 items-center justify-center rounded-control text-sm font-medium";
            return (
              <li key={day}>
                {free ? (
                  <Link
                    href={flowHref({ service: service.id, staff, month, day }, "termini")}
                    aria-label={label}
                    aria-current={selected ? "date" : undefined}
                    className={`${base} ${
                      selected
                        ? "bg-brand text-brand-foreground"
                        : "bg-brand-soft text-brand-ink hover:bg-brand-line"
                    }`}
                  >
                    {Number(day.slice(8))}
                  </Link>
                ) : (
                  <span
                    aria-label={`${label}, ni prostih terminov`}
                    aria-disabled="true"
                    className={`${base} text-ink-muted/40`}
                  >
                    {Number(day.slice(8))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {!hasAnyFreeDay && (
          <p className="mt-4 text-sm text-ink-muted">
            V tem mesecu ni prostih terminov.
            {nextMonth && (
              <>
                {" "}
                <Link href={monthHref(nextMonth)} className="font-medium text-brand-ink underline">
                  Poglejte naslednji mesec
                </Link>
                .
              </>
            )}
          </p>
        )}
      </div>

      <div id="termini" className="scroll-mt-4">
        {selectedDay ? (
          <>
            <h2 className="mb-3 font-semibold">
              Prosti termini,{" "}
              {format(parseISO(selectedDay), "EEEE, d. M.", { locale: sl })}
            </h2>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {times.map((startsAt) => (
                <li key={startsAt}>
                  <Link
                    href={flowHref({ service: service.id, staff, month, day: selectedDay, time: startsAt })}
                    className="flex h-12 items-center justify-center rounded-control border border-brand-line bg-surface font-semibold text-brand-ink transition-colors hover:bg-brand hover:text-brand-foreground"
                  >
                    {formatTime(startsAt, tz)}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          hasAnyFreeDay && (
            <p className="text-ink-muted">Izberite dan, da vidite proste ure.</p>
          )
        )}
      </div>
    </section>
  );
}

function MonthLink({
  href,
  label,
  children,
}: {
  href: string | undefined;
  label: string;
  children: React.ReactNode;
}) {
  const base = "flex size-11 items-center justify-center rounded-control text-2xl leading-none";
  return href ? (
    <Link href={href} aria-label={label} className={`${base} text-ink hover:bg-brand-soft`}>
      {children}
    </Link>
  ) : (
    <span aria-hidden="true" className={`${base} text-ink-muted/30`}>
      {children}
    </span>
  );
}
