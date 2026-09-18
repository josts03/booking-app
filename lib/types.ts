/**
 * Row types. Each interface mirrors one table from specs/schema.sql, field for
 * field and with the same names. When the schema changes, change this file too.
 *
 * Postgres -> TypeScript mapping used here:
 *   uuid                 -> Uuid (string)
 *   timestamptz          -> Timestamptz (ISO 8601 string, e.g. "2026-09-21T07:00:00.000Z")
 *   time                 -> LocalTime ("HH:MM:SS", wall-clock time, no zone)
 *   nullable column      -> `| null`
 *   column with default  -> required (the database always returns a value)
 */

export type Uuid = string;
export type Timestamptz = string;
export type LocalTime = string;

// ============ enums ============

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "no_show"
  | "completed";

export type SubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled";

/** 0 = Sunday ... 6 = Saturday (same as staff_hours.weekday). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ============ tables ============

/** table: salons */
export interface Salon {
  id: Uuid;
  slug: string;
  custom_domain: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  logo_url: string | null;
  brand_color: string | null;
  slot_interval_min: number;
  min_lead_time_min: number;
  max_days_ahead: number;
  cancel_window_hours: number;
  require_confirmation: boolean;
  reminder_hours_before: number;
  subscription_status: SubscriptionStatus;
  trial_ends_at: Timestamptz | null;
  created_at: Timestamptz;
}

/** table: staff */
export interface Staff {
  id: Uuid;
  salon_id: Uuid;
  user_id: Uuid | null;
  name: string;
  email: string | null;
  phone: string | null;
  color: string | null;
  is_active: boolean;
  sort_order: number;
}

/** table: services */
export interface Service {
  id: Uuid;
  salon_id: Uuid;
  name: string;
  description: string | null;
  category: string | null;
  duration_min: number;
  buffer_after_min: number;
  price_cents: number;
  is_active: boolean;
  sort_order: number;
}

/** table: staff_services (who performs which service) */
export interface StaffService {
  staff_id: Uuid;
  service_id: Uuid;
  salon_id: Uuid;
}

/** table: staff_hours (weekly schedule, local wall-clock time in the salon's timezone) */
export interface StaffHours {
  id: Uuid;
  salon_id: Uuid;
  staff_id: Uuid;
  weekday: Weekday;
  start_time: LocalTime;
  end_time: LocalTime;
}

/** table: time_off (staff_id null = the whole salon is closed) */
export interface TimeOff {
  id: Uuid;
  salon_id: Uuid;
  staff_id: Uuid | null;
  starts_at: Timestamptz;
  ends_at: Timestamptz;
  reason: string | null;
}

/** table: customers */
export interface Customer {
  id: Uuid;
  salon_id: Uuid;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  marketing_consent: boolean;
  anonymized_at: Timestamptz | null;
  created_at: Timestamptz;
}

/** table: bookings */
export interface Booking {
  id: Uuid;
  salon_id: Uuid;
  staff_id: Uuid;
  service_id: Uuid;
  customer_id: Uuid;
  starts_at: Timestamptz;
  ends_at: Timestamptz;
  buffer_min: number;
  status: BookingStatus;
  price_cents: number;
  customer_note: string | null;
  internal_note: string | null;
  source: string;
  cancel_token: Uuid;
  created_at: Timestamptz;
  updated_at: Timestamptz;
  /** Generated column: tstzrange(starts_at, ends_at + buffer_min). Read-only. */
  period: string;
}

// ============ app types (not tables) ============
// Inputs and outputs of the functions in lib/data.ts. They keep the same shape
// after the mock is replaced by Supabase.

/** A bookable start time. `ends_at` is starts_at + duration (without buffer). */
export interface FreeSlot {
  staff_id: Uuid;
  starts_at: Timestamptz;
  ends_at: Timestamptz;
}

export interface FreeSlotsQuery {
  salon_id: Uuid;
  service_id: Uuid;
  /** null = "anyone available". */
  staff_id: Uuid | null;
  /** Local calendar date in the salon's timezone, "YYYY-MM-DD". */
  day: string;
}

/**
 * What the public booking form may send. Deliberately has no price, ends_at,
 * buffer_min or status: the server derives them (price always from the database).
 */
export interface NewBooking {
  salon_id: Uuid;
  service_id: Uuid;
  staff_id: Uuid;
  starts_at: Timestamptz;
  first_name: string;
  last_name?: string | null;
  phone: string;
  email: string;
  customer_note?: string | null;
  marketing_consent: boolean;
  source?: string;
}

export type CreateBookingResult =
  | { ok: true; booking: Booking }
  /** `error` is a friendly Slovenian sentence, safe to show to the visitor. */
  | { ok: false; error: string };

// ---------- admin ----------

/** A customer with the numbers the admin list shows. Cancelled bookings do not count. */
export interface CustomerSummary {
  customer: Customer;
  bookings_count: number;
  /** Start of the latest booking that already took place. */
  last_visit_at: Timestamptz | null;
  /** Start of the earliest pending or confirmed booking in the future. */
  next_visit_at: Timestamptz | null;
}

/** The editable columns of a service (price in cents, like in the database). */
export interface ServiceInput {
  name: string;
  category: string | null;
  duration_min: number;
  buffer_after_min: number;
  price_cents: number;
  is_active: boolean;
}

export type SaveServiceResult =
  | { ok: true; service: Service }
  /** `error` is a friendly Slovenian sentence, safe to show. */
  | { ok: false; error: string };
