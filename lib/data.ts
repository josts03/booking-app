/**
 * The ONLY file through which the app reads or writes data.
 *
 * Right now it serves fake data from ./mock. Later the body of each function
 * is replaced with Supabase calls; signatures and types stay the same, and
 * nothing outside this file may import ./mock.
 *
 * Every function is async because the Supabase versions will be.
 */
import { addDays, addMinutes, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { mock, toPeriod } from "./mock";
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
  Uuid,
} from "./types";

/** The mock hands out copies, like a database would, so callers cannot mutate it. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

function bySortOrder<T extends { sort_order: number }>(a: T, b: T): number {
  return a.sort_order - b.sort_order;
}

// ---------- reads ----------

export async function getSalon(slug: string): Promise<Salon | null> {
  const found = mock.salons.find((salon) => salon.slug === slug);
  return found ? copy(found) : null;
}

/** Active services only, unless `includeInactive` (admin screens). */
export async function getServices(
  salonId: Uuid,
  options: { includeInactive?: boolean } = {},
): Promise<Service[]> {
  return copy(
    mock.services
      .filter((s) => s.salon_id === salonId)
      .filter((s) => options.includeInactive || s.is_active)
      .sort(bySortOrder),
  );
}

/**
 * Active staff only, unless `includeInactive` (admin screens).
 * With `serviceId`: only staff who perform that service (staff_services).
 */
export async function getStaff(
  salonId: Uuid,
  options: { includeInactive?: boolean; serviceId?: Uuid } = {},
): Promise<Staff[]> {
  return copy(
    mock.staff
      .filter((s) => s.salon_id === salonId)
      .filter((s) => options.includeInactive || s.is_active)
      .filter(
        (s) =>
          options.serviceId === undefined ||
          mock.staffServices.some(
            (l) => l.staff_id === s.id && l.service_id === options.serviceId,
          ),
      )
      .sort(bySortOrder),
  );
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
  return copy(
    mock.bookings
      .filter((b) => b.salon_id === salonId)
      .filter((b) => {
        const start = parseISO(b.starts_at);
        return start >= from && start < to;
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
  );
}

/**
 * Finds a booking by its cancel_token (compared in full, never by id).
 * The caller must still check that booking.salon_id is the current salon.
 */
export async function getBookingByCancelToken(token: string): Promise<Booking | null> {
  const found = mock.bookings.find((b) => b.cancel_token === token);
  return found ? copy(found) : null;
}

// ---------- admin reads ----------
// Everything below is for the admin area. With the real database these go
// through the logged-in user (RLS) or the server-only service_role client.

export async function getStaffHours(salonId: Uuid): Promise<StaffHours[]> {
  return copy(mock.staffHours.filter((h) => h.salon_id === salonId));
}

export async function getStaffServices(salonId: Uuid): Promise<StaffService[]> {
  return copy(mock.staffServices.filter((l) => l.salon_id === salonId));
}

/** Time off that overlaps [from, to). staff_id null means the whole salon. */
export async function getTimeOff(salonId: Uuid, from: Date, to: Date): Promise<TimeOff[]> {
  return copy(
    mock.timeOff
      .filter((t) => t.salon_id === salonId)
      .filter((t) => parseISO(t.starts_at) < to && parseISO(t.ends_at) > from)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
  );
}

/** One booking of this salon by id (admin only; visitors use the cancel_token). */
export async function getBooking(salonId: Uuid, bookingId: Uuid): Promise<Booking | null> {
  const found = mock.bookings.find((b) => b.id === bookingId && b.salon_id === salonId);
  return found ? copy(found) : null;
}

export async function getCustomer(salonId: Uuid, customerId: Uuid): Promise<Customer | null> {
  const found = mock.customers.find((c) => c.id === customerId && c.salon_id === salonId);
  return found ? copy(found) : null;
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
  const query = fold(options.query?.trim() ?? "");
  const queryDigits = query.replace(/\D/g, "");
  const now = new Date();

  const matches = (c: Customer): boolean => {
    if (!query) return true;
    const name = fold(`${c.first_name} ${c.last_name ?? ""}`);
    if (name.includes(query) || fold(c.email ?? "").includes(query)) return true;
    return queryDigits.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(queryDigits);
  };

  return mock.customers
    .filter((c) => c.salon_id === salonId && matches(c))
    .map((customer) => {
      const own = mock.bookings.filter(
        (b) => b.customer_id === customer.id && b.status !== "cancelled",
      );
      const past = own.filter((b) => parseISO(b.starts_at) <= now);
      const upcoming = own.filter(
        (b) => parseISO(b.starts_at) > now && (b.status === "pending" || b.status === "confirmed"),
      );
      return {
        customer: copy(customer),
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
  return copy(
    mock.bookings
      .filter((b) => b.salon_id === salonId && b.customer_id === customerId)
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
  );
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
  const service: Service = {
    id: crypto.randomUUID(),
    salon_id: salonId,
    name: input.name.trim(),
    description: null,
    category: input.category?.trim() || null,
    duration_min: input.duration_min,
    buffer_after_min: input.buffer_after_min,
    price_cents: input.price_cents,
    is_active: input.is_active,
    sort_order: Math.max(0, ...mock.services.map((s) => s.sort_order)) + 1,
  };
  mock.services.push(service);
  return { ok: true, service: copy(service) };
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
  const service = mock.services.find((s) => s.id === serviceId && s.salon_id === salonId);
  if (!service || !validService(input)) return { ok: false, error: SERVICE_INVALID };
  Object.assign(service, {
    name: input.name.trim(),
    category: input.category?.trim() || null,
    duration_min: input.duration_min,
    buffer_after_min: input.buffer_after_min,
    price_cents: input.price_cents,
    is_active: input.is_active,
  });
  return { ok: true, service: copy(service) };
}

// ---------- free slots ----------

/** Staff who may do this service: one chosen member, or everyone who performs it. */
function candidateStaff(salonId: Uuid, serviceId: Uuid, staffId: Uuid | null): Staff[] {
  return mock.staff
    .filter((s) => s.salon_id === salonId && s.is_active)
    .filter((s) => staffId === null || s.id === staffId)
    .filter((s) =>
      mock.staffServices.some(
        (l) => l.staff_id === s.id && l.service_id === serviceId && l.salon_id === salonId,
      ),
    )
    .sort(bySortOrder);
}

/** Everything lib/slots.ts needs about one member, taken straight from the rows. */
function availability(salonId: Uuid, staffId: Uuid): StaffAvailability {
  return {
    staff_id: staffId,
    hours: mock.staffHours.filter((h) => h.salon_id === salonId && h.staff_id === staffId),
    timeOff: mock.timeOff.filter(
      (t) => t.salon_id === salonId && (t.staff_id === null || t.staff_id === staffId),
    ),
    bookings: mock.bookings.filter((b) => b.salon_id === salonId && b.staff_id === staffId),
  };
}

/**
 * Bookable start times for one service on one local day.
 *
 * This function only gathers rows — every rule lives in lib/slots.ts. With
 * Supabase the three lookups above become queries and nothing else changes.
 */
export async function getFreeSlots(query: FreeSlotsQuery): Promise<FreeSlot[]> {
  const salon = mock.salons.find((s) => s.id === query.salon_id);
  const service = mock.services.find(
    (s) => s.id === query.service_id && s.salon_id === query.salon_id && s.is_active,
  );
  if (!salon || !service) return [];

  return freeSlots({
    salon,
    service,
    day: query.day,
    staff: candidateStaff(salon.id, service.id, query.staff_id).map((member) =>
      availability(salon.id, member.id),
    ),
    now: new Date(),
  });
}

interface Interval {
  from: Date;
  to: Date;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.from < b.to && b.from < a.to;
}

/** Time a staff member cannot take new bookings: bookings (with buffer) and time off. */
function blockedIntervals(salonId: Uuid, staffId: Uuid): Interval[] {
  const booked = mock.bookings
    .filter((b) => b.salon_id === salonId && b.staff_id === staffId)
    .filter((b) => b.status === "pending" || b.status === "confirmed")
    .map((b) => ({
      from: parseISO(b.starts_at),
      to: addMinutes(parseISO(b.ends_at), b.buffer_min),
    }));
  const away = mock.timeOff
    .filter((t) => t.salon_id === salonId && (t.staff_id === null || t.staff_id === staffId))
    .map((t) => ({ from: parseISO(t.starts_at), to: parseISO(t.ends_at) }));
  return [...booked, ...away];
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
  const salon = mock.salons.find((s) => s.id === input.salon_id);
  const service = mock.services.find(
    (s) => s.id === input.service_id && s.salon_id === input.salon_id && s.is_active,
  );
  const member = mock.staff.find(
    (s) => s.id === input.staff_id && s.salon_id === input.salon_id && s.is_active,
  );
  const performs = mock.staffServices.some(
    (l) =>
      l.staff_id === input.staff_id &&
      l.service_id === input.service_id &&
      l.salon_id === input.salon_id,
  );
  const start = new Date(input.starts_at);
  if (!salon || !service || !member || !performs || Number.isNaN(start.getTime())) {
    return { ok: false, error: MESSAGES.invalid };
  }

  const end = addMinutes(start, service.duration_min);
  const wanted = { from: start, to: addMinutes(end, service.buffer_after_min) };

  if (blockedIntervals(salon.id, member.id).some((b) => overlaps(wanted, b))) {
    return { ok: false, error: MESSAGES.taken };
  }

  const day = formatInTimeZone(start, salon.timezone, "yyyy-MM-dd");
  const offered = await getFreeSlots({
    salon_id: salon.id,
    service_id: service.id,
    staff_id: member.id,
    day,
  });
  const stillFree = offered.some(
    (slot) => new Date(slot.starts_at).getTime() === start.getTime(),
  );
  if (!stillFree) {
    return { ok: false, error: MESSAGES.unavailable };
  }

  const now = new Date().toISOString();

  let customer = mock.customers.find(
    (c) => c.salon_id === salon.id && c.phone === input.phone,
  );
  if (!customer) {
    const created: Customer = {
      id: crypto.randomUUID(),
      salon_id: salon.id,
      first_name: input.first_name,
      last_name: input.last_name ?? null,
      phone: input.phone,
      email: input.email,
      notes: null,
      marketing_consent: input.marketing_consent,
      anonymized_at: null,
      created_at: now,
    };
    mock.customers.push(created);
    customer = created;
  }

  const booking: Booking = {
    id: crypto.randomUUID(),
    salon_id: salon.id,
    staff_id: member.id,
    service_id: service.id,
    customer_id: customer.id,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    buffer_min: service.buffer_after_min,
    status: salon.require_confirmation ? "pending" : "confirmed",
    price_cents: service.price_cents,
    customer_note: input.customer_note ?? null,
    internal_note: null,
    source: input.source ?? "online",
    cancel_token: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    period: toPeriod(start, wanted.to),
  };
  mock.bookings.push(booking);

  return { ok: true, booking: copy(booking) };
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
  return !mock.salons.some((salon) => salon.slug === wanted);
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
  const now = new Date();

  const salon: Salon = {
    id: crypto.randomUUID(),
    slug,
    custom_domain: null,
    name,
    phone,
    email,
    address: null,
    timezone,
    logo_url: null,
    brand_color: null,
    ...SALON_DEFAULTS,
    subscription_status: "trial",
    trial_ends_at: addDays(now, TRIAL_DAYS).toISOString(),
    created_at: now.toISOString(),
  };
  mock.salons.push(salon);
  return { ok: true, salon: copy(salon) };
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
  const salon = mock.salons.find((s) => s.id === salonId);
  if (!salon) return { ok: false, error: SALON_INVALID };

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

  Object.assign(salon, {
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
  });
  return { ok: true, salon: copy(salon) };
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
  const member: Staff = {
    id: crypto.randomUUID(),
    salon_id: salonId,
    user_id: null,
    name: input.name.trim(),
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.trim() || null,
    color: input.color?.trim() || null,
    is_active: input.is_active,
    sort_order:
      Math.max(0, ...mock.staff.filter((s) => s.salon_id === salonId).map((s) => s.sort_order)) + 1,
  };
  mock.staff.push(member);
  return { ok: true, staff: copy(member) };
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
  const member = mock.staff.find((s) => s.id === staffId && s.salon_id === salonId);
  if (!member || !validStaff(input)) return { ok: false, error: STAFF_INVALID };
  Object.assign(member, {
    name: input.name.trim(),
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.trim() || null,
    color: input.color?.trim() || null,
    is_active: input.is_active,
  });
  return { ok: true, staff: copy(member) };
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
  const member = mock.staff.find((s) => s.id === staffId && s.salon_id === salonId);
  if (!member) return [];

  const allowed = new Set(
    mock.services.filter((s) => s.salon_id === salonId).map((s) => s.id),
  );
  const wanted = [...new Set(serviceIds)].filter((id) => allowed.has(id));

  const kept = mock.staffServices.filter(
    (link) => !(link.staff_id === staffId && link.salon_id === salonId),
  );
  const added: StaffService[] = wanted.map((service_id) => ({
    staff_id: staffId,
    service_id,
    salon_id: salonId,
  }));
  mock.staffServices.length = 0;
  mock.staffServices.push(...kept, ...added);
  return copy(added);
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
  const member = mock.staff.find((s) => s.id === staffId && s.salon_id === salonId);
  if (!member) return null;

  const rows: StaffHours[] = [];
  for (const entry of hours) {
    const start = normalizeTime(entry.start_time);
    const end = normalizeTime(entry.end_time);
    if (!start || !end || start >= end) return null;
    if (!Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6) return null;
    rows.push({
      id: crypto.randomUUID(),
      salon_id: salonId,
      staff_id: staffId,
      weekday: entry.weekday,
      start_time: start,
      end_time: end,
    });
  }

  const kept = mock.staffHours.filter(
    (h) => !(h.staff_id === staffId && h.salon_id === salonId),
  );
  mock.staffHours.length = 0;
  mock.staffHours.push(...kept, ...rows);
  return copy(rows);
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
  if (
    input.staff_id &&
    !mock.staff.some((s) => s.id === input.staff_id && s.salon_id === salonId)
  ) {
    return { ok: false, error: TIME_OFF_INVALID };
  }
  const row: TimeOff = {
    id: crypto.randomUUID(),
    salon_id: salonId,
    staff_id: input.staff_id,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    reason: input.reason?.trim() || null,
  };
  mock.timeOff.push(row);
  return { ok: true, time_off: copy(row) };
}

export async function deleteTimeOff(salonId: Uuid, timeOffId: Uuid): Promise<boolean> {
  const index = mock.timeOff.findIndex((t) => t.id === timeOffId && t.salon_id === salonId);
  if (index === -1) return false;
  mock.timeOff.splice(index, 1);
  return true;
}

// ---------- admin writes: bookings ----------

const BOOKING_INVALID = "Rezervacije ni mogoče spremeniti.";

/** Which status may follow which. A finished booking is not reopened here. */
const ALLOWED_STATUS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled", "no_show"],
  confirmed: ["completed", "cancelled", "no_show"],
  cancelled: [],
  no_show: [],
  completed: [],
};

/**
 * Moves a booking to another status (confirm, cancel, no-show, complete).
 * The slot is freed only by "cancelled": see blockedIntervals().
 */
export async function setBookingStatus(
  salonId: Uuid,
  bookingId: Uuid,
  status: BookingStatus,
): Promise<SaveBookingResult> {
  const booking = mock.bookings.find((b) => b.id === bookingId && b.salon_id === salonId);
  if (!booking) return { ok: false, error: BOOKING_INVALID };
  if (booking.status === status) return { ok: true, booking: copy(booking) };
  if (!ALLOWED_STATUS[booking.status].includes(status)) {
    return { ok: false, error: "Tega statusa ni mogoče nastaviti." };
  }
  booking.status = status;
  booking.updated_at = new Date().toISOString();
  return { ok: true, booking: copy(booking) };
}

/** The salon's private note on a booking. Never shown to the customer. */
export async function setBookingInternalNote(
  salonId: Uuid,
  bookingId: Uuid,
  note: string | null,
): Promise<SaveBookingResult> {
  const booking = mock.bookings.find((b) => b.id === bookingId && b.salon_id === salonId);
  if (!booking) return { ok: false, error: BOOKING_INVALID };
  const text = note?.trim() ?? "";
  if (text.length > 2000) return { ok: false, error: "Zaznamek je predolg." };
  booking.internal_note = text || null;
  booking.updated_at = new Date().toISOString();
  return { ok: true, booking: copy(booking) };
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
  const booking = mock.bookings.find((b) => b.cancel_token === token);
  if (!booking) return { ok: false, error: "Termina ni mogoče najti." };

  // Cancelling twice is not an error: the customer clicked the link again.
  if (booking.status === "cancelled") return { ok: true, booking: copy(booking) };

  if (booking.status === "completed" || booking.status === "no_show") {
    return { ok: false, error: "Tega termina ni več mogoče odpovedati." };
  }

  const salon = mock.salons.find((s) => s.id === booking.salon_id);
  if (!salon) return { ok: false, error: "Termina ni mogoče najti." };

  const deadline = addMinutes(parseISO(booking.starts_at), -salon.cancel_window_hours * 60);
  if (new Date() > deadline) {
    return {
      ok: false,
      error: `Termin je mogoče odpovedati najpozneje ${salon.cancel_window_hours} ur pred začetkom. Pokličite salon.`,
    };
  }

  booking.status = "cancelled";
  booking.updated_at = new Date().toISOString();
  return { ok: true, booking: copy(booking) };
}

// ---------- admin writes: customers ----------

const CUSTOMER_INVALID = "Podatkov o stranki ni mogoče shraniti. Preverite vnos.";

export async function updateCustomer(
  salonId: Uuid,
  customerId: Uuid,
  input: CustomerInput,
): Promise<SaveCustomerResult> {
  const customer = mock.customers.find((c) => c.id === customerId && c.salon_id === salonId);
  if (!customer || customer.anonymized_at) return { ok: false, error: CUSTOMER_INVALID };

  const first = input.first_name.trim();
  if (first.length < 1 || first.length > 80) return { ok: false, error: CUSTOMER_INVALID };
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !EMAIL_RULE.test(email)) {
    return { ok: false, error: "Vpišite veljaven e-naslov." };
  }

  Object.assign(customer, {
    first_name: first,
    last_name: input.last_name?.trim() || null,
    phone: input.phone?.trim() || null,
    email,
    notes: input.notes?.trim() || null,
    marketing_consent: input.marketing_consent,
  });
  return { ok: true, customer: copy(customer) };
}

/**
 * GDPR erasure: clears the personal columns and stamps `anonymized_at`, but
 * keeps the row so past bookings and the salon's numbers stay correct.
 */
export async function anonymizeCustomer(
  salonId: Uuid,
  customerId: Uuid,
): Promise<SaveCustomerResult> {
  const customer = mock.customers.find((c) => c.id === customerId && c.salon_id === salonId);
  if (!customer) return { ok: false, error: CUSTOMER_INVALID };
  if (customer.anonymized_at) return { ok: true, customer: copy(customer) };

  Object.assign(customer, {
    first_name: "Izbrisana stranka",
    last_name: null,
    phone: null,
    email: null,
    notes: null,
    marketing_consent: false,
    anonymized_at: new Date().toISOString(),
  });
  return { ok: true, customer: copy(customer) };
}

// ---------- auth (PLACEHOLDER) ----------

/**
 * There is no authentication yet (see README, "Stanje: faza 1"), so this always
 * refuses. It exists so /prijava already talks to lib/data.ts like every other
 * screen; with Supabase Auth the body becomes signInWithPassword() and the
 * result carries the real user id, which links to staff.user_id.
 */
export async function signIn(input: SignInInput): Promise<SignInResult> {
  void input; // deliberately unused until Supabase Auth is wired up
  return {
    ok: false,
    error: "Prijava še ni na voljo. Vklopljena bo, ko bo priklopljena baza.",
  };
}
