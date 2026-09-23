/**
 * The ONLY file through which the app reads or writes data.
 *
 * Everything here talks to Supabase. Which client a function uses is the thing
 * to get right, and each one says why it picked its own (see lib/supabase.ts):
 *
 *   supabaseServer()  the signed-in user, under row level security. The default
 *                     for reads and for every admin write, so a salon can only
 *                     ever touch its own rows.
 *   supabaseAdmin()   service role, bypassing RLS. Only where the visitor has
 *                     no account at all: signing up, booking, cancelling by
 *                     token, and reading busy times for the public calendar.
 *
 * A read refused by RLS comes back EMPTY rather than as an error, so failed()
 * logs anything that is a genuine fault and the two can be told apart.
 */
import { addDays, addMinutes, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { canChangeTo } from "./booking-status";
import { isSupabaseConfigured, supabaseAdmin, supabaseServer } from "./supabase";
import { freeSlots, type StaffAvailability } from "./slots";
import type {
  Booking,
  BookingStatus,
  CreateBookingResult,
  Customer,
  CustomerInput,
  CustomerSummary,
  FreeSlot,
  FreeSlotsQuery,
  NewBooking,
  Salon,
  SalonInput,
  SaveBookingResult,
  SaveCustomerResult,
  SaveSalonResult,
  SaveServiceResult,
  SaveStaffResult,
  SaveTimeOffResult,
  Service,
  ServiceInput,
  SignInInput,
  SignInResult,
  SignupInput,
  SignupResult,
  Staff,
  StaffHours,
  StaffHoursInput,
  StaffInput,
  StaffService,
  TimeOff,
  TimeOffInput,
  Timestamptz,
  Uuid,
} from "./types";

/**
 * Postgres errors must never pass unnoticed. Row level security is different:
 * it refuses by returning NO ROWS rather than an error, so an empty list can
 * mean "nothing there" or "not allowed to see it" — the logs are the only place
 * that tells the two apart while lib/data.ts is being moved onto Supabase.
 */
function failed(where: string, error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  console.error(`[data.ts ${where}] ${error.code ?? ""} ${error.message}`.trim());
  return true;
}

// ---------- reads ----------

export async function getSalon(slug: string): Promise<Salon | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("salons")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (failed("getSalon", error)) return null;
  return (data as Salon | null) ?? null;
}

/** Active services only, unless `includeInactive` (admin screens). */
export async function getServices(
  salonId: Uuid,
  options: { includeInactive?: boolean } = {},
): Promise<Service[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("services").select("*").eq("salon_id", salonId);
  if (!options.includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query.order("sort_order");
  if (failed("getServices", error)) return [];
  return (data ?? []) as Service[];
}

/**
 * Active staff only, unless `includeInactive` (admin screens).
 * With `serviceId`: only staff who perform that service (staff_services).
 */
export async function getStaff(
  salonId: Uuid,
  options: { includeInactive?: boolean; serviceId?: Uuid } = {},
): Promise<Staff[]> {
  const supabase = await supabaseServer();

  // Who performs the service, looked up first. Two small queries beat one
  // embedded join here: `staff_services` reaches `staff` through a composite
  // foreign key, which PostgREST cannot always resolve on its own.
  let allowed: Uuid[] | null = null;
  if (options.serviceId !== undefined) {
    const { data, error } = await supabase
      .from("staff_services")
      .select("staff_id")
      .eq("salon_id", salonId)
      .eq("service_id", options.serviceId);
    if (failed("getStaff/links", error)) return [];
    allowed = (data ?? []).map((row) => row.staff_id as Uuid);
    if (allowed.length === 0) return [];
  }

  let query = supabase.from("staff").select("*").eq("salon_id", salonId);
  if (!options.includeInactive) query = query.eq("is_active", true);
  if (allowed) query = query.in("id", allowed);

  const { data, error } = await query.order("sort_order");
  if (failed("getStaff", error)) return [];
  return (data ?? []) as Staff[];
}

/**
 * Bookings of a salon that start in [from, to), oldest first, all statuses.
 * Admin only: with the real database, `bookings` has no policy for anon.
 */
export async function getBookings(
  salonId: Uuid,
  from: Date,
  to: Date,
): Promise<Booking[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("salon_id", salonId)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at");
  if (failed("getBookings", error)) return [];
  return (data ?? []) as Booking[];
}

/**
 * Finds a booking by its cancel_token (compared in full, never by id).
 * The caller must still check that booking.salon_id is the current salon.
 */
export async function getBookingByCancelToken(token: string): Promise<Booking | null> {
  // Service role: the visitor holding this link has no account, and `bookings`
  // has no public policy. The token is the whole credential, so it is compared
  // in full and the caller still checks the salon.
  const { data, error } = await supabaseAdmin()
    .from("bookings")
    .select("*")
    .eq("cancel_token", token)
    .maybeSingle();
  if (failed("getBookingByCancelToken", error)) return null;
  return (data as Booking | null) ?? null;
}

// ---------- admin reads ----------
// Everything below is for the admin area. With the real database these go
// through the logged-in user (RLS) or the server-only service_role client.

export async function getStaffHours(salonId: Uuid): Promise<StaffHours[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("staff_hours")
    .select("*")
    .eq("salon_id", salonId);
  if (failed("getStaffHours", error)) return [];
  return (data ?? []) as StaffHours[];
}

export async function getStaffServices(salonId: Uuid): Promise<StaffService[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("staff_services")
    .select("*")
    .eq("salon_id", salonId);
  if (failed("getStaffServices", error)) return [];
  return (data ?? []) as StaffService[];
}

/** Time off that overlaps [from, to). staff_id null means the whole salon. */
export async function getTimeOff(salonId: Uuid, from: Date, to: Date): Promise<TimeOff[]> {
  const supabase = await supabaseServer();
  // Overlaps [from, to): it starts before the window ends and ends after it begins.
  const { data, error } = await supabase
    .from("time_off")
    .select("*")
    .eq("salon_id", salonId)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at");
  if (failed("getTimeOff", error)) return [];
  return (data ?? []) as TimeOff[];
}

/** One booking of this salon by id (admin only; visitors use the cancel_token). */
export async function getBooking(salonId: Uuid, bookingId: Uuid): Promise<Booking | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("salon_id", salonId)
    .maybeSingle();
  if (failed("getBooking", error)) return null;
  return (data as Booking | null) ?? null;
}

export async function getCustomer(salonId: Uuid, customerId: Uuid): Promise<Customer | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .eq("salon_id", salonId)
    .maybeSingle();
  if (failed("getCustomer", error)) return null;
  return (data as Customer | null) ?? null;
}

/** Lower case and without diacritics, so "kovacic" finds "Kovačič". */
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Customers of a salon with visit numbers, sorted by name. `query` searches
 * name, e-mail and phone number (phone ignores spaces and dashes).
 */
export async function getCustomers(
  salonId: Uuid,
  options: { query?: string } = {},
): Promise<CustomerSummary[]> {
  const supabase = await supabaseServer();

  // The whole list comes back and is filtered here rather than in SQL, because
  // the search has to ignore Slovenian diacritics ("Zajc" must find "Žajc") and
  // Postgres would need the unaccent extension for that. Fine for the hundreds
  // of customers a salon has; past a few thousand this belongs in the database.
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("salon_id", salonId);
  if (failed("getCustomers", error)) return [];

  const query = fold(options.query?.trim() ?? "");
  const queryDigits = query.replace(/\D/g, "");

  const matches = (c: Customer): boolean => {
    if (!query) return true;
    const name = fold(`${c.first_name} ${c.last_name ?? ""}`);
    if (name.includes(query) || fold(c.email ?? "").includes(query)) return true;
    return queryDigits.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(queryDigits);
  };

  const customers = ((data ?? []) as Customer[]).filter(matches);
  if (customers.length === 0) return [];

  // One more query for the visit numbers of exactly these customers.
  const ids = customers.map((c) => c.id);
  const visits = await supabase
    .from("bookings")
    .select("customer_id, starts_at, status")
    .eq("salon_id", salonId)
    .in("customer_id", ids)
    .neq("status", "cancelled");
  if (failed("getCustomers/bookings", visits.error)) return [];

  type Visit = { customer_id: Uuid; starts_at: Timestamptz; status: BookingStatus };
  const byCustomer = new Map<Uuid, Visit[]>();
  for (const visit of (visits.data ?? []) as Visit[]) {
    const list = byCustomer.get(visit.customer_id);
    if (list) list.push(visit);
    else byCustomer.set(visit.customer_id, [visit]);
  }

  const now = new Date();
  return customers
    .map((customer) => {
      const own = byCustomer.get(customer.id) ?? [];
      const past = own.filter((b) => parseISO(b.starts_at) <= now);
      const upcoming = own.filter(
        (b) => parseISO(b.starts_at) > now && (b.status === "pending" || b.status === "confirmed"),
      );
      return {
        customer,
        bookings_count: own.length,
        last_visit_at: past.map((b) => b.starts_at).sort().at(-1) ?? null,
        next_visit_at: upcoming.map((b) => b.starts_at).sort()[0] ?? null,
      };
    })
    .sort((a, b) =>
      `${a.customer.last_name ?? ""} ${a.customer.first_name}`.localeCompare(
        `${b.customer.last_name ?? ""} ${b.customer.first_name}`,
        "sl",
      ),
    );
}

/** All bookings of one customer, newest first, all statuses. */
export async function getCustomerBookings(
  salonId: Uuid,
  customerId: Uuid,
): Promise<Booking[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("salon_id", salonId)
    .eq("customer_id", customerId)
    .order("starts_at", { ascending: false });
  if (failed("getCustomerBookings", error)) return [];
  return (data ?? []) as Booking[];
}

// ---------- admin writes: services ----------

/** Same limits as the database (services.duration_min check, non-negative numbers). */
function validService(input: ServiceInput): boolean {
  return (
    input.name.trim().length > 0 &&
    Number.isInteger(input.duration_min) &&
    input.duration_min >= 5 &&
    input.duration_min <= 600 &&
    Number.isInteger(input.buffer_after_min) &&
    input.buffer_after_min >= 0 &&
    Number.isInteger(input.price_cents) &&
    input.price_cents >= 0
  );
}

const SERVICE_INVALID = "Podatkov o storitvi ni mogoče shraniti. Preverite vnos.";

export async function createService(
  salonId: Uuid,
  input: ServiceInput,
): Promise<SaveServiceResult> {
  if (!validService(input)) return { ok: false, error: SERVICE_INVALID };
  const supabase = await supabaseServer();

  // New services go at the end of the salon's own list.
  const last = await supabase
    .from("services")
    .select("sort_order")
    .eq("salon_id", salonId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("services")
    .insert({
      salon_id: salonId,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      duration_min: input.duration_min,
      buffer_after_min: input.buffer_after_min,
      price_cents: input.price_cents,
      is_active: input.is_active,
      sort_order: ((last.data?.sort_order as number | undefined) ?? 0) + 1,
    })
    .select()
    .single();

  if (error) {
    failed("createService", error);
    return { ok: false, error: SERVICE_INVALID };
  }
  return { ok: true, service: data as Service };
}

/**
 * Updates a service of this salon. Bookings keep the price they were made with
 * (bookings.price_cents), so a price change only affects new bookings.
 */
export async function updateService(
  salonId: Uuid,
  serviceId: Uuid,
  input: ServiceInput,
): Promise<SaveServiceResult> {
  if (!validService(input)) return { ok: false, error: SERVICE_INVALID };
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("services")
    .update({
      name: input.name.trim(),
      category: input.category?.trim() || null,
      duration_min: input.duration_min,
      buffer_after_min: input.buffer_after_min,
      price_cents: input.price_cents,
      is_active: input.is_active,
    })
    .eq("id", serviceId)
    .eq("salon_id", salonId)
    .select()
    .maybeSingle();

  if (error) {
    failed("updateService", error);
    return { ok: false, error: SERVICE_INVALID };
  }
  // No row came back: either it is gone, or RLS refused it. Same answer either way.
  if (!data) return { ok: false, error: SERVICE_INVALID };
  return { ok: true, service: data as Service };
}

// ---------- free slots ----------

/** Longest cleanup buffer the schema allows, used to widen lookups. */
const MAX_BUFFER_MIN = 240;

/** Only the columns the slot engine needs; no customer data ever comes along. */
type BusyBooking = Pick<Booking, "starts_at" | "ends_at" | "buffer_min" | "status"> & {
  staff_id: Uuid;
};

/**
 * Everything lib/slots.ts needs, fetched ONCE for a whole range of days.
 *
 * This shape exists because of a trap: the month view asks about every bookable
 * day, and one query per day would be ~90 round trips for a single page load.
 * Five queries cover the whole month instead, and the engine then runs in memory.
 *
 * Bookings are read with the SERVICE ROLE client. `bookings` deliberately has
 * no public policy, yet a visitor must still be told which times are taken. It
 * is safe here because nothing about a booking leaves this module: the callers
 * only ever receive FreeSlot, which carries a staff id and two timestamps.
 * A tighter version later would be a SECURITY DEFINER function returning just
 * the busy intervals.
 */
async function loadAvailability(
  salonId: Uuid,
  serviceId: Uuid,
  staffId: Uuid | null,
  windowStart: Date,
  windowEnd: Date,
): Promise<{ salon: Salon; service: Service; staff: StaffAvailability[] } | null> {
  const supabase = await supabaseServer();

  const [salonResult, serviceResult] = await Promise.all([
    supabase.from("salons").select("*").eq("id", salonId).maybeSingle(),
    supabase
      .from("services")
      .select("*")
      .eq("id", serviceId)
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);
  if (failed("loadAvailability/salon", salonResult.error)) return null;
  if (failed("loadAvailability/service", serviceResult.error)) return null;

  const salon = salonResult.data as Salon | null;
  const service = serviceResult.data as Service | null;
  if (!salon || !service) return null;

  const staff = await getStaff(salonId, { serviceId });
  const candidates = staffId ? staff.filter((member) => member.id === staffId) : staff;
  if (candidates.length === 0) return null;

  const ids = candidates.map((member) => member.id);
  // A booking that ended before the window can still block it through its
  // cleanup buffer, so look back by the longest buffer the schema permits.
  const lookback = addMinutes(windowStart, -MAX_BUFFER_MIN).toISOString();

  const [hoursResult, offResult, bookingsResult] = await Promise.all([
    supabase.from("staff_hours").select("*").eq("salon_id", salonId).in("staff_id", ids),
    supabase
      .from("time_off")
      .select("*")
      .eq("salon_id", salonId)
      .lt("starts_at", windowEnd.toISOString())
      .gt("ends_at", windowStart.toISOString()),
    supabaseAdmin()
      .from("bookings")
      .select("staff_id, starts_at, ends_at, buffer_min, status")
      .eq("salon_id", salonId)
      .in("staff_id", ids)
      .neq("status", "cancelled")
      .lt("starts_at", windowEnd.toISOString())
      .gt("ends_at", lookback),
  ]);
  if (failed("loadAvailability/hours", hoursResult.error)) return null;
  if (failed("loadAvailability/timeOff", offResult.error)) return null;
  if (failed("loadAvailability/bookings", bookingsResult.error)) return null;

  const hours = (hoursResult.data ?? []) as StaffHours[];
  const timeOff = (offResult.data ?? []) as TimeOff[];
  const bookings = (bookingsResult.data ?? []) as unknown as BusyBooking[];

  return {
    salon,
    service,
    staff: candidates.map((member) => ({
      staff_id: member.id,
      hours: hours.filter((h) => h.staff_id === member.id),
      // staff_id null closes the whole salon, so it applies to everyone.
      timeOff: timeOff.filter((t) => t.staff_id === null || t.staff_id === member.id),
      bookings: bookings.filter((b) => b.staff_id === member.id),
    })),
  };
}

/** The instant a local calendar day begins in the salon's timezone. */
function dayStart(day: string, timezone: string): Date {
  return fromZonedTime(`${day}T00:00:00`, timezone);
}

/**
 * Bookable start times for several local days at once, keyed by day.
 *
 * Use this whenever more than one day is needed — the month picker especially.
 * Every rule still lives in lib/slots.ts; this only gathers rows.
 */
export async function getFreeSlotsByDay(query: {
  salon_id: Uuid;
  service_id: Uuid;
  staff_id: Uuid | null;
  days: string[];
}): Promise<Map<string, FreeSlot[]>> {
  const empty = new Map(query.days.map((day) => [day, [] as FreeSlot[]]));

  const days = [...query.days].filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
  if (days.length === 0) return empty;

  const supabase = await supabaseServer();
  const { data: salonRow, error } = await supabase
    .from("salons")
    .select("timezone")
    .eq("id", query.salon_id)
    .maybeSingle();
  if (failed("getFreeSlotsByDay/timezone", error) || !salonRow) return empty;

  const timezone = (salonRow as { timezone: string }).timezone;
  const windowStart = dayStart(days[0], timezone);
  // Exclusive end: midnight after the last day asked about.
  const windowEnd = addMinutes(dayStart(days[days.length - 1], timezone), 60 * 24);

  const loaded = await loadAvailability(
    query.salon_id,
    query.service_id,
    query.staff_id,
    windowStart,
    windowEnd,
    );
  if (!loaded) return empty;

  const now = new Date();
  const result = new Map<string, FreeSlot[]>();
  for (const day of query.days) {
    result.set(
      day,
      freeSlots({
        salon: loaded.salon,
        service: loaded.service,
        day,
        staff: loaded.staff,
        now,
      }),
    );
  }
  return result;
}

/** Bookable start times for one local day. */
export async function getFreeSlots(query: FreeSlotsQuery): Promise<FreeSlot[]> {
  const byDay = await getFreeSlotsByDay({
    salon_id: query.salon_id,
    service_id: query.service_id,
    staff_id: query.staff_id,
    days: [query.day],
  });
  return byDay.get(query.day) ?? [];
}

// ---------- writes ----------

const MESSAGES = {
  invalid: "Izbrane storitve ali zaposlenega ni mogoče rezervirati. Poskusite znova.",
  taken: "Ta termin je bil pravkar zaseden. Izberite drug.",
  unavailable: "Ta termin ni več na voljo. Izberite drug.",
} as const;

/**
 * Creates a booking (and the customer, if the phone number is new).
 *
 * Mirrors what the real server action must do (CLAUDE.md, specs/security.md):
 * - salon, service and staff must belong together and staff must perform the service
 * - price, end time, buffer and status come from the database, never from the input
 * - availability is re-checked, and an overlap gives the "just taken" message
 *   (with Postgres this is the exclusion constraint, error 23P01)
 *
 * Input validation (Zod) is added with the real server action.
 */
export async function createBooking(input: NewBooking): Promise<CreateBookingResult> {
  const db = supabaseAdmin();

  // Salon, service and staff are re-read from the database: the browser only
  // said WHICH ones, never what they cost or how long they take.
  const [salonRow, serviceRow, staffRow, linkRow] = await Promise.all([
    db.from("salons").select("*").eq("id", input.salon_id).maybeSingle(),
    db
      .from("services")
      .select("*")
      .eq("id", input.service_id)
      .eq("salon_id", input.salon_id)
      .eq("is_active", true)
      .maybeSingle(),
    db
      .from("staff")
      .select("*")
      .eq("id", input.staff_id)
      .eq("salon_id", input.salon_id)
      .eq("is_active", true)
      .maybeSingle(),
    db
      .from("staff_services")
      .select("staff_id")
      .eq("staff_id", input.staff_id)
      .eq("service_id", input.service_id)
      .eq("salon_id", input.salon_id)
      .maybeSingle(),
  ]);

  const salon = salonRow.data as Salon | null;
  const service = serviceRow.data as Service | null;
  const member = staffRow.data as Staff | null;
  const start = new Date(input.starts_at);

  if (!salon || !service || !member || !linkRow.data || Number.isNaN(start.getTime())) {
    return { ok: false, error: MESSAGES.invalid };
  }

  // Was this start time actually on offer? Catches stale tabs and hand-typed URLs.
  const day = formatInTimeZone(start, salon.timezone, "yyyy-MM-dd");
  const offered = await getFreeSlots({
    salon_id: salon.id,
    service_id: service.id,
    staff_id: member.id,
    day,
  });
  if (!offered.some((slot) => new Date(slot.starts_at).getTime() === start.getTime())) {
    return { ok: false, error: MESSAGES.unavailable };
  }

  // A returning customer is recognised by phone number within this salon.
  const phone = input.phone.trim();
  const existing = await db
    .from("customers")
    .select("*")
    .eq("salon_id", salon.id)
    .eq("phone", phone)
    .is("anonymized_at", null)
    .maybeSingle();
  if (failed("createBooking/customer", existing.error)) {
    return { ok: false, error: MESSAGES.invalid };
  }

  let customer = existing.data as Customer | null;
  if (!customer) {
    const created = await db
      .from("customers")
      .insert({
        salon_id: salon.id,
        first_name: input.first_name,
        last_name: input.last_name ?? null,
        phone,
        email: input.email,
        marketing_consent: input.marketing_consent,
      })
      .select()
      .single();

    if (created.error) {
      // 23505: someone with this number was inserted a moment ago. Take theirs.
      if (created.error.code !== "23505") {
        failed("createBooking/newCustomer", created.error);
        return { ok: false, error: MESSAGES.invalid };
      }
      const retry = await db
        .from("customers")
        .select("*")
        .eq("salon_id", salon.id)
        .eq("phone", phone)
        .is("anonymized_at", null)
        .maybeSingle();
      customer = retry.data as Customer | null;
      if (!customer) return { ok: false, error: MESSAGES.invalid };
    } else {
      customer = created.data as Customer;
    }
  }

  // Price, end time, buffer and status all come from the database, never from
  // the form. `period` is left out: the bookings_period trigger fills it.
  const booked = await db
    .from("bookings")
    .insert({
      salon_id: salon.id,
      staff_id: member.id,
      service_id: service.id,
      customer_id: customer.id,
      starts_at: start.toISOString(),
      ends_at: addMinutes(start, service.duration_min).toISOString(),
      buffer_min: service.buffer_after_min,
      status: salon.require_confirmation ? "pending" : "confirmed",
      price_cents: service.price_cents,
      customer_note: input.customer_note ?? null,
      source: input.source ?? "online",
    })
    .select()
    .single();

  if (booked.error) {
    // 23P01: the bookings_no_overlap exclusion constraint. Someone took this
    // exact slot between the check above and this insert — the database is the
    // only place that can settle that race, and it just did.
    if (booked.error.code === "23P01") {
      return { ok: false, error: MESSAGES.taken };
    }
    failed("createBooking/insert", booked.error);
    return { ok: false, error: MESSAGES.invalid };
  }

  return { ok: true, booking: booked.data as Booking };
}

// ---------- signup: new salon ----------

/**
 * Subdomains the platform keeps for itself. A salon may not take one, because
 * they either already resolve somewhere or would be confusing.
 * Mirrors the `salons_slug_not_reserved` check in specs/schema.sql.
 */
const RESERVED_SLUGS = new Set([
  "www", "admin", "api", "app", "mail", "smtp", "ftp", "cdn", "static", "assets",
  "blog", "docs", "help", "support", "status", "dashboard", "login", "signup",
  "prijava", "registracija", "rezervacija", "cenik", "demo", "test-salon",
]);

/** Same shape as the slug check in proxy.ts: a-z, 0-9 and "-", never at the edges. */
const SLUG_RULE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** True when `slug` is free: valid, not reserved and not taken by another salon. */
export async function isSlugAvailable(slug: string): Promise<boolean> {
  const wanted = slug.trim().toLowerCase();
  if (wanted.length < 3 || wanted.length > 40) return false;
  if (!SLUG_RULE.test(wanted) || RESERVED_SLUGS.has(wanted)) return false;

  // Service role on purpose: the public policy only shows salons that are on
  // trial or active, so a suspended salon's address would look free here and
  // the insert would then fail on the unique constraint with a message nobody
  // can act on. Taken is taken, whatever state that salon is in.
  const { data, error } = await supabaseAdmin()
    .from("salons")
    .select("id")
    .eq("slug", wanted)
    .maybeSingle();
  if (failed("isSlugAvailable", error)) return false;
  return data === null;
}

/** Defaults a new salon starts with. In Postgres these are column DEFAULTs. */
const SALON_DEFAULTS = {
  slot_interval_min: 15,
  min_lead_time_min: 120,
  max_days_ahead: 60,
  cancel_window_hours: 24,
  require_confirmation: false,
  reminder_hours_before: 24,
} as const;

/** How long the free trial lasts. The marketing page promises 14 days. */
const TRIAL_DAYS = 14;

/**
 * Creates a salon from the public signup form.
 *
 * NOTE (phase 1): the new salon lives in memory only, so it disappears when the
 * server restarts and it is not shared between serverless instances. With
 * Supabase this becomes one INSERT plus the owner's `staff` row.
 */
export async function createSalon(input: SignupInput): Promise<SignupResult> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "Ime salona mora imeti od 2 do 80 znakov.", field: "name" };
  }

  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RULE.test(slug) || slug.length < 3 || slug.length > 40) {
    return {
      ok: false,
      error: "Naslov lahko vsebuje samo male črke, številke in vezaj (3–40 znakov).",
      field: "slug",
    };
  }
  if (!(await isSlugAvailable(slug))) {
    return { ok: false, error: "Ta naslov je že zaseden. Izberite drugega.", field: "slug" };
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RULE.test(email)) {
    return { ok: false, error: "Vpišite veljaven e-naslov.", field: "email" };
  }

  const phone = input.phone?.trim() || null;
  if (phone && phone.length > 30) {
    return { ok: false, error: "Telefonska številka je predolga.", field: "phone" };
  }

  const timezone = validTimezone(input.timezone) ? input.timezone! : "Europe/Ljubljana";

  // Service role: whoever is signing up has no account yet, and `salons` has no
  // policy that would let an anonymous caller insert one.
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("salons")
    .insert({
      slug,
      name,
      phone,
      email,
      timezone,
      ...SALON_DEFAULTS,
      subscription_status: "trial",
      trial_ends_at: addDays(new Date(), TRIAL_DAYS).toISOString(),
    })
    .select()
    .single();

  if (error) {
    // 23505: someone took the address between the check and this insert.
    if (error.code === "23505") {
      return { ok: false, error: "Ta naslov je že zaseden. Izberite drugega.", field: "slug" };
    }
    failed("createSalon", error);
    return { ok: false, error: "Salona ni mogoče ustvariti. Poskusite znova." };
  }

  const salon = data as Salon;

  // The owner has to exist in the calendar, or the salon has nobody to book
  // with. Two statements rather than one transaction: if this second one fails
  // the salon is removed again, so a half-built salon does not survive. A
  // SECURITY DEFINER function doing both at once would be tidier.
  const owner = await db.from("staff").insert({
    salon_id: salon.id,
    name,
    email,
    phone,
    is_active: true,
    sort_order: 1,
  });

  if (owner.error) {
    failed("createSalon/owner", owner.error);
    await db.from("salons").delete().eq("id", salon.id);
    return { ok: false, error: "Salona ni mogoče ustvariti. Poskusite znova." };
  }

  return { ok: true, salon };
}

// ---------- admin writes: salon settings ----------

/** True for an IANA name the runtime knows ("Europe/Ljubljana"). */
function validTimezone(timezone: string | undefined | null): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("sl-SI", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Limits mirror the CHECK constraints on `salons` in specs/schema.sql. */
const SALON_LIMITS = {
  slot_interval_min: [5, 60],
  min_lead_time_min: [0, 10080],
  max_days_ahead: [1, 365],
  cancel_window_hours: [0, 168],
  reminder_hours_before: [0, 168],
} as const;

const SALON_INVALID = "Nastavitev ni mogoče shraniti. Preverite vnos.";

/**
 * Updates the salon's own settings. Slug, subscription and trial dates are not
 * here on purpose: they belong to the platform, not to the salon owner.
 */
export async function updateSalon(
  salonId: Uuid,
  input: SalonInput,
): Promise<SaveSalonResult> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "Ime salona mora imeti od 2 do 80 znakov." };
  }
  if (!validTimezone(input.timezone)) {
    return { ok: false, error: "Neveljaven časovni pas." };
  }
  const color = input.brand_color?.trim() || null;
  if (color && !HEX_COLOR.test(color)) {
    return { ok: false, error: "Barva mora biti v obliki #0f766e." };
  }
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !EMAIL_RULE.test(email)) {
    return { ok: false, error: "Vpišite veljaven e-naslov." };
  }

  for (const [key, [min, max]] of Object.entries(SALON_LIMITS)) {
    const value = input[key as keyof typeof SALON_LIMITS];
    if (!Number.isInteger(value) || value < min || value > max) {
      return { ok: false, error: SALON_INVALID };
    }
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("salons")
    .update({
      name,
      phone: input.phone?.trim() || null,
      email,
      address: input.address?.trim() || null,
      timezone: input.timezone,
      logo_url: input.logo_url?.trim() || null,
      brand_color: color,
      slot_interval_min: input.slot_interval_min,
      min_lead_time_min: input.min_lead_time_min,
      max_days_ahead: input.max_days_ahead,
      cancel_window_hours: input.cancel_window_hours,
      require_confirmation: input.require_confirmation,
      reminder_hours_before: input.reminder_hours_before,
    })
    .eq("id", salonId)
    .select()
    .maybeSingle();

  if (error) {
    failed("updateSalon", error);
    return { ok: false, error: SALON_INVALID };
  }
  if (!data) return { ok: false, error: SALON_INVALID };
  return { ok: true, salon: data as Salon };
}

// ---------- admin writes: staff ----------

const STAFF_INVALID = "Podatkov o zaposlenem ni mogoče shraniti. Preverite vnos.";

function validStaff(input: StaffInput): boolean {
  const color = input.color?.trim();
  const email = input.email?.trim();
  return (
    input.name.trim().length > 0 &&
    input.name.trim().length <= 80 &&
    (!color || HEX_COLOR.test(color)) &&
    (!email || EMAIL_RULE.test(email))
  );
}

export async function createStaff(
  salonId: Uuid,
  input: StaffInput,
): Promise<SaveStaffResult> {
  if (!validStaff(input)) return { ok: false, error: STAFF_INVALID };
  const supabase = await supabaseServer();

  const last = await supabase
    .from("staff")
    .select("sort_order")
    .eq("salon_id", salonId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("staff")
    .insert({
      salon_id: salonId,
      name: input.name.trim(),
      email: input.email?.trim().toLowerCase() || null,
      phone: input.phone?.trim() || null,
      color: input.color?.trim() || null,
      is_active: input.is_active,
      sort_order: ((last.data?.sort_order as number | undefined) ?? 0) + 1,
    })
    .select()
    .single();

  if (error) {
    failed("createStaff", error);
    return { ok: false, error: STAFF_INVALID };
  }
  return { ok: true, staff: data as Staff };
}

/**
 * Updates a staff member. Turning someone inactive keeps their past bookings:
 * they simply stop being offered on the public page.
 */
export async function updateStaff(
  salonId: Uuid,
  staffId: Uuid,
  input: StaffInput,
): Promise<SaveStaffResult> {
  if (!validStaff(input)) return { ok: false, error: STAFF_INVALID };
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("staff")
    .update({
      name: input.name.trim(),
      email: input.email?.trim().toLowerCase() || null,
      phone: input.phone?.trim() || null,
      color: input.color?.trim() || null,
      is_active: input.is_active,
    })
    .eq("id", staffId)
    .eq("salon_id", salonId)
    .select()
    .maybeSingle();

  if (error) {
    failed("updateStaff", error);
    return { ok: false, error: STAFF_INVALID };
  }
  if (!data) return { ok: false, error: STAFF_INVALID };
  return { ok: true, staff: data as Staff };
}

/**
 * Replaces the set of services this staff member performs. In Postgres this is
 * DELETE + INSERT on `staff_services` inside one transaction.
 */
export async function setStaffServices(
  salonId: Uuid,
  staffId: Uuid,
  serviceIds: Uuid[],
): Promise<StaffService[]> {
  const supabase = await supabaseServer();

  // Only services of this salon may be linked; anything else is dropped rather
  // than rejected, so a stale checkbox cannot block the whole save.
  const own = await supabase.from("services").select("id").eq("salon_id", salonId);
  if (failed("setStaffServices/services", own.error)) return [];
  const allowed = new Set((own.data ?? []).map((row) => row.id as Uuid));
  const wanted = [...new Set(serviceIds)].filter((id) => allowed.has(id));

  // Replace the whole set: delete, then insert. Two statements rather than one
  // transaction — if the insert fails the member is left with no services and
  // the form has to be saved again. A Postgres function would make it atomic.
  const removed = await supabase
    .from("staff_services")
    .delete()
    .eq("staff_id", staffId)
    .eq("salon_id", salonId);
  if (failed("setStaffServices/delete", removed.error)) return [];

  if (wanted.length === 0) return [];

  const { data, error } = await supabase
    .from("staff_services")
    .insert(wanted.map((service_id) => ({ staff_id: staffId, service_id, salon_id: salonId })))
    .select();
  if (failed("setStaffServices/insert", error)) return [];
  return (data ?? []) as StaffService[];
}

/** "9:00" and "09:00" both become "09:00:00"; anything else returns null. */
function normalizeTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Replaces the whole weekly schedule of one staff member. Rows that are not
 * valid (end before start, unknown weekday) are rejected as a whole, so a
 * half-saved week cannot happen.
 */
export async function setStaffHours(
  salonId: Uuid,
  staffId: Uuid,
  hours: StaffHoursInput[],
): Promise<StaffHours[] | null> {
  // Validate the whole week first: one bad row must not leave half a schedule.
  const rows: Omit<StaffHours, "id">[] = [];
  for (const entry of hours) {
    const start = normalizeTime(entry.start_time);
    const end = normalizeTime(entry.end_time);
    if (!start || !end || start >= end) return null;
    if (!Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6) return null;
    rows.push({
      salon_id: salonId,
      staff_id: staffId,
      weekday: entry.weekday,
      start_time: start,
      end_time: end,
    });
  }

  const supabase = await supabaseServer();
  const removed = await supabase
    .from("staff_hours")
    .delete()
    .eq("staff_id", staffId)
    .eq("salon_id", salonId);
  if (failed("setStaffHours/delete", removed.error)) return null;

  if (rows.length === 0) return [];

  const { data, error } = await supabase.from("staff_hours").insert(rows).select();
  if (failed("setStaffHours/insert", error)) return null;
  return (data ?? []) as StaffHours[];
}

// ---------- admin writes: time off ----------

const TIME_OFF_INVALID = "Odsotnosti ni mogoče shraniti. Preverite vnos.";

/** staff_id null closes the whole salon (holiday, renovation). */
export async function createTimeOff(
  salonId: Uuid,
  input: TimeOffInput,
): Promise<SaveTimeOffResult> {
  const start = new Date(input.starts_at);
  const end = new Date(input.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return { ok: false, error: TIME_OFF_INVALID };
  }
  const supabase = await supabaseServer();

  // A composite foreign key already forbids borrowing another salon's staff,
  // but a clear sentence beats a raw constraint error in the form.
  if (input.staff_id) {
    const member = await supabase
      .from("staff")
      .select("id")
      .eq("id", input.staff_id)
      .eq("salon_id", salonId)
      .maybeSingle();
    if (failed("createTimeOff/staff", member.error) || !member.data) {
      return { ok: false, error: TIME_OFF_INVALID };
    }
  }

  const { data, error } = await supabase
    .from("time_off")
    .insert({
      salon_id: salonId,
      staff_id: input.staff_id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      reason: input.reason?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    failed("createTimeOff", error);
    return { ok: false, error: TIME_OFF_INVALID };
  }
  return { ok: true, time_off: data as TimeOff };
}

export async function deleteTimeOff(salonId: Uuid, timeOffId: Uuid): Promise<boolean> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("time_off")
    .delete()
    .eq("id", timeOffId)
    .eq("salon_id", salonId)
    .select("id");
  if (failed("deleteTimeOff", error)) return false;
  return (data ?? []).length > 0;
}

// ---------- admin writes: bookings ----------

const BOOKING_INVALID = "Rezervacije ni mogoče spremeniti.";

/**
 * Moves a booking to another status (confirm, cancel, no-show, complete).
 * The slot is freed only by "cancelled": see blockedIntervals().
 */
export async function setBookingStatus(
  salonId: Uuid,
  bookingId: Uuid,
  status: BookingStatus,
): Promise<SaveBookingResult> {
  const supabase = await supabaseServer();
  const current = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("salon_id", salonId)
    .maybeSingle();
  if (failed("setBookingStatus/read", current.error) || !current.data) {
    return { ok: false, error: BOOKING_INVALID };
  }

  const booking = current.data as Booking;
  if (booking.status === status) return { ok: true, booking };
  if (!canChangeTo(booking.status, status)) {
    return { ok: false, error: "Tega statusa ni mogoče nastaviti." };
  }

  // updated_at is left alone: the bookings_updated_at trigger sets it.
  const { data, error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", bookingId)
    .eq("salon_id", salonId)
    .select()
    .maybeSingle();
  if (failed("setBookingStatus", error) || !data) {
    return { ok: false, error: BOOKING_INVALID };
  }
  return { ok: true, booking: data as Booking };
}

/** The salon's private note on a booking. Never shown to the customer. */
export async function setBookingInternalNote(
  salonId: Uuid,
  bookingId: Uuid,
  note: string | null,
): Promise<SaveBookingResult> {
  const text = note?.trim() ?? "";
  if (text.length > 2000) return { ok: false, error: "Zaznamek je predolg." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("bookings")
    .update({ internal_note: text || null })
    .eq("id", bookingId)
    .eq("salon_id", salonId)
    .select()
    .maybeSingle();
  if (failed("setBookingInternalNote", error) || !data) {
    return { ok: false, error: BOOKING_INVALID };
  }
  return { ok: true, booking: data as Booking };
}

// ---------- public: cancel by token ----------

/**
 * Cancels a booking from the link the customer got by e-mail. The token is the
 * only credential, so this is deliberately narrow: it can cancel and nothing
 * else, and it never reveals whether an unknown token belongs to another salon.
 *
 * The salon's own `cancel_window_hours` decides how late this still works;
 * after that the customer is asked to phone, which is what the confirmation
 * page already promises.
 *
 * NOTE: with Supabase this runs through the service role client, because the
 * visitor has no account and `bookings` has no public RLS policy.
 */
export async function cancelBookingByToken(token: string): Promise<SaveBookingResult> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("bookings")
    .select("*, salons(cancel_window_hours)")
    .eq("cancel_token", token)
    .maybeSingle();
  if (failed("cancelBookingByToken", error) || !data) {
    return { ok: false, error: "Termina ni mogoče najti." };
  }

  const booking = data as Booking & { salons: { cancel_window_hours: number } | null };

  // Cancelling twice is not an error: the customer clicked the link again.
  if (booking.status === "cancelled") return { ok: true, booking };

  if (booking.status === "completed" || booking.status === "no_show") {
    return { ok: false, error: "Tega termina ni več mogoče odpovedati." };
  }

  const windowHours = booking.salons?.cancel_window_hours ?? 0;
  const deadline = addMinutes(parseISO(booking.starts_at), -windowHours * 60);
  if (new Date() > deadline) {
    return {
      ok: false,
      error: `Termin je mogoče odpovedati najpozneje ${windowHours} ur pred začetkom. Pokličite salon.`,
    };
  }

  const updated = await db
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", booking.id)
    .select()
    .single();
  if (updated.error) {
    failed("cancelBookingByToken/update", updated.error);
    return { ok: false, error: "Termina ni mogoče odpovedati." };
  }
  return { ok: true, booking: updated.data as Booking };
}

// ---------- admin writes: customers ----------

const CUSTOMER_INVALID = "Podatkov o stranki ni mogoče shraniti. Preverite vnos.";

export async function updateCustomer(
  salonId: Uuid,
  customerId: Uuid,
  input: CustomerInput,
): Promise<SaveCustomerResult> {
  const first = input.first_name.trim();
  if (first.length < 1 || first.length > 80) return { ok: false, error: CUSTOMER_INVALID };
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !EMAIL_RULE.test(email)) {
    return { ok: false, error: "Vpišite veljaven e-naslov." };
  }

  const supabase = await supabaseServer();
  // `anonymized_at is null` is part of the filter: an erased customer has
  // nothing to edit, and their details must never come back.
  const { data, error } = await supabase
    .from("customers")
    .update({
      first_name: first,
      last_name: input.last_name?.trim() || null,
      phone: input.phone?.trim() || null,
      email,
      notes: input.notes?.trim() || null,
      marketing_consent: input.marketing_consent,
    })
    .eq("id", customerId)
    .eq("salon_id", salonId)
    .is("anonymized_at", null)
    .select()
    .maybeSingle();

  if (failed("updateCustomer", error) || !data) {
    return { ok: false, error: CUSTOMER_INVALID };
  }
  return { ok: true, customer: data as Customer };
}

/**
 * GDPR erasure: clears the personal columns and stamps `anonymized_at`, but
 * keeps the row so past bookings and the salon's numbers stay correct.
 */
export async function anonymizeCustomer(
  salonId: Uuid,
  customerId: Uuid,
): Promise<SaveCustomerResult> {
  const supabase = await supabaseServer();
  const current = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .eq("salon_id", salonId)
    .maybeSingle();
  if (failed("anonymizeCustomer/read", current.error) || !current.data) {
    return { ok: false, error: CUSTOMER_INVALID };
  }

  // Erasing twice is not an error, and must not move the date.
  const customer = current.data as Customer;
  if (customer.anonymized_at) return { ok: true, customer };

  const { data, error } = await supabase
    .from("customers")
    .update({
      first_name: "Izbrisana stranka",
      last_name: null,
      phone: null,
      email: null,
      notes: null,
      marketing_consent: false,
      anonymized_at: new Date().toISOString(),
    })
    .eq("id", customerId)
    .eq("salon_id", salonId)
    .select()
    .maybeSingle();

  if (failed("anonymizeCustomer", error) || !data) {
    return { ok: false, error: CUSTOMER_INVALID };
  }
  return { ok: true, customer: data as Customer };
}

// ---------- auth (PLACEHOLDER) ----------

/**
 * Signs a salon owner in with Supabase Auth.
 *
 * On success the session cookie is written by the server client, proxy.ts keeps
 * it fresh, and lib/auth.ts turns the user id into a staff row of this salon.
 *
 * A wrong e-mail and a wrong password give the SAME message on purpose: telling
 * them apart would let anyone check which addresses have an account here.
 */
export async function signIn(input: SignInInput): Promise<SignInResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Prijava še ni na voljo: baza ni nastavljena." };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error || !data.user) {
    return { ok: false, error: "Napačen e-naslov ali geslo." };
  }
  return { ok: true, user_id: data.user.id };
}
