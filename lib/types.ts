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
  /** The salon's own sentence in the confirmation e-mail (007), at most 500 characters. */
  confirmation_note: string | null;
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
  /** E.164, e.g. "+38640123456" (check constraint customers_phone_e164). */
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
  /** E-mail given with this booking; messages about it go here (005). Null: use customers.email. */
  contact_email: string | null;
  cancel_token: Uuid;
  created_at: Timestamptz;
  updated_at: Timestamptz;
  /** Generated column: tstzrange(starts_at, ends_at + buffer_min). Read-only. */
  period: string;
}

/** booking_notifications.kind */
export type NotificationKind = "request" | "confirmation" | "reminder" | "reschedule" | "cancellation";

/**
 * table: booking_notifications. Unique per (booking_id, kind, channel), so a
 * message is sent at most once; "reschedule" may repeat (006). status is text:
 * "pending" while sending, then "sent" or "failed" (lib/notifications.ts).
 */
export interface BookingNotification {
  id: Uuid;
  salon_id: Uuid;
  booking_id: Uuid;
  kind: NotificationKind;
  channel: string;
  status: string;
  provider_id: string | null;
  sent_at: Timestamptz;
}

// ============ app types (not tables) ============
// Inputs and outputs of the functions in lib/data.ts. They keep the same shape
// with Supabase (they did with the phase-1 mock too).

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
  /** E.164, e.g. "+38640123456" (lib/phone.ts normalizePhone). */
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

/** Cancelling by the link in the e-mail (lib/data.ts cancelBookingByToken). */
export type CancelBookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "not-found" | "not-active" | "too-late" | "failed" };

// ---------- admin ----------

/** A booking the salon enters by hand (lib/data.ts createManualBooking). Price, end and buffer come from the database. */
export interface ManualBookingInput {
  service_id: Uuid;
  staff_id: Uuid;
  starts_at: Timestamptz;
  /** An existing customer of this salon, or a new one (found by phone if it already exists). */
  customer:
    | { id: Uuid }
    | { first_name: string; last_name: string | null; phone: string; email: string | null };
  customer_note: string | null;
  internal_note: string | null;
}

/** Moving a booking (lib/data.ts rescheduleBooking): new start and/or staff member. */
export interface BookingMove {
  starts_at: Timestamptz;
  staff_id: Uuid;
}

/** Result of the admin's booking changes. `error` is a friendly Slovenian sentence. */
export type AdminBookingResult =
  /** `previous`: the status before a status change (changeBookingStatus only). */
  | { ok: true; booking: Booking; previous?: BookingStatus }
  /** `outsideHours`: allowed after the admin confirms (decision of 21. 10. 2026). */
  | { ok: false; error: string; outsideHours?: boolean };

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

// ---------- admin: staff, hours, settings (week 9, owner only) ----------

export interface StaffInput {
  name: string;
  color: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
}

/** A future booking that no longer fits a changed schedule or a new absence: the salon moves it by hand. */
export interface AffectedBooking {
  id: Uuid;
  starts_at: Timestamptz;
  ends_at: Timestamptz;
  staff_id: Uuid;
  customer_name: string;
}

/** Result of the owner's changes. `error` is a friendly Slovenian sentence. */
export type ManageResult<T> =
  | { ok: true; value: T; affected: AffectedBooking[] }
  | { ok: false; error: string };

/** What the salon may change itself (not slug, subscription or time zone: those are the platform's). */
export interface SalonSettingsInput {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  brand_color: string;
  slot_interval_min: number;
  min_lead_time_min: number;
  max_days_ahead: number;
  cancel_window_hours: number;
  require_confirmation: boolean;
  reminder_hours_before: number;
  confirmation_note: string | null;
}
