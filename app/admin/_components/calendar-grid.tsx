import Link from "next/link";
import type { BookingStatus } from "@/lib/types";

/*
 * Calendar built with a CSS grid, no library.
 *
 *   header row:  [corner] [column] [column] ...
 *   body row:    [hours]  [column] [column] ...
 *
 * A column is one staff member (day view) or one day (week view). A column has
 * one or more lanes side by side: in the week view each day is split into one
 * lane per staff member so bookings of different staff never overlap.
 * Positions are minutes since midnight turned into `calc(var(--hour-h) * hours)`,
 * so the row height is a single CSS variable.
 */

export interface CalendarBooking {
  id: string;
  startMin: number;
  endMin: number;
  customer: string;
  service: string;
  /** "10:00–10:45" */
  time: string;
  /** For screen readers: everything about the booking in one sentence. */
  label: string;
  status: BookingStatus;
  href: string;
  selected: boolean;
}

export interface CalendarLane {
  key: string;
  /** Staff color (validated hex). */
  color: string;
  /** Working windows as [startMin, endMin]; the rest of the day is shaded. */
  open: [number, number][];
  off: { startMin: number; endMin: number; label: string }[];
  bookings: CalendarBooking[];
}

export interface CalendarColumn {
  key: string;
  label: string;
  sublabel?: string;
  isToday: boolean;
  lanes: CalendarLane[];
}

interface Props {
  columns: CalendarColumn[];
  /** Visible range in minutes since midnight, whole hours. */
  axisStart: number;
  axisEnd: number;
  /** Current time in minutes, drawn in today's columns only. */
  nowMin: number | null;
  /** Minimum width of one column. */
  minColumnWidth: string;
  /** Text under the grid for screen readers when nothing is booked. */
  emptyLabel: string;
}

/** `calc()` for a position in minutes from the top of the axis. */
function y(minutes: number, axisStart: number): string {
  return `calc(var(--hour-h) * ${(minutes - axisStart) / 60})`;
}

/** The parts of [axisStart, axisEnd] that are not inside any open window. */
function closedSegments(
  open: [number, number][],
  axisStart: number,
  axisEnd: number,
): [number, number][] {
  const result: [number, number][] = [];
  let cursor = axisStart;
  for (const [start, end] of [...open].sort((a, b) => a[0] - b[0])) {
    if (start > cursor) result.push([cursor, Math.min(start, axisEnd)]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < axisEnd) result.push([cursor, axisEnd]);
  return result;
}

const statusClass: Record<BookingStatus, string> = {
  pending: "outline outline-1 -outline-offset-1 outline-dashed",
  confirmed: "",
  completed: "opacity-70",
  no_show: "opacity-60",
  cancelled: "hidden",
};

export function CalendarGrid({ columns, axisStart, axisEnd, nowMin, minColumnWidth, emptyLabel }: Props) {
  const hours: number[] = [];
  for (let minute = axisStart; minute < axisEnd; minute += 60) hours.push(minute);
  const bodyHeight = `calc(var(--hour-h) * ${(axisEnd - axisStart) / 60})`;
  const hasBookings = columns.some((c) => c.lanes.some((l) => l.bookings.length > 0));

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <div
        // Phone: 5.75rem per hour, so even a 30 minute booking is a 44px tap target.
        className="grid [--hour-h:5.75rem] md:[--hour-h:4rem]"
        style={{
          gridTemplateColumns: `3.25rem repeat(${columns.length}, minmax(${minColumnWidth}, 1fr))`,
        }}
      >
        {/* header row */}
        <div className="sticky left-0 z-30 border-b border-line bg-surface" />
        {columns.map((column) => (
          <div
            key={column.key}
            className={`border-b border-l border-line px-1 py-2 text-center ${
              column.isToday ? "bg-brand-soft" : ""
            }`}
          >
            <p className={`truncate text-sm font-semibold ${column.isToday ? "text-brand-ink" : ""}`}>
              {column.label}
            </p>
            {column.sublabel && <p className="text-xs text-ink-muted">{column.sublabel}</p>}
          </div>
        ))}

        {/* body row: hour labels */}
        <div
          className="sticky left-0 z-20 bg-surface"
          style={{ height: bodyHeight }}
          aria-hidden="true"
        >
          <div className="relative h-full">
            {hours.map((minute, index) => (
              <span
                key={minute}
                className={`absolute right-1.5 text-[11px] text-ink-muted ${index === 0 ? "" : "-translate-y-1/2"}`}
                style={{ top: y(minute, axisStart) }}
              >
                {minute / 60}:00
              </span>
            ))}
          </div>
        </div>

        {/* body row: columns */}
        {columns.map((column) => (
          <div
            key={column.key}
            className="relative border-l border-line"
            style={{
              height: bodyHeight,
              // one hairline per hour
              backgroundImage:
                "linear-gradient(to bottom, transparent calc(var(--hour-h) - 1px), var(--color-line) 0)",
              backgroundSize: "100% var(--hour-h)",
            }}
          >
            {column.lanes.map((lane, laneIndex) => (
              <div
                key={lane.key}
                className={`absolute inset-y-0 ${laneIndex > 0 ? "border-l border-dashed border-line" : ""}`}
                style={{
                  left: `${(laneIndex / column.lanes.length) * 100}%`,
                  width: `${100 / column.lanes.length}%`,
                }}
              >
                {closedSegments(lane.open, axisStart, axisEnd).map(([start, end]) => (
                  <div
                    key={`closed-${start}`}
                    aria-hidden="true"
                    className="absolute inset-x-0 bg-ink/[0.05]"
                    style={{ top: y(start, axisStart), height: `calc(var(--hour-h) * ${(end - start) / 60})` }}
                  />
                ))}

                {lane.off.map((off) => {
                  const start = Math.max(off.startMin, axisStart);
                  const end = Math.min(off.endMin, axisEnd);
                  if (end <= start) return null;
                  return (
                    <div
                      key={`off-${off.startMin}`}
                      className="absolute inset-x-0 overflow-hidden border-y border-warning/30 px-1 pt-1 text-[11px] font-medium text-warning"
                      style={{
                        top: y(start, axisStart),
                        height: `calc(var(--hour-h) * ${(end - start) / 60})`,
                        backgroundImage:
                          "repeating-linear-gradient(135deg, transparent 0 6px, rgb(180 83 9 / 0.12) 6px 7px)",
                      }}
                    >
                      {off.label}
                    </div>
                  );
                })}

                {lane.bookings.map((booking) => (
                  <Link
                    key={booking.id}
                    href={booking.href}
                    aria-label={booking.label}
                    className={`absolute inset-x-0.5 z-10 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-[11px] leading-tight text-ink transition-shadow hover:shadow-card focus-visible:z-20 ${statusClass[booking.status]} ${
                      booking.selected ? "ring-2 ring-ink" : ""
                    }`}
                    style={{
                      top: y(booking.startMin, axisStart),
                      height: `calc(var(--hour-h) * ${(booking.endMin - booking.startMin) / 60} - 2px)`,
                      minHeight: "1.5rem",
                      borderColor: lane.color,
                      backgroundColor: `color-mix(in oklab, ${lane.color} 16%, white)`,
                      outlineColor: lane.color,
                    }}
                  >
                    <span
                      className={`block truncate font-semibold ${booking.status === "no_show" ? "line-through" : ""}`}
                    >
                      {booking.customer}
                    </span>
                    <span className="block truncate text-ink-muted">
                      {booking.time} {booking.service}
                    </span>
                  </Link>
                ))}
              </div>
            ))}

            {column.isToday && nowMin !== null && nowMin >= axisStart && nowMin <= axisEnd && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger"
                style={{ top: y(nowMin, axisStart) }}
              >
                <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-danger" />
              </div>
            )}
          </div>
        ))}
      </div>

      {!hasBookings && <p className="sr-only">{emptyLabel}</p>}
    </div>
  );
}
