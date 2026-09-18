export type CalendarView = "day" | "week";

export interface CalendarState {
  view: CalendarView;
  /** Any local date in the shown day or week, "YYYY-MM-DD". */
  date: string;
  /** Show only this staff member (a staff id). */
  staff?: string;
  /** Booking whose details are open. */
  booking?: string;
}

export function calendarHref(state: CalendarState): string {
  const params = new URLSearchParams({ view: state.view, date: state.date });
  if (state.staff) params.set("staff", state.staff);
  if (state.booking) params.set("booking", state.booking);
  return `/admin/koledar?${params.toString()}`;
}
