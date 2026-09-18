/**
 * The booking flow lives in the URL, so every step is a plain server-rendered
 * page, the back button works and nothing has to be kept in browser state.
 *
 *   /rezervacija                      step 1: service
 *   ?service=ID                       step 2: staff
 *   ?service=ID&staff=ID|any          step 3: day and time (&month=YYYY-MM, &day=YYYY-MM-DD)
 *   ?service=ID&staff=ID|any&time=ISO step 4: details
 */
export interface FlowState {
  service?: string;
  staff?: string;
  month?: string;
  day?: string;
  time?: string;
}

export const FLOW_PATH = "/rezervacija";

export function flowHref(state: FlowState, hash?: string): string {
  const params = new URLSearchParams();
  for (const key of ["service", "staff", "month", "day", "time"] as const) {
    const value = state[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `${FLOW_PATH}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}
