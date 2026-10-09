/**
 * The ONLY file through which the app reads or writes data. Supabase.
 *
 * Two clients, both server only:
 * - publicDb() (publishable key, role anon, no session): public data of open
 *   salons. RLS and column privileges (003_rls.sql) decide what it sees, so a
 *   bug in a public query cannot reach customers or bookings.
 * - adminDb() (secret key, role service_role, bypasses RLS): admin screens,
 *   the busy times behind free slots, and creating bookings. EVERY query
 *   through it filters by salon_id itself.
 *
 * Which client a shared function uses:
 *   getSalon                      admin  (a suspended salon must still be found
 *                                         to show "booking unavailable")
 *   getServices / getStaff        public, or admin with includeInactive
 *   getFreeSlots                  public for hours and absences, admin only for
 *                                 busy times (start, end, buffer; no customer data)
 *   everything else               admin
 *
 * Until login exists (week 7) the admin screens are only reachable on a
 * developer's machine, see lib/admin-access.ts. Every admin-only function
 * below checks that itself (adminOnly), because a page layout's check can be
 * skipped by Next.js on partial renders. Week 7 puts the login check there.
 *
 * Errors: a failed query is logged (code and message, never row values) and
 * thrown; error.tsx files show a friendly sentence. createBooking instead
 * returns a friendly sentence, so the visitor keeps what they typed.
 */
import "server-only";
import { cache } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import { addDays, addMinutes, format, getDay, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { adminAccessAllowed } from "./admin-access";
import { localDay } from "./format";
import { isE164, phoneSearchDigits } from "./phone";
import { prostiTermini, type Interval } from "./slots";
import { adminDb } from "./supabase/admin";
import { publicDb } from "./supabase/public";
import type {
  Booking,
  CreateBookingResult,
  Customer,
  CustomerSummary,
  FreeSlot,
  FreeSlotsQuery,
  NewBooking,
  Salon,
  SaveServiceResult,
  Service,
  ServiceInput,
  Staff,
  StaffHours,
  StaffService,
  TimeOff,
  Uuid,
} from "./types";

// ---------- helpers ----------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Same as SLUG_PATTERN in proxy.ts and the salons_slug_format check. */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Logs a failed query (code and message only: no customer data in logs) and throws. */
function fail(context: string, error: Pick<PostgrestError, "code" | "message">): never {
  console.error(`[data] ${context} failed: ${error.code ?? "?"} ${error.message ?? ""}`);
  throw new Error(`Database query failed: ${context}`);
}

/**
 * Admin-only data: customers, bookings, absences with reasons, writes. Refuses
 * when admin access is not allowed (lib/admin-access.ts; week 7: the login).
 */
function adminOnly(context: string): void {
  if (!adminAccessAllowed()) {
    console.error(`[data] ${context} refused: no admin access`);
    throw new Error(`No admin access: ${context}`);
  }
}

type QueryResult<T> = { data: T | null; error: PostgrestError | null };

/** The data of a query that must succeed. */
async function must<T>(context: string, query: PromiseLike<QueryResult<T>>): Promise<T> {
  const { data, error } = await query;
  if (error) fail(context, error);
  return data as T;
}

const PAGE_SIZE = 1000;

/**
 * Every row, page by page. Supabase returns at most 1000 rows per request
 * (less if the project setting is lower), and silently cutting off a list
 * would give wrong analytics. `page` must order by a unique column last, so
 * pages do not overlap. Stops at the first empty page, which also works if
 * the server's limit is smaller than PAGE_SIZE.
 */
async function selectAll<T>(
  context: string,
  page: (from: number, to: number) => PromiseLike<QueryResult<T[]>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const data = await must(context, page(rows.length, rows.length + PAGE_SIZE - 1));
    if (!data || data.length === 0) return rows;
    rows.push(...data);
  }
}

// Columns anon may read (003_rls.sql). `select *` on these tables is refused.
const STAFF_PUBLIC_COLUMNS = "id, salon_id, name, color, is_active, sort_order";
const TIME_OFF_PUBLIC_COLUMNS = "id, salon_id, staff_id, starts_at, ends_at";

type PublicStaffRow = Pick<Staff, "id" | "salon_id" | "name" | "color" | "is_active" | "sort_order">;

/** Public pages do not get staff contact data; the type keeps the fields, as null. */
function toPublicStaff(row: PublicStaffRow): Staff {
  return { ...row, user_id: null, email: null, phone: null };
}

// ---------- reads ----------

export async function getSalon(slug: string): Promise<Salon | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  return must("getSalon", adminDb().from("salons").select("*").eq("slug", slug).maybeSingle<Salon>());
}

/** Active services only, unless `includeInactive` (admin screens). */
export async function getServices(
  salonId: Uuid,
  options: { includeInactive?: boolean } = {},
): Promise<Service[]> {
  if (!isUuid(salonId)) return [];
  if (options.includeInactive) {
    return selectAll("getServices", (from, to) =>
      adminDb()
        .from("services")
        .select("*")
        .eq("salon_id", salonId)
        .order("sort_order")
        .order("id")
        .range(from, to)
        .returns<Service[]>(),
    );
  }
  return selectAll("getServices(public)", (from, to) =>
    publicDb()
      .from("services")
      .select("*")
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .order("sort_order")
      .order("id")
      .range(from, to)
      .returns<Service[]>(),
  );
}

/**
 * Active staff only, unless `includeInactive` (admin screens).
 * With `serviceId`: only staff who perform that service (staff_services).
 * Without `includeInactive` (public pages) email, phone and user_id are null.
 */
export async function getStaff(
  salonId: Uuid,
  options: { includeInactive?: boolean; serviceId?: Uuid } = {},
): Promise<Staff[]> {
  if (!isUuid(salonId)) return [];
  if (options.serviceId !== undefined && !isUuid(options.serviceId)) return [];
  const db = options.includeInactive ? adminDb() : publicDb();

  let performerIds: string[] | null = null;
  if (options.serviceId !== undefined) {
    const links = await must(
      "getStaff(staff_services)",
      db
        .from("staff_services")
        .select("staff_id")
        .eq("salon_id", salonId)
        .eq("service_id", options.serviceId)
        .returns<{ staff_id: string }[]>(),
    );
    performerIds = links.map((l) => l.staff_id);
    if (performerIds.length === 0) return [];
  }

  if (options.includeInactive) {
    const rows = await selectAll("getStaff", (from, to) => {
      let query = db.from("staff").select("*").eq("salon_id", salonId);
      if (performerIds) query = query.in("id", performerIds);
      return query.order("sort_order").order("id").range(from, to).returns<Staff[]>();
    });
    return rows;
  }

  const rows = await selectAll("getStaff(public)", (from, to) => {
    let query = db.from("staff").select(STAFF_PUBLIC_COLUMNS).eq("salon_id", salonId).eq("is_active", true);
    if (performerIds) query = query.in("id", performerIds);
    return query.order("sort_order").order("id").range(from, to).returns<PublicStaffRow[]>();
  });
  return rows.map(toPublicStaff);
}

/**
 * Bookings of a salon that start in [from, to), oldest first, all statuses.
 * Admin only: `bookings` has no policy for anon.
 */
export async function getBookings(salonId: Uuid, from: Date, to: Date): Promise<Booking[]> {
  adminOnly("getBookings");
  if (!isUuid(salonId)) return [];
  return selectAll("getBookings", (first, last) =>
    adminDb()
      .from("bookings")
      .select("*")
      .eq("salon_id", salonId)
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at")
      .order("id")
      .range(first, last)
      .returns<Booking[]>(),
  );
}

/**
 * Finds a booking by its cancel_token (compared in full, never by id).
 * The caller must still check that booking.salon_id is the current salon.
 */
export async function getBookingByCancelToken(token: string): Promise<Booking | null> {
  if (!isUuid(token)) return null;
  return must(
    "getBookingByCancelToken",
    adminDb().from("bookings").select("*").eq("cancel_token", token).maybeSingle<Booking>(),
  );
}

// ---------- admin reads ----------

export async function getStaffHours(salonId: Uuid): Promise<StaffHours[]> {
  adminOnly("getStaffHours");
  if (!isUuid(salonId)) return [];
  return selectAll("getStaffHours", (from, to) =>
    adminDb()
      .from("staff_hours")
      .select("*")
      .eq("salon_id", salonId)
      .order("staff_id")
      .order("weekday")
      .order("start_time")
      .order("id")
      .range(from, to)
      .returns<StaffHours[]>(),
  );
}

export async function getStaffServices(salonId: Uuid): Promise<StaffService[]> {
  adminOnly("getStaffServices");
  if (!isUuid(salonId)) return [];
  return selectAll("getStaffServices", (from, to) =>
    adminDb()
      .from("staff_services")
      .select("*")
      .eq("salon_id", salonId)
      .order("staff_id")
      .order("service_id")
      .range(from, to)
      .returns<StaffService[]>(),
  );
}

/** Time off that overlaps [from, to). staff_id null means the whole salon. */
export async function getTimeOff(salonId: Uuid, from: Date, to: Date): Promise<TimeOff[]> {
  adminOnly("getTimeOff");
  if (!isUuid(salonId)) return [];
  return selectAll("getTimeOff", (first, last) =>
    adminDb()
      .from("time_off")
      .select("*")
      .eq("salon_id", salonId)
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString())
      .order("starts_at")
      .order("id")
      .range(first, last)
      .returns<TimeOff[]>(),
  );
}

/** One booking of this salon by id (admin only; visitors use the cancel_token). */
export async function getBooking(salonId: Uuid, bookingId: Uuid): Promise<Booking | null> {
  adminOnly("getBooking");
  if (!isUuid(salonId) || !isUuid(bookingId)) return null;
  return must(
    "getBooking",
    adminDb().from("bookings").select("*").eq("salon_id", salonId).eq("id", bookingId).maybeSingle<Booking>(),
  );
}

export async function getCustomer(salonId: Uuid, customerId: Uuid): Promise<Customer | null> {
  adminOnly("getCustomer");
  if (!isUuid(salonId) || !isUuid(customerId)) return null;
  return must(
    "getCustomer",
    adminDb().from("customers").select("*").eq("salon_id", salonId).eq("id", customerId).maybeSingle<Customer>(),
  );
}

/** Only the customers with these ids (e.g. the ones in the calendar view). */
export async function getCustomersByIds(salonId: Uuid, customerIds: Uuid[]): Promise<Customer[]> {
  adminOnly("getCustomersByIds");
  const ids = [...new Set(customerIds.filter(isUuid))];
  if (!isUuid(salonId) || ids.length === 0) return [];
  const rows: Customer[] = [];
  // In chunks, so the request URL stays short however many bookings are shown.
  for (let i = 0; i < ids.length; i += 100) {
    rows.push(
      ...(await must(
        "getCustomersByIds",
        adminDb()
          .from("customers")
          .select("*")
          .eq("salon_id", salonId)
          .in("id", ids.slice(i, i + 100))
          .returns<Customer[]>(),
      )),
    );
  }
  return rows;
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
  adminOnly("getCustomers");
  if (!isUuid(salonId)) return [];
  const query = fold(options.query?.trim() ?? "");
  const phoneQueries = phoneSearchDigits(query);
  const now = new Date();

  const [customers, bookings] = await Promise.all([
    selectAll("getCustomers", (from, to) =>
      adminDb()
        .from("customers")
        .select("*")
        .eq("salon_id", salonId)
        .order("id")
        .range(from, to)
        .returns<Customer[]>(),
    ),
    selectAll("getCustomers(bookings)", (from, to) =>
      adminDb()
        .from("bookings")
        .select("id, customer_id, starts_at, status")
        .eq("salon_id", salonId)
        .neq("status", "cancelled")
        .order("id")
        .range(from, to)
        .returns<Pick<Booking, "id" | "customer_id" | "starts_at" | "status">[]>(),
    ),
  ]);

  const matches = (c: Customer): boolean => {
    if (!query) return true;
    const name = fold(`${c.first_name} ${c.last_name ?? ""}`);
    if (name.includes(query) || fold(c.email ?? "").includes(query)) return true;
    const phoneDigits = (c.phone ?? "").replace(/\D/g, "");
    return phoneQueries.some((digits) => phoneDigits.includes(digits));
  };

  const byCustomer = new Map<string, typeof bookings>();
  for (const booking of bookings) {
    const list = byCustomer.get(booking.customer_id) ?? [];
    list.push(booking);
    byCustomer.set(booking.customer_id, list);
  }

  return customers
    .filter(matches)
    .map((customer) => {
      const own = byCustomer.get(customer.id) ?? [];
      const past = own.filter((b) => parseISO(b.starts_at) <= now);
      const upcoming = own.filter(
        (b) => parseISO(b.starts_at) > now && (b.status === "pending" || b.status === "confirmed"),
      );
      const latest = past.reduce<string | null>(
        (best, b) => (best === null || Date.parse(b.starts_at) > Date.parse(best) ? b.starts_at : best),
        null,
      );
      const soonest = upcoming.reduce<string | null>(
        (best, b) => (best === null || Date.parse(b.starts_at) < Date.parse(best) ? b.starts_at : best),
        null,
      );
      return { customer, bookings_count: own.length, last_visit_at: latest, next_visit_at: soonest };
    })
    .sort((a, b) =>
      `${a.customer.last_name ?? ""} ${a.customer.first_name}`.localeCompare(
        `${b.customer.last_name ?? ""} ${b.customer.first_name}`,
        "sl",
      ),
    );
}

/** All bookings of one customer, newest first, all statuses. */
export async function getCustomerBookings(salonId: Uuid, customerId: Uuid): Promise<Booking[]> {
  adminOnly("getCustomerBookings");
  if (!isUuid(salonId) || !isUuid(customerId)) return [];
  return selectAll("getCustomerBookings", (from, to) =>
    adminDb()
      .from("bookings")
      .select("*")
      .eq("salon_id", salonId)
      .eq("customer_id", customerId)
      .order("starts_at", { ascending: false })
      .order("id")
      .range(from, to)
      .returns<Booking[]>(),
  );
}

// ---------- admin writes: services ----------

/** Same limits as the database (services checks in 001 and 002). */
function validService(input: ServiceInput): boolean {
  return (
    input.name.trim().length > 0 &&
    input.name.trim().length <= 80 &&
    (input.category?.trim().length ?? 0) <= 40 &&
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
const SERVICE_FAILED = "Storitve trenutno ni mogoče shraniti. Poskusite znova čez nekaj minut.";

function serviceColumns(input: ServiceInput) {
  return {
    name: input.name.trim(),
    category: input.category?.trim() || null,
    duration_min: input.duration_min,
    buffer_after_min: input.buffer_after_min,
    price_cents: input.price_cents,
    is_active: input.is_active,
  };
}

export async function createService(salonId: Uuid, input: ServiceInput): Promise<SaveServiceResult> {
  adminOnly("createService");
  if (!isUuid(salonId) || !validService(input)) return { ok: false, error: SERVICE_INVALID };
  const db = adminDb();

  const last = await db
    .from("services")
    .select("sort_order")
    .eq("salon_id", salonId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  if (last.error) {
    console.error(`[data] createService(sort_order) failed: ${last.error.code} ${last.error.message}`);
    return { ok: false, error: SERVICE_FAILED };
  }

  const { data, error } = await db
    .from("services")
    .insert({ salon_id: salonId, sort_order: (last.data?.sort_order ?? 0) + 1, ...serviceColumns(input) })
    .select("*")
    .single<Service>();
  if (error) {
    console.error(`[data] createService failed: ${error.code} ${error.message}`);
    return { ok: false, error: error.code === "23514" ? SERVICE_INVALID : SERVICE_FAILED };
  }
  return { ok: true, service: data };
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
  adminOnly("updateService");
  if (!isUuid(salonId) || !isUuid(serviceId) || !validService(input)) {
    return { ok: false, error: SERVICE_INVALID };
  }
  const { data, error } = await adminDb()
    .from("services")
    .update(serviceColumns(input))
    .eq("salon_id", salonId)
    .eq("id", serviceId)
    .select("*")
    .maybeSingle<Service>();
  if (error) {
    console.error(`[data] updateService failed: ${error.code} ${error.message}`);
    return { ok: false, error: error.code === "23514" ? SERVICE_INVALID : SERVICE_FAILED };
  }
  if (!data) return { ok: false, error: SERVICE_INVALID }; // not a service of this salon
  return { ok: true, service: data };
}

// ---------- free slots ----------

interface SlotData {
  timezone: string;
  slotIntervalMin: number;
  minLeadTimeMin: number;
  maxDaysAhead: number;
  durationMin: number;
  bufferMin: number;
  /** Active staff who perform the service, in display order. */
  staffIds: string[];
  hours: Pick<StaffHours, "staff_id" | "weekday" | "start_time" | "end_time">[];
  timeOff: Pick<TimeOff, "staff_id" | "starts_at" | "ends_at">[];
  /** Pending and confirmed bookings, buffer included. */
  busy: { staff_id: string; od: Date; do: Date }[];
}

/**
 * Everything the slot engine needs for one service in one month, in a handful
 * of queries. Cached per request (React cache), so the calendar's 30 days cost
 * one load, not 30.
 *
 * Everything public comes through the anon client, so RLS applies: a suspended
 * salon, an inactive service or staff member gives no data and no slots. Only
 * the busy times need the secret key, and only start, end, buffer and staff.
 */
const loadSlotData = cache(async (salonId: string, serviceId: string, month: string): Promise<SlotData | null> => {
  const db = publicDb();

  const salon = await must(
    "getFreeSlots(salon)",
    db
      .from("salons")
      .select("timezone, slot_interval_min, min_lead_time_min, max_days_ahead")
      .eq("id", salonId)
      .maybeSingle<Pick<Salon, "timezone" | "slot_interval_min" | "min_lead_time_min" | "max_days_ahead">>(),
  );
  if (!salon) return null;

  const service = await must(
    "getFreeSlots(service)",
    db
      .from("services")
      .select("duration_min, buffer_after_min")
      .eq("id", serviceId)
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .maybeSingle<Pick<Service, "duration_min" | "buffer_after_min">>(),
  );
  if (!service) return null;

  const links = await must(
    "getFreeSlots(staff_services)",
    db
      .from("staff_services")
      .select("staff_id")
      .eq("salon_id", salonId)
      .eq("service_id", serviceId)
      .returns<{ staff_id: string }[]>(),
  );
  const performerIds = links.map((l) => l.staff_id);
  if (performerIds.length === 0) return null;

  const staff = await must(
    "getFreeSlots(staff)",
    db
      .from("staff")
      .select("id, sort_order")
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .in("id", performerIds)
      .order("sort_order")
      .order("id")
      .returns<{ id: string; sort_order: number }[]>(),
  );
  const staffIds = staff.map((s) => s.id);
  if (staffIds.length === 0) return null;

  // The month in the salon's time zone, as instants.
  const rangeStart = fromZonedTime(`${month}-01T00:00:00`, salon.timezone);
  const nextMonth = format(addDays(parseISO(`${month}-28`), 7), "yyyy-MM");
  const rangeEnd = fromZonedTime(`${nextMonth}-01T00:00:00`, salon.timezone);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    console.error(`[data] getFreeSlots: cannot build the month ${month} in ${salon.timezone}`);
    return null;
  }

  const [hours, timeOff, bookings] = await Promise.all([
    must(
      "getFreeSlots(staff_hours)",
      db
        .from("staff_hours")
        .select("staff_id, weekday, start_time, end_time")
        .eq("salon_id", salonId)
        .in("staff_id", staffIds)
        .returns<SlotData["hours"]>(),
    ),
    selectAll("getFreeSlots(time_off)", (from, to) =>
      db
        .from("time_off")
        .select(TIME_OFF_PUBLIC_COLUMNS)
        .eq("salon_id", salonId)
        .lt("starts_at", rangeEnd.toISOString())
        .gt("ends_at", rangeStart.toISOString())
        .order("id")
        .range(from, to)
        .returns<Pick<TimeOff, "id" | "staff_id" | "starts_at" | "ends_at">[]>(),
    ),
    // Busy times: the generated `period` column already includes the buffer.
    selectAll("getFreeSlots(bookings)", (from, to) =>
      adminDb()
        .from("bookings")
        .select("id, staff_id, starts_at, ends_at, buffer_min")
        .eq("salon_id", salonId)
        .in("staff_id", staffIds)
        .in("status", ["pending", "confirmed"])
        .overlaps("period", `[${rangeStart.toISOString()},${rangeEnd.toISOString()})`)
        .order("id")
        .range(from, to)
        .returns<Pick<Booking, "id" | "staff_id" | "starts_at" | "ends_at" | "buffer_min">[]>(),
    ),
  ]);

  return {
    timezone: salon.timezone,
    slotIntervalMin: salon.slot_interval_min,
    minLeadTimeMin: salon.min_lead_time_min,
    maxDaysAhead: salon.max_days_ahead,
    durationMin: service.duration_min,
    bufferMin: service.buffer_after_min,
    staffIds,
    hours,
    timeOff,
    busy: bookings.map((b) => ({
      staff_id: b.staff_id,
      od: parseISO(b.starts_at),
      do: addMinutes(parseISO(b.ends_at), b.buffer_min),
    })),
  };
});

function overlapsRange(od: Date, to: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return od.getTime() < rangeEnd.getTime() && to.getTime() > rangeStart.getTime();
}

/**
 * Postgres `time` allows "24:00:00" (end of day); the engine accepts 00:00-23:59.
 * The last second of the day is the same window for any real booking.
 */
function engineTime(time: string): string {
  return time.startsWith("24:") ? "23:59:59" : time;
}

/** Runs lib/slots.ts for every candidate staff member on one local day. */
function slotsForDay(data: SlotData, staffId: string | null, day: string, now: Date): FreeSlot[] {
  // Never in the past, never beyond the salon's booking window (salons.max_days_ahead).
  const today = localDay(now, data.timezone);
  const lastDay = format(addDays(parseISO(today), data.maxDaysAhead), "yyyy-MM-dd");
  if (day < today || day > lastDay) return [];

  const candidates = staffId === null ? data.staffIds : data.staffIds.filter((id) => id === staffId);
  const weekday = getDay(parseISO(day));
  const dayStart = fromZonedTime(`${day}T00:00:00`, data.timezone);
  const dayEnd = fromZonedTime(`${format(addDays(parseISO(day), 1), "yyyy-MM-dd")}T00:00:00`, data.timezone);

  const slots: FreeSlot[] = [];
  for (const member of candidates) {
    const odsotnosti: Interval[] = data.timeOff
      .filter((t) => t.staff_id === null || t.staff_id === member)
      .map((t) => ({ od: parseISO(t.starts_at), do: parseISO(t.ends_at) }))
      .filter((t) => overlapsRange(t.od, t.do, dayStart, dayEnd));
    const zasedeno: Interval[] = data.busy
      .filter((b) => b.staff_id === member && overlapsRange(b.od, b.do, dayStart, dayEnd))
      .map((b) => ({ od: b.od, do: b.do }));

    let free: Interval[];
    try {
      free = prostiTermini({
        dan: day,
        casovniPas: data.timezone,
        trajanjeMin: data.durationMin,
        cistilniCasMin: data.bufferMin,
        korakMin: data.slotIntervalMin,
        najkrajsaNajavaMin: data.minLeadTimeMin,
        zdaj: now,
        urniki: data.hours
          .filter((h) => h.staff_id === member && h.weekday === weekday)
          .map((h) => ({ start: engineTime(h.start_time), end: engineTime(h.end_time) })),
        odsotnosti,
        zasedeno,
      });
    } catch (error) {
      // One staff member's bad settings must not take down the whole booking
      // page: that person offers no times, the others still do.
      console.error(`[data] slots for staff ${member} on ${day} skipped: ${(error as Error).message}`);
      continue;
    }
    for (const slot of free) {
      slots.push({ staff_id: member, starts_at: slot.od.toISOString(), ends_at: slot.do.toISOString() });
    }
  }

  // By time; at the same time keep the staff display order (stable sort).
  return slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/**
 * Bookable start times for one service on one local day ("YYYY-MM-DD" in the
 * salon's time zone). staff_id null = anyone who performs the service. The
 * engine is lib/slots.ts; this function only loads its inputs.
 */
export async function getFreeSlots(query: FreeSlotsQuery): Promise<FreeSlot[]> {
  if (
    !isUuid(query.salon_id) ||
    !isUuid(query.service_id) ||
    (query.staff_id !== null && !isUuid(query.staff_id)) ||
    !isDay(query.day)
  ) {
    return [];
  }
  // Cheap first check without any query: no salon books in the past or more
  // than 365 days ahead (salons_booking_settings). The exact window per salon
  // is checked in slotsForDay.
  const now = new Date();
  const utcToday = now.toISOString().slice(0, 10);
  if (query.day < format(addDays(parseISO(utcToday), -1), "yyyy-MM-dd")) return [];
  if (query.day > format(addDays(parseISO(utcToday), 367), "yyyy-MM-dd")) return [];

  const data = await loadSlotData(query.salon_id, query.service_id, query.day.slice(0, 7));
  if (!data) return [];
  return slotsForDay(data, query.staff_id, query.day, now);
}

// ---------- writes: bookings ----------

/** Friendly sentences createBooking returns; the server action compares against them. */
export const BOOKING_MESSAGES = {
  invalid: "Izbrane storitve ali zaposlenega ni mogoče rezervirati. Poskusite znova.",
  taken: "Ta termin je bil pravkar zaseden. Izberite drug.",
  unavailable: "Ta termin ni več na voljo. Izberite drug.",
  failed: "Rezervacije trenutno ni mogoče shraniti. Poskusite znova čez nekaj minut.",
} as const;
const MESSAGES = BOOKING_MESSAGES;

const BOOKABLE_STATUSES: Salon["subscription_status"][] = ["trial", "active"];

/** Basic limits, also checked by the server action (Zod); here as a second line. */
function sensibleInput(input: NewBooking): boolean {
  const lengthOk = (value: string | null | undefined, max: number) => (value ?? "").length <= max;
  return (
    input.first_name.trim().length > 0 &&
    lengthOk(input.first_name, 60) &&
    lengthOk(input.last_name, 60) &&
    lengthOk(input.email, 254) &&
    lengthOk(input.customer_note, 500) &&
    lengthOk(input.source, 20) &&
    isE164(input.phone) // the database has the same check (customers_phone_e164)
  );
}

/**
 * The customer with this phone number in this salon, or a new one. An existing
 * customer is NOT changed from the public form: otherwise anyone who knows a
 * phone number could overwrite that person's name or e-mail.
 */
async function findOrCreateCustomer(
  salonId: string,
  input: NewBooking,
): Promise<{ id: string; created: boolean }> {
  const db = adminDb();
  const find = () =>
    must(
      "createBooking(find customer)",
      db
        .from("customers")
        .select("id")
        .eq("salon_id", salonId)
        .eq("phone", input.phone)
        .maybeSingle<{ id: string }>(),
    );

  const existing = await find();
  if (existing) return { id: existing.id, created: false };

  const { data, error } = await db
    .from("customers")
    .insert({
      salon_id: salonId,
      first_name: input.first_name.trim(),
      last_name: input.last_name?.trim() || null,
      phone: input.phone,
      email: input.email.trim(),
      marketing_consent: input.marketing_consent,
    })
    .select("id")
    .single<{ id: string }>();
  if (!error) return { id: data.id, created: true };

  // Someone booked with the same new number at the same moment: use theirs.
  if (error.code === "23505") {
    const again = await find();
    if (again) return { id: again.id, created: false };
  }
  fail("createBooking(create customer)", error);
}

/**
 * Creates a booking (and the customer, if the phone number is new). Called
 * only from a server action. CLAUDE.md and specs/security.md:
 * - salon, service and staff must belong together, the staff member must
 *   perform the service, and the salon must be open for booking
 * - price, end time, buffer and status come from the database, never from input
 * - the time is checked against the free slots again (hours, absences, notice,
 *   booking window), and the exclusion constraint decides between two
 *   simultaneous requests: the loser gets error 23P01 -> "just taken"
 */
export async function createBooking(input: NewBooking): Promise<CreateBookingResult> {
  const start = new Date(input.starts_at);
  if (
    !isUuid(input.salon_id) ||
    !isUuid(input.service_id) ||
    !isUuid(input.staff_id) ||
    Number.isNaN(start.getTime()) ||
    !sensibleInput(input)
  ) {
    return { ok: false, error: MESSAGES.invalid };
  }

  try {
    const db = adminDb();
    const [salon, service, member, link] = await Promise.all([
      must(
        "createBooking(salon)",
        db
          .from("salons")
          .select("id, timezone, require_confirmation, subscription_status")
          .eq("id", input.salon_id)
          .maybeSingle<Pick<Salon, "id" | "timezone" | "require_confirmation" | "subscription_status">>(),
      ),
      must(
        "createBooking(service)",
        db
          .from("services")
          .select("id, duration_min, buffer_after_min, price_cents")
          .eq("id", input.service_id)
          .eq("salon_id", input.salon_id)
          .eq("is_active", true)
          .maybeSingle<Pick<Service, "id" | "duration_min" | "buffer_after_min" | "price_cents">>(),
      ),
      must(
        "createBooking(staff)",
        db
          .from("staff")
          .select("id")
          .eq("id", input.staff_id)
          .eq("salon_id", input.salon_id)
          .eq("is_active", true)
          .maybeSingle<{ id: string }>(),
      ),
      must(
        "createBooking(staff_services)",
        db
          .from("staff_services")
          .select("staff_id")
          .eq("salon_id", input.salon_id)
          .eq("staff_id", input.staff_id)
          .eq("service_id", input.service_id)
          .maybeSingle<{ staff_id: string }>(),
      ),
    ]);
    if (!salon || !BOOKABLE_STATUSES.includes(salon.subscription_status) || !service || !member || !link) {
      return { ok: false, error: MESSAGES.invalid };
    }

    const free = await getFreeSlots({
      salon_id: salon.id,
      service_id: service.id,
      staff_id: member.id,
      day: localDay(start, salon.timezone),
    });
    if (!free.some((slot) => Date.parse(slot.starts_at) === start.getTime())) {
      return { ok: false, error: MESSAGES.unavailable };
    }

    const insertBooking = (customerId: string) =>
      db
        .from("bookings")
        .insert({
          salon_id: salon.id,
          staff_id: member.id,
          service_id: service.id,
          customer_id: customerId,
          starts_at: start.toISOString(),
          ends_at: addMinutes(start, service.duration_min).toISOString(),
          buffer_min: service.buffer_after_min,
          status: salon.require_confirmation ? "pending" : "confirmed",
          price_cents: service.price_cents,
          customer_note: input.customer_note?.trim() || null,
          source: input.source ?? "online",
        })
        .select("*")
        .single<Booking>();

    let customer = await findOrCreateCustomer(salon.id, input);
    let { data, error } = await insertBooking(customer.id);

    // Rare race: the customer we found was created a moment ago by another
    // request whose booking failed, and that request removed it again
    // (23503 = the customer row is gone). Look up or create it once more.
    if (error?.code === "23503" && !customer.created) {
      customer = await findOrCreateCustomer(salon.id, input);
      ({ data, error } = await insertBooking(customer.id));
    }

    if (!error && data) return { ok: true, booking: data };
    if (!error) return { ok: false, error: MESSAGES.failed }; // no row back: should not happen

    // The booking failed: do not leave behind a customer created just for it.
    if (customer.created) {
      const cleanup = await db.from("customers").delete().eq("id", customer.id).eq("salon_id", salon.id);
      if (cleanup.error) {
        console.error(`[data] createBooking(cleanup) failed: ${cleanup.error.code} ${cleanup.error.message}`);
      }
    }
    if (error.code === "23P01") return { ok: false, error: MESSAGES.taken }; // exclusion_violation
    console.error(`[data] createBooking(insert) failed: ${error.code} ${error.message}`);
    if (error.code === "23503" || error.code === "23514") return { ok: false, error: MESSAGES.invalid };
    return { ok: false, error: MESSAGES.failed };
  } catch {
    // Already logged by fail(); the visitor gets a friendly sentence and keeps the form.
    return { ok: false, error: MESSAGES.failed };
  }
}
