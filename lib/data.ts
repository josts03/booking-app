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
 * Admin-only functions check themselves (adminOnly) that the signed-in user is
 * in salon_users for exactly the salon they are asked about, because a page
 * layout's check can be skipped by Next.js on partial renders, and a server
 * action can be called without its page. Pages and actions also check first
 * (lib/admin-access.ts), so the user gets a friendly page instead of an error.
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
import { getSignedInUser, type SignedInUser } from "./auth";
import { canChangeStatus, MOVABLE } from "./booking-status";
import { formatTime, localDay } from "./format";
import { isE164, phoneSearchDigits } from "./phone";
import { prostiTermini, type Interval } from "./slots";
import { adminDb } from "./supabase/admin";
import { workingHoursProblem } from "./working-hours";
import { publicDb } from "./supabase/public";
import type { BookingEmailData } from "./email";
import type {
  AdminBookingResult,
  AffectedBooking,
  Booking,
  BookingMove,
  BookingStatus,
  CancelBookingResult,
  CreateBookingResult,
  Customer,
  CustomerSummary,
  FreeSlot,
  FreeSlotsQuery,
  ManageResult,
  ManualBookingInput,
  NewBooking,
  NotificationKind,
  Salon,
  SalonSettingsInput,
  SaveServiceResult,
  Service,
  ServiceInput,
  Staff,
  StaffHours,
  StaffInput,
  StaffService,
  TimeOff,
  Timestamptz,
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

export type SalonRole = "owner" | "staff";

/**
 * The role of a user in a salon (salon_users), or null if they are not a
 * member. This IS the access check, so it needs no access itself. Cached per
 * request: a page with many queries asks the database once.
 */
export const getSalonRole = cache(async (salonId: Uuid, userId: Uuid): Promise<SalonRole | null> => {
  if (!isUuid(salonId) || !isUuid(userId)) return null;
  const row = await must(
    "getSalonRole",
    adminDb()
      .from("salon_users")
      .select("role")
      .eq("salon_id", salonId)
      .eq("user_id", userId)
      .maybeSingle<{ role: SalonRole }>(),
  );
  return row?.role ?? null;
});

/**
 * Admin-only data: customers, bookings, absences with reasons, writes. Refuses
 * unless the signed-in user is a member of `salonId`, so even a caller that
 * passes another salon's id gets nothing.
 */
async function adminOnly(salonId: Uuid, context: string): Promise<SignedInUser> {
  const user = await getSignedInUser();
  if (user && (await getSalonRole(salonId, user.id))) return user;
  console.error(`[data] ${context} refused: no admin access`);
  throw new Error(`No admin access: ${context}`);
}

/**
 * Owner-only changes: staff, working hours, absences, services and the salon's
 * settings (decision of 22. 10. 2026). Staff members manage bookings only.
 */
async function ownerOnly(salonId: Uuid, context: string): Promise<SignedInUser> {
  const user = await getSignedInUser();
  if (user && (await getSalonRole(salonId, user.id)) === "owner") return user;
  console.error(`[data] ${context} refused: not the salon's owner`);
  throw new Error(`No owner access: ${context}`);
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
  await adminOnly(salonId, "getBookings");
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
  await adminOnly(salonId, "getStaffHours");
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
  await adminOnly(salonId, "getStaffServices");
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
  await adminOnly(salonId, "getTimeOff");
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
  await adminOnly(salonId, "getBooking");
  if (!isUuid(salonId) || !isUuid(bookingId)) return null;
  return must(
    "getBooking",
    adminDb().from("bookings").select("*").eq("salon_id", salonId).eq("id", bookingId).maybeSingle<Booking>(),
  );
}

export async function getCustomer(salonId: Uuid, customerId: Uuid): Promise<Customer | null> {
  await adminOnly(salonId, "getCustomer");
  if (!isUuid(salonId) || !isUuid(customerId)) return null;
  return must(
    "getCustomer",
    adminDb().from("customers").select("*").eq("salon_id", salonId).eq("id", customerId).maybeSingle<Customer>(),
  );
}

/** Only the customers with these ids (e.g. the ones in the calendar view). */
export async function getCustomersByIds(salonId: Uuid, customerIds: Uuid[]): Promise<Customer[]> {
  await adminOnly(salonId, "getCustomersByIds");
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
  await adminOnly(salonId, "getCustomers");
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
  await adminOnly(salonId, "getCustomerBookings");
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
  await ownerOnly(salonId, "createService");
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
  await ownerOnly(salonId, "updateService");
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

// ---------- notifications (e-mail to customers) ----------

/** What an e-mail about a booking needs (lib/email.ts), plus where it goes. */
export interface NotificationData extends BookingEmailData {
  salonId: Uuid;
  bookingId: Uuid;
  /**
   * Where messages about this booking go: the e-mail given with the booking
   * (bookings.contact_email), else the customer's, else null (no e-mail).
   */
  to: string | null;
}

/**
 * Loads one booking with its salon, service, staff member and customer, for
 * an e-mail. Server only, never for a page: it reads the customer's e-mail.
 * Callers are the booking action (after the booking was created) and the
 * reminders cron (week 11). Separate queries: PostgREST cannot embed these
 * tables unambiguously (they have two foreign keys each, 002_constraints.sql).
 */
export async function getNotificationData(bookingId: Uuid): Promise<NotificationData | null> {
  if (!isUuid(bookingId)) return null;
  const db = adminDb();
  const booking = await must(
    "getNotificationData(booking)",
    db.from("bookings").select("*").eq("id", bookingId).maybeSingle<Booking>(),
  );
  if (!booking) return null;
  const [salon, service, member, customer] = await Promise.all([
    must(
      "getNotificationData(salon)",
      db
        .from("salons")
        .select("name, slug, email, phone, address, timezone, brand_color, cancel_window_hours, confirmation_note")
        .eq("id", booking.salon_id)
        .single<BookingEmailData["salon"]>(),
    ),
    must(
      "getNotificationData(service)",
      db.from("services").select("name").eq("id", booking.service_id).eq("salon_id", booking.salon_id).single<{ name: string }>(),
    ),
    must(
      "getNotificationData(staff)",
      db.from("staff").select("name").eq("id", booking.staff_id).eq("salon_id", booking.salon_id).single<{ name: string }>(),
    ),
    must(
      "getNotificationData(customer)",
      db
        .from("customers")
        .select("first_name, email")
        .eq("id", booking.customer_id)
        .eq("salon_id", booking.salon_id)
        .single<{ first_name: string; email: string | null }>(),
    ),
  ]);
  return {
    salonId: booking.salon_id,
    bookingId: booking.id,
    to: booking.contact_email ?? customer.email,
    salon,
    booking,
    serviceName: service.name,
    staffName: member.name,
    customerFirstName: customer.first_name,
  };
}

/**
 * Reserves the right to send one message: inserts its booking_notifications row
 * with status "pending". The unique (booking_id, kind, channel) lets exactly one
 * caller win, so a message is never sent twice, even by two requests at once.
 * Returns the row id, or null if this message was already claimed.
 */
export async function claimNotification(
  salonId: Uuid,
  bookingId: Uuid,
  kind: NotificationKind,
  channel = "email",
): Promise<Uuid | null> {
  const { data, error } = await adminDb()
    .from("booking_notifications")
    .insert({ salon_id: salonId, booking_id: bookingId, kind, channel, status: "pending" })
    .select("id")
    .single<{ id: Uuid }>();
  if (!error) return data.id;
  if (error.code === "23505") return null; // unique_violation: already claimed or sent
  fail("claimNotification", error);
}

/** Records how sending went: "sent" with the provider's id, or "failed". */
export async function finishNotification(
  notificationId: Uuid,
  status: "sent" | "failed",
  providerId: string | null,
): Promise<void> {
  await must(
    "finishNotification",
    adminDb()
      .from("booking_notifications")
      .update({ status, provider_id: providerId, sent_at: new Date().toISOString() })
      .eq("id", notificationId),
  );
}

// ---------- writes: cancel by link ----------

/**
 * Cancels a booking by its cancel_token, for the salon on this host, if it is
 * pending or confirmed and starts MORE than salons.cancel_window_hours from
 * `now` (lib/cancel.ts, same rule). One conditional UPDATE: two clicks at once,
 * or a click just after the deadline, cannot both pass a check and then write.
 * The window comes from the database, never from the request. A cancelled
 * booking no longer blocks its time (the exclusion constraint ignores it).
 */
export async function cancelBookingByToken(
  salonId: Uuid,
  token: string,
  now: Date = new Date(),
): Promise<CancelBookingResult> {
  if (!isUuid(salonId) || !isUuid(token)) return { ok: false, reason: "not-found" };
  try {
    const db = adminDb();
    const salon = await must(
      "cancelBookingByToken(salon)",
      db.from("salons").select("cancel_window_hours").eq("id", salonId).maybeSingle<Pick<Salon, "cancel_window_hours">>(),
    );
    if (!salon) return { ok: false, reason: "not-found" };

    const lastStart = new Date(now.getTime() + salon.cancel_window_hours * 3_600_000);
    const cancelled = await must(
      "cancelBookingByToken(update)",
      db
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("salon_id", salonId)
        .eq("cancel_token", token)
        .in("status", ["pending", "confirmed"])
        .gt("starts_at", lastStart.toISOString())
        .select("*")
        .maybeSingle<Booking>(),
    );
    if (cancelled) return { ok: true, booking: cancelled };

    // Nothing changed: say why.
    const booking = await must(
      "cancelBookingByToken(read)",
      db
        .from("bookings")
        .select("status")
        .eq("salon_id", salonId)
        .eq("cancel_token", token)
        .maybeSingle<Pick<Booking, "status">>(),
    );
    if (!booking) return { ok: false, reason: "not-found" };
    if (booking.status !== "pending" && booking.status !== "confirmed") return { ok: false, reason: "not-active" };
    return { ok: false, reason: "too-late" };
  } catch {
    return { ok: false, reason: "failed" }; // already logged by fail()
  }
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
  input: Pick<NewBooking, "first_name" | "last_name" | "phone" | "marketing_consent"> & { email: string | null },
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
      email: input.email?.trim() || null,
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
          // Messages about this booking go to the address typed in now, even when
          // the customer (found by phone) has another one on file (005).
          contact_email: input.email.trim(),
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

// ---------- admin: status, bookings entered by hand, moves ----------

/** Friendly sentences for the admin's booking changes. */
export const ADMIN_BOOKING_MESSAGES = {
  notFound: "Termina ni mogoče najti. Osvežite stran.",
  changed: "Termin je bil medtem spremenjen. Osvežite stran.",
  notAllowed: "Tega pri tem terminu ni mogoče narediti.",
  invalid: "Storitve, zaposlenega ali stranke ni mogoče uporabiti. Preverite izbiro.",
  staffService: "Izbrani zaposleni te storitve ne izvaja.",
  sameTime: "Termin je že ob tej uri pri tem zaposlenem.",
  failed: "Sprememb trenutno ni mogoče shraniti. Poskusite znova čez nekaj minut.",
} as const;
const ADMIN_MESSAGES = ADMIN_BOOKING_MESSAGES;

/** Manual bookings may be in the past (entered afterwards), but not absurdly far away. */
const MANUAL_RANGE_DAYS = 2 * 365;

/**
 * Records who did what in audit_log (service_role only, 003_rls.sql). A failed
 * write is logged and does not undo the change: the change itself is what the
 * salon needs.
 */
async function audit(
  salonId: Uuid,
  actor: SignedInUser,
  action: string,
  entityId: Uuid,
  payload: Record<string, unknown>,
  entity = "booking",
): Promise<void> {
  const { error } = await adminDb()
    .from("audit_log")
    .insert({ salon_id: salonId, actor_user_id: actor.id, action, entity, entity_id: entityId, payload });
  if (error) console.error(`[data] audit(${action}) failed: ${error.code} ${error.message}`);
}

/**
 * "Maja ima ob tem času že termin (10:00–10:45)." for an overlap the database
 * refused (23P01). Names the booking in the way, so the salon knows where to look.
 */
async function overlapMessage(
  salonId: Uuid,
  staff: Pick<Staff, "id" | "name">,
  start: Date,
  busyEnd: Date,
  timeZone: string,
  excludeBookingId?: Uuid,
): Promise<string> {
  let query = adminDb()
    .from("bookings")
    .select("starts_at, ends_at")
    .eq("salon_id", salonId)
    .eq("staff_id", staff.id)
    .in("status", ["pending", "confirmed"])
    .filter("period", "ov", `[${start.toISOString()},${busyEnd.toISOString()})`)
    .order("starts_at")
    .limit(1);
  if (excludeBookingId) query = query.neq("id", excludeBookingId);
  const { data } = await query.returns<Pick<Booking, "starts_at" | "ends_at">[]>();
  const other = data?.[0];
  return other
    ? `${staff.name} ima ob tem času že termin (${formatTime(other.starts_at, timeZone)}–${formatTime(other.ends_at, timeZone)}). Izberite drugo uro ali drugega zaposlenega.`
    : `${staff.name} ima ob tem času že drug termin. Izberite drugo uro ali drugega zaposlenega.`;
}

/** Whether [start, busyEnd) fits the staff member's hours and absences (lib/working-hours.ts); null if it does. */
async function hoursWarning(
  salonId: Uuid,
  staff: Pick<Staff, "id" | "name">,
  start: Date,
  busyEnd: Date,
  timeZone: string,
): Promise<string | null> {
  const db = adminDb();
  const [hours, timeOff] = await Promise.all([
    must(
      "hoursWarning(hours)",
      db
        .from("staff_hours")
        .select("staff_id, weekday, start_time, end_time")
        .eq("salon_id", salonId)
        .eq("staff_id", staff.id)
        .returns<Pick<StaffHours, "staff_id" | "weekday" | "start_time" | "end_time">[]>(),
    ),
    must(
      "hoursWarning(time_off)",
      db
        .from("time_off")
        .select("staff_id, starts_at, ends_at")
        .eq("salon_id", salonId)
        .lt("starts_at", busyEnd.toISOString())
        .gt("ends_at", start.toISOString())
        .returns<Pick<TimeOff, "staff_id" | "starts_at" | "ends_at">[]>(),
    ),
  ]);
  const problem = workingHoursProblem({ staffId: staff.id, start, busyEnd, hours, timeOff, timeZone });
  if (problem === "absent") return `${staff.name}: ob tem času je vpisana odsotnost.`;
  if (problem === "not-working") return `${staff.name}: ob tem času ni delovni čas.`;
  return null;
}

/** An active staff member of this salon who performs the service, or null. */
async function performer(salonId: Uuid, staffId: Uuid, serviceId: Uuid): Promise<Pick<Staff, "id" | "name"> | "no-service" | null> {
  const db = adminDb();
  const [member, link] = await Promise.all([
    must(
      "performer(staff)",
      db
        .from("staff")
        .select("id, name")
        .eq("id", staffId)
        .eq("salon_id", salonId)
        .eq("is_active", true)
        .maybeSingle<Pick<Staff, "id" | "name">>(),
    ),
    must(
      "performer(staff_services)",
      db
        .from("staff_services")
        .select("staff_id")
        .eq("salon_id", salonId)
        .eq("staff_id", staffId)
        .eq("service_id", serviceId)
        .maybeSingle<{ staff_id: string }>(),
    ),
  ]);
  if (!member) return null;
  return link ? member : "no-service";
}

/**
 * Moves a booking to another status from the admin (lib/booking-status.ts
 * decides which). One conditional UPDATE: it only applies if the booking still
 * has the status the admin saw, so two phones cannot both change it. Going
 * back to "confirmed" can collide with another booking: the database refuses
 * (23P01) and the salon is told which one.
 */
export async function changeBookingStatus(
  salonId: Uuid,
  bookingId: Uuid,
  to: BookingStatus,
  now: Date = new Date(),
): Promise<AdminBookingResult> {
  const actor = await adminOnly(salonId, "changeBookingStatus");
  if (!isUuid(bookingId)) return { ok: false, error: ADMIN_MESSAGES.notFound };
  try {
    const db = adminDb();
    const current = await must(
      "changeBookingStatus(read)",
      db.from("bookings").select("*").eq("id", bookingId).eq("salon_id", salonId).maybeSingle<Booking>(),
    );
    if (!current) return { ok: false, error: ADMIN_MESSAGES.notFound };
    if (!canChangeStatus(current, to, now)) return { ok: false, error: ADMIN_MESSAGES.notAllowed };

    let update = db
      .from("bookings")
      .update({ status: to })
      .eq("id", bookingId)
      .eq("salon_id", salonId)
      .eq("status", current.status);
    // "Completed" and "no-show" need the start to have passed, checked in the same statement.
    if (to === "completed" || to === "no_show") update = update.lte("starts_at", now.toISOString());
    const { data, error } = await update.select("*").maybeSingle<Booking>();

    if (error?.code === "23P01") {
      const [member, salon] = await Promise.all([
        must("changeBookingStatus(staff)", db.from("staff").select("id, name").eq("id", current.staff_id).single<Pick<Staff, "id" | "name">>()),
        must("changeBookingStatus(salon)", db.from("salons").select("timezone").eq("id", salonId).single<Pick<Salon, "timezone">>()),
      ]);
      const start = new Date(current.starts_at);
      const busyEnd = addMinutes(new Date(current.ends_at), current.buffer_min);
      return { ok: false, error: await overlapMessage(salonId, member, start, busyEnd, salon.timezone, bookingId) };
    }
    if (error) fail("changeBookingStatus(update)", error);
    if (!data) return { ok: false, error: ADMIN_MESSAGES.changed };

    await audit(salonId, actor, "booking.status", bookingId, { from: current.status, to });
    return { ok: true, booking: data, previous: current.status };
  } catch {
    return { ok: false, error: ADMIN_MESSAGES.failed };
  }
}

/**
 * A booking the salon enters by hand (a phone call, a walk-in, afterwards).
 * Unlike the public form it may be in the past and ignores the minimum notice
 * and the booking window. It never skips the overlap rule: the database
 * refuses two bookings of one staff member at once (23P01), and the salon is
 * told which booking is in the way. Outside working hours or during an
 * absence it asks first (`outsideHours`), unless `allowOutsideHours`.
 * Price, end and buffer always come from the database.
 */
export async function createManualBooking(
  salonId: Uuid,
  input: ManualBookingInput,
  options: { allowOutsideHours: boolean },
  now: Date = new Date(),
): Promise<AdminBookingResult> {
  const actor = await adminOnly(salonId, "createManualBooking");
  const start = new Date(input.starts_at);
  const newCustomer = "id" in input.customer ? null : input.customer;
  if (
    !isUuid(input.service_id) ||
    !isUuid(input.staff_id) ||
    Number.isNaN(start.getTime()) ||
    Math.abs(start.getTime() - now.getTime()) > MANUAL_RANGE_DAYS * 86_400_000 ||
    ("id" in input.customer && !isUuid(input.customer.id)) ||
    (newCustomer !== null &&
      (newCustomer.first_name.trim().length === 0 ||
        newCustomer.first_name.length > 60 ||
        (newCustomer.last_name ?? "").length > 60 ||
        (newCustomer.email ?? "").length > 254 ||
        !isE164(newCustomer.phone))) ||
    (input.customer_note ?? "").length > 500 ||
    (input.internal_note ?? "").length > 1000
  ) {
    return { ok: false, error: ADMIN_MESSAGES.invalid };
  }

  try {
    const db = adminDb();
    const [salon, service, member] = await Promise.all([
      must("createManualBooking(salon)", db.from("salons").select("id, timezone").eq("id", salonId).maybeSingle<Pick<Salon, "id" | "timezone">>()),
      must(
        "createManualBooking(service)",
        db
          .from("services")
          .select("id, duration_min, buffer_after_min, price_cents")
          .eq("id", input.service_id)
          .eq("salon_id", salonId)
          .eq("is_active", true)
          .maybeSingle<Pick<Service, "id" | "duration_min" | "buffer_after_min" | "price_cents">>(),
      ),
      performer(salonId, input.staff_id, input.service_id),
    ]);
    if (!salon || !service || !member) return { ok: false, error: ADMIN_MESSAGES.invalid };
    if (member === "no-service") return { ok: false, error: ADMIN_MESSAGES.staffService };

    const end = addMinutes(start, service.duration_min);
    const busyEnd = addMinutes(end, service.buffer_after_min);
    if (!options.allowOutsideHours) {
      const warning = await hoursWarning(salonId, member, start, busyEnd, salon.timezone);
      if (warning) return { ok: false, error: warning, outsideHours: true };
    }

    // The customer: an existing one of THIS salon, or found / created by phone.
    let customer: { id: string; created: boolean };
    if ("id" in input.customer) {
      const existing = await must(
        "createManualBooking(customer)",
        db.from("customers").select("id").eq("id", input.customer.id).eq("salon_id", salonId).maybeSingle<{ id: string }>(),
      );
      if (!existing) return { ok: false, error: ADMIN_MESSAGES.invalid };
      customer = { id: existing.id, created: false };
    } else {
      customer = await findOrCreateCustomer(salonId, { ...input.customer, marketing_consent: false });
    }

    const { data, error } = await db
      .from("bookings")
      .insert({
        salon_id: salonId,
        staff_id: member.id,
        service_id: service.id,
        customer_id: customer.id,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        buffer_min: service.buffer_after_min,
        status: "confirmed",
        price_cents: service.price_cents,
        customer_note: input.customer_note?.trim() || null,
        internal_note: input.internal_note?.trim() || null,
        source: "admin",
        contact_email: newCustomer?.email?.trim() || null,
      })
      .select("*")
      .single<Booking>();

    if (!error && data) {
      await audit(salonId, actor, "booking.create", data.id, { source: "admin", starts_at: data.starts_at, staff_id: data.staff_id });
      return { ok: true, booking: data };
    }

    // Not saved: do not leave behind a customer created just for it.
    if (customer.created) {
      const cleanup = await db.from("customers").delete().eq("id", customer.id).eq("salon_id", salonId);
      if (cleanup.error) console.error(`[data] createManualBooking(cleanup) failed: ${cleanup.error.code}`);
    }
    if (error?.code === "23P01") {
      return { ok: false, error: await overlapMessage(salonId, member, start, busyEnd, salon.timezone) };
    }
    console.error(`[data] createManualBooking(insert) failed: ${error?.code} ${error?.message}`);
    if (error?.code === "23503" || error?.code === "23514") return { ok: false, error: ADMIN_MESSAGES.invalid };
    return { ok: false, error: ADMIN_MESSAGES.failed };
  } catch {
    return { ok: false, error: ADMIN_MESSAGES.failed };
  }
}

/**
 * Moves a pending or confirmed booking to another start and/or staff member.
 * Duration, cleaning buffer and price stay. Same rules as a manual booking:
 * no minimum notice, overlap always refused by the database, outside working
 * hours only after the admin confirms. The UPDATE only applies if the booking
 * is still where the admin saw it. A reminder already sent is forgotten, so
 * the new time gets its own (week 11).
 */
export async function rescheduleBooking(
  salonId: Uuid,
  bookingId: Uuid,
  move: BookingMove,
  options: { allowOutsideHours: boolean },
  now: Date = new Date(),
): Promise<AdminBookingResult> {
  const actor = await adminOnly(salonId, "rescheduleBooking");
  const start = new Date(move.starts_at);
  if (
    !isUuid(bookingId) ||
    !isUuid(move.staff_id) ||
    Number.isNaN(start.getTime()) ||
    Math.abs(start.getTime() - now.getTime()) > MANUAL_RANGE_DAYS * 86_400_000
  ) {
    return { ok: false, error: ADMIN_MESSAGES.invalid };
  }

  try {
    const db = adminDb();
    const [current, salon] = await Promise.all([
      must("rescheduleBooking(read)", db.from("bookings").select("*").eq("id", bookingId).eq("salon_id", salonId).maybeSingle<Booking>()),
      must("rescheduleBooking(salon)", db.from("salons").select("timezone").eq("id", salonId).maybeSingle<Pick<Salon, "timezone">>()),
    ]);
    if (!current || !salon) return { ok: false, error: ADMIN_MESSAGES.notFound };
    if (!MOVABLE.includes(current.status)) return { ok: false, error: ADMIN_MESSAGES.notAllowed };
    if (current.staff_id === move.staff_id && Date.parse(current.starts_at) === start.getTime()) {
      return { ok: false, error: ADMIN_MESSAGES.sameTime };
    }

    const member = await performer(salonId, move.staff_id, current.service_id);
    if (!member) return { ok: false, error: ADMIN_MESSAGES.invalid };
    if (member === "no-service") return { ok: false, error: ADMIN_MESSAGES.staffService };

    const end = new Date(start.getTime() + (Date.parse(current.ends_at) - Date.parse(current.starts_at)));
    const busyEnd = addMinutes(end, current.buffer_min);
    if (!options.allowOutsideHours) {
      const warning = await hoursWarning(salonId, member, start, busyEnd, salon.timezone);
      if (warning) return { ok: false, error: warning, outsideHours: true };
    }

    const { data, error } = await db
      .from("bookings")
      .update({ starts_at: start.toISOString(), ends_at: end.toISOString(), staff_id: member.id })
      .eq("id", bookingId)
      .eq("salon_id", salonId)
      .eq("status", current.status)
      .eq("starts_at", current.starts_at)
      .eq("staff_id", current.staff_id)
      .select("*")
      .maybeSingle<Booking>();

    if (error?.code === "23P01") {
      return { ok: false, error: await overlapMessage(salonId, member, start, busyEnd, salon.timezone, bookingId) };
    }
    if (error) {
      console.error(`[data] rescheduleBooking(update) failed: ${error.code} ${error.message}`);
      return { ok: false, error: error.code === "23503" || error.code === "23514" ? ADMIN_MESSAGES.invalid : ADMIN_MESSAGES.failed };
    }
    if (!data) return { ok: false, error: ADMIN_MESSAGES.changed };

    // The reminder belonged to the old time.
    const forget = await db.from("booking_notifications").delete().eq("booking_id", bookingId).eq("salon_id", salonId).eq("kind", "reminder");
    if (forget.error) console.error(`[data] rescheduleBooking(reminder) failed: ${forget.error.code}`);

    await audit(salonId, actor, "booking.move", bookingId, {
      from: { starts_at: current.starts_at, staff_id: current.staff_id },
      to: { starts_at: data.starts_at, staff_id: data.staff_id },
    });
    return { ok: true, booking: data };
  } catch {
    return { ok: false, error: ADMIN_MESSAGES.failed };
  }
}

// ---------- owner: staff, working hours, absences, who performs, settings (week 9) ----------

export const MANAGE_MESSAGES = {
  invalid: "Preverite vnos.",
  staffNotFound: "Zaposlenega ni mogoče najti. Osvežite stran.",
  serviceNotFound: "Storitve ni mogoče najti. Osvežite stran.",
  notFound: "Tega ni mogoče najti. Osvežite stran.",
  failed: "Sprememb trenutno ni mogoče shraniti. Poskusite znova čez nekaj minut.",
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;
const AFFECTED_DAYS = 365;

/**
 * Future pending/confirmed bookings in [from, to) that no longer fit their
 * staff member's working hours or overlap an absence (lib/working-hours.ts).
 * They are not changed: the salon moves or cancels them (decision of 22. 10. 2026).
 */
async function affectedBookings(salonId: Uuid, staffIds: Uuid[], from: Date, to: Date): Promise<AffectedBooking[]> {
  if (staffIds.length === 0) return [];
  const db = adminDb();
  const [salon, bookings, hours, timeOff] = await Promise.all([
    must("affectedBookings(salon)", db.from("salons").select("timezone").eq("id", salonId).single<Pick<Salon, "timezone">>()),
    selectAll("affectedBookings(bookings)", (first, last) =>
      db
        .from("bookings")
        .select("id, staff_id, customer_id, starts_at, ends_at, buffer_min")
        .eq("salon_id", salonId)
        .in("staff_id", staffIds)
        .in("status", ["pending", "confirmed"])
        .gte("starts_at", from.toISOString())
        .lt("starts_at", to.toISOString())
        .order("starts_at")
        .order("id")
        .range(first, last)
        .returns<Pick<Booking, "id" | "staff_id" | "customer_id" | "starts_at" | "ends_at" | "buffer_min">[]>(),
    ),
    must(
      "affectedBookings(hours)",
      db.from("staff_hours").select("staff_id, weekday, start_time, end_time").eq("salon_id", salonId).in("staff_id", staffIds)
        .returns<Pick<StaffHours, "staff_id" | "weekday" | "start_time" | "end_time">[]>(),
    ),
    must(
      "affectedBookings(time_off)",
      db.from("time_off").select("staff_id, starts_at, ends_at").eq("salon_id", salonId).gt("ends_at", from.toISOString())
        .returns<Pick<TimeOff, "staff_id" | "starts_at" | "ends_at">[]>(),
    ),
  ]);
  const misfits = bookings.filter(
    (b) =>
      workingHoursProblem({
        staffId: b.staff_id,
        start: new Date(b.starts_at),
        busyEnd: addMinutes(new Date(b.ends_at), b.buffer_min),
        hours,
        timeOff,
        timeZone: salon.timezone,
      }) !== null,
  );
  if (misfits.length === 0) return [];
  const customers = await must(
    "affectedBookings(customers)",
    db.from("customers").select("id, first_name, last_name").eq("salon_id", salonId).in("id", [...new Set(misfits.map((b) => b.customer_id))])
      .returns<Pick<Customer, "id" | "first_name" | "last_name">[]>(),
  );
  const names = new Map(customers.map((c) => [c.id, `${c.first_name} ${c.last_name ?? ""}`.trim()]));
  return misfits.map((b) => ({
    id: b.id,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    staff_id: b.staff_id,
    customer_name: names.get(b.customer_id) ?? "Neznana stranka",
  }));
}

function cleanStaff(input: StaffInput): StaffInput | null {
  const name = input.name.trim();
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  if (!name || name.length > 60 || !HEX.test(input.color) || (email ?? "").length > 254 || (phone ?? "").length > 40) return null;
  return { name, color: input.color, email, phone, is_active: input.is_active };
}

/** A new staff member: active, no working hours and no services yet (the owner sets them next). */
export async function createStaff(salonId: Uuid, input: Pick<StaffInput, "name" | "color">): Promise<ManageResult<Staff>> {
  const actor = await ownerOnly(salonId, "createStaff");
  const clean = cleanStaff({ ...input, email: null, phone: null, is_active: true });
  if (!isUuid(salonId) || !clean) return { ok: false, error: MANAGE_MESSAGES.invalid };
  try {
    const db = adminDb();
    const last = await must(
      "createStaff(order)",
      db.from("staff").select("sort_order").eq("salon_id", salonId).order("sort_order", { ascending: false }).limit(1).returns<{ sort_order: number }[]>(),
    );
    const { data, error } = await db
      .from("staff")
      .insert({ salon_id: salonId, name: clean.name, color: clean.color, is_active: true, sort_order: (last[0]?.sort_order ?? 0) + 1 })
      .select("*")
      .single<Staff>();
    if (error) fail("createStaff(insert)", error);
    await audit(salonId, actor, "staff.create", data.id, { name: data.name }, "staff");
    return { ok: true, value: data, affected: [] };
  } catch {
    return { ok: false, error: MANAGE_MESSAGES.failed };
  }
}

/**
 * Name, color, contact and active. Not active while the staff member still has
 * future bookings (decision of 22. 10. 2026): an inactive staff member's
 * bookings would vanish from the calendar.
 */
export async function updateStaff(salonId: Uuid, staffId: Uuid, input: StaffInput, now: Date = new Date()): Promise<ManageResult<Staff>> {
  const actor = await ownerOnly(salonId, "updateStaff");
  const clean = cleanStaff(input);
  if (!isUuid(staffId) || !clean) return { ok: false, error: MANAGE_MESSAGES.invalid };
  try {
    const db = adminDb();
    if (!clean.is_active) {
      const { count, error } = await db
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("salon_id", salonId)
        .eq("staff_id", staffId)
        .in("status", ["pending", "confirmed"])
        .gte("ends_at", now.toISOString());
      if (error) fail("updateStaff(bookings)", error);
      if (count) {
        return {
          ok: false,
          error: `Število prihodnjih terminov tega zaposlenega: ${count}. Najprej jih prestavite ali odpovejte, nato ga nastavite kot neaktivnega.`,
        };
      }
    }
    const { data, error } = await db
      .from("staff")
      .update(clean)
      .eq("id", staffId)
      .eq("salon_id", salonId)
      .select("*")
      .maybeSingle<Staff>();
    if (error) fail("updateStaff(update)", error);
    if (!data) return { ok: false, error: MANAGE_MESSAGES.staffNotFound };
    await audit(salonId, actor, "staff.update", staffId, { ...clean, email: undefined, phone: undefined }, "staff");
    return { ok: true, value: data, affected: [] };
  } catch {
    return { ok: false, error: MANAGE_MESSAGES.failed };
  }
}

/**
 * Replaces the staff member's whole week in one statement (replace_staff_hours,
 * 007): a failure leaves the old week. `rows` are checked by lib/schedule.ts
 * checkWeek first. Free slots change at once (nothing is cached). Returns the
 * future bookings that no longer fit.
 */
export async function setStaffHours(
  salonId: Uuid,
  staffId: Uuid,
  rows: Pick<StaffHours, "weekday" | "start_time" | "end_time">[],
  now: Date = new Date(),
): Promise<ManageResult<null>> {
  const actor = await ownerOnly(salonId, "setStaffHours");
  if (!isUuid(staffId) || rows.length > 21) return { ok: false, error: MANAGE_MESSAGES.invalid };
  try {
    const { error } = await adminDb().rpc("replace_staff_hours", { p_salon_id: salonId, p_staff_id: staffId, p_hours: rows });
    if (error?.code === "23503") return { ok: false, error: MANAGE_MESSAGES.staffNotFound };
    if (error?.code === "23514" || error?.code === "22007" || error?.code === "22008") return { ok: false, error: MANAGE_MESSAGES.invalid };
    if (error) fail("setStaffHours(rpc)", error);
    await audit(salonId, actor, "staff.hours", staffId, { rows }, "staff");
    return { ok: true, value: null, affected: await affectedBookings(salonId, [staffId], now, addDays(now, AFFECTED_DAYS)) };
  } catch {
    return { ok: false, error: MANAGE_MESSAGES.failed };
  }
}

/**
 * An absence of one staff member, or the whole salon closed (`staff_id` null).
 * The reason stays private: visitors cannot read it (003_rls.sql). Returns the
 * bookings it now covers.
 */
export async function addTimeOff(
  salonId: Uuid,
  input: { staff_id: Uuid | null; starts_at: Timestamptz; ends_at: Timestamptz; reason: string | null },
): Promise<ManageResult<TimeOff>> {
  const actor = await ownerOnly(salonId, "addTimeOff");
  const start = new Date(input.starts_at);
  const end = new Date(input.ends_at);
  const reason = input.reason?.trim() || null;
  if (
    (input.staff_id !== null && !isUuid(input.staff_id)) ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start ||
    (reason ?? "").length > 200
  ) {
    return { ok: false, error: MANAGE_MESSAGES.invalid };
  }
  try {
    const db = adminDb();
    const { data, error } = await db
      .from("time_off")
      .insert({ salon_id: salonId, staff_id: input.staff_id, starts_at: start.toISOString(), ends_at: end.toISOString(), reason })
      .select("*")
      .single<TimeOff>();
    // 23503: a staff member of another salon (composite key, 002_constraints.sql).
    if (error?.code === "23503") return { ok: false, error: MANAGE_MESSAGES.staffNotFound };
    if (error) fail("addTimeOff(insert)", error);
    await audit(salonId, actor, "time_off.create", data.id, { staff_id: data.staff_id, starts_at: data.starts_at, ends_at: data.ends_at }, "time_off");

    const staffIds = input.staff_id
      ? [input.staff_id]
      : (await must("addTimeOff(staff)", db.from("staff").select("id").eq("salon_id", salonId).returns<{ id: string }[]>())).map((m) => m.id);
    return { ok: true, value: data, affected: await affectedBookings(salonId, staffIds, start, end) };
  } catch {
    return { ok: false, error: MANAGE_MESSAGES.failed };
  }
}

export async function deleteTimeOff(salonId: Uuid, timeOffId: Uuid): Promise<ManageResult<null>> {
  const actor = await ownerOnly(salonId, "deleteTimeOff");
  if (!isUuid(timeOffId)) return { ok: false, error: MANAGE_MESSAGES.notFound };
  try {
    const { data, error } = await adminDb()
      .from("time_off")
      .delete()
      .eq("id", timeOffId)
      .eq("salon_id", salonId)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) fail("deleteTimeOff", error);
    if (!data) return { ok: false, error: MANAGE_MESSAGES.notFound };
    await audit(salonId, actor, "time_off.delete", timeOffId, {}, "time_off");
    return { ok: true, value: null, affected: [] };
  } catch {
    return { ok: false, error: MANAGE_MESSAGES.failed };
  }
}

/**
 * Who performs a service: exactly `staffIds` afterwards. New links first, then
 * the removed ones, so a failure halfway never leaves fewer performers than
 * before. Existing bookings stay; only new bookings follow the change.
 */
export async function setServiceStaff(salonId: Uuid, serviceId: Uuid, staffIds: Uuid[]): Promise<ManageResult<null>> {
  const actor = await ownerOnly(salonId, "setServiceStaff");
  const wanted = [...new Set(staffIds)];
  if (!isUuid(serviceId) || !wanted.every(isUuid)) return { ok: false, error: MANAGE_MESSAGES.invalid };
  try {
    const db = adminDb();
    const [service, members] = await Promise.all([
      must("setServiceStaff(service)", db.from("services").select("id").eq("id", serviceId).eq("salon_id", salonId).maybeSingle<{ id: string }>()),
      wanted.length
        ? must("setServiceStaff(staff)", db.from("staff").select("id").eq("salon_id", salonId).in("id", wanted).returns<{ id: string }[]>())
        : Promise.resolve([]),
    ]);
    if (!service) return { ok: false, error: MANAGE_MESSAGES.serviceNotFound };
    if (members.length !== wanted.length) return { ok: false, error: MANAGE_MESSAGES.staffNotFound };

    if (wanted.length) {
      const { error } = await db
        .from("staff_services")
        .upsert(wanted.map((staff_id) => ({ staff_id, service_id: serviceId, salon_id: salonId })), {
          onConflict: "staff_id,service_id",
          ignoreDuplicates: true,
        });
      if (error) fail("setServiceStaff(add)", error);
    }
    let remove = db.from("staff_services").delete().eq("salon_id", salonId).eq("service_id", serviceId);
    if (wanted.length) remove = remove.not("staff_id", "in", `(${wanted.join(",")})`);
    const { error } = await remove;
    if (error) fail("setServiceStaff(remove)", error);

    await audit(salonId, actor, "service.staff", serviceId, { staff_ids: wanted }, "service");
    return { ok: true, value: null, affected: [] };
  } catch {
    return { ok: false, error: MANAGE_MESSAGES.failed };
  }
}

/** Same limits as the salons checks in 002_constraints.sql and 007. */
function cleanSettings(input: SalonSettingsInput): SalonSettingsInput | null {
  const text = (value: string | null, max: number) => {
    const t = value?.trim() || null;
    return t !== null && t.length > max ? undefined : t;
  };
  const name = input.name.trim();
  const phone = text(input.phone, 40);
  const email = text(input.email, 254);
  const address = text(input.address, 200);
  const note = text(input.confirmation_note, 500);
  const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (
    !name ||
    name.length > 80 ||
    phone === undefined ||
    email === undefined ||
    address === undefined ||
    note === undefined ||
    !HEX.test(input.brand_color) ||
    !whole(input.slot_interval_min, 5, 240) ||
    !whole(input.min_lead_time_min, 0, 60 * 24 * 30) ||
    !whole(input.max_days_ahead, 1, 365) ||
    !whole(input.cancel_window_hours, 0, 24 * 30) ||
    !whole(input.reminder_hours_before, 0, 24 * 7)
  ) {
    return null;
  }
  return { ...input, name, phone, email, address, confirmation_note: note };
}

/** The salon's own settings (never slug, subscription or time zone). */
export async function updateSalonSettings(salonId: Uuid, input: SalonSettingsInput): Promise<ManageResult<Salon>> {
  const actor = await ownerOnly(salonId, "updateSalonSettings");
  const clean = cleanSettings(input);
  if (!clean) return { ok: false, error: MANAGE_MESSAGES.invalid };
  try {
    const { data, error } = await adminDb().from("salons").update(clean).eq("id", salonId).select("*").single<Salon>();
    if (error?.code === "23514") return { ok: false, error: MANAGE_MESSAGES.invalid };
    if (error) fail("updateSalonSettings", error);
    await audit(salonId, actor, "salon.settings", salonId, { ...clean, email: undefined, phone: undefined }, "salon");
    return { ok: true, value: data, affected: [] };
  } catch {
    return { ok: false, error: MANAGE_MESSAGES.failed };
  }
}
