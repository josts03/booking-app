/**
 * The ONLY file through which the app reads or writes data.
 *
 * Right now it serves fake data from ./mock. Later the body of each function
 * is replaced with Supabase calls; signatures and types stay the same, and
 * nothing outside this file may import ./mock.
 *
 * Every function is async because the Supabase versions will be.
 */
import { addMinutes, getDay, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { mock, toPeriod } from "./mock";
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

// ---------- free slots (PLACEHOLDER) ----------

/**
 * Bookable start times for one service on one local day.
 *
 * PLACEHOLDER: this is a rough stand-in. The real engine is lib/slots.ts
 * (specs/slots.md, week 5); after that this function only loads hours,
 * time off and bookings and passes them to it. The signature stays.
 */
export async function getFreeSlots(query: FreeSlotsQuery): Promise<FreeSlot[]> {
  const salon = mock.salons.find((s) => s.id === query.salon_id);
  const service = mock.services.find(
    (s) => s.id === query.service_id && s.salon_id === query.salon_id && s.is_active,
  );
  if (!salon || !service || !/^\d{4}-\d{2}-\d{2}$/.test(query.day)) return [];
  return fakeSlots(salon, service, query.staff_id, query.day);
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

function fakeSlots(
  salon: Salon,
  service: Service,
  staffId: Uuid | null,
  day: string,
): FreeSlot[] {
  const weekday = getDay(parseISO(day));
  const earliest = addMinutes(new Date(), salon.min_lead_time_min);
  const needed = service.duration_min + service.buffer_after_min;
  const slots: FreeSlot[] = [];

  const candidates = mock.staff
    .filter((s) => s.salon_id === salon.id && s.is_active)
    .filter((s) => staffId === null || s.id === staffId)
    .filter((s) =>
      mock.staffServices.some((l) => l.staff_id === s.id && l.service_id === service.id),
    );

  for (const member of candidates) {
    const blocked = blockedIntervals(salon.id, member.id);
    const windows = mock.staffHours.filter(
      (h) => h.staff_id === member.id && h.weekday === weekday,
    );

    for (const window of windows) {
      // Local wall-clock -> absolute instant, in the salon's timezone.
      const windowStart = fromZonedTime(`${day}T${window.start_time}`, salon.timezone);
      const windowEnd = fromZonedTime(`${day}T${window.end_time}`, salon.timezone);

      for (
        let start = windowStart;
        addMinutes(start, needed) <= windowEnd;
        start = addMinutes(start, salon.slot_interval_min)
      ) {
        if (start < earliest) continue;
        const taken = { from: start, to: addMinutes(start, needed) };
        if (blocked.some((b) => overlaps(taken, b))) continue;
        slots.push({
          staff_id: member.id,
          starts_at: start.toISOString(),
          ends_at: addMinutes(start, service.duration_min).toISOString(),
        });
      }
    }
  }

  return slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
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
  const stillFree = fakeSlots(salon, service, member.id, day).some(
    (slot) => parseISO(slot.starts_at).getTime() === start.getTime(),
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
