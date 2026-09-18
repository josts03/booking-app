/**
 * Fake data for phase 1 (look and feel only, no database).
 *
 * IMPORTANT: only lib/data.ts may import this file. Everything else reads data
 * through lib/data.ts, so that swapping in Supabase touches one file.
 *
 * Shapes match lib/types.ts, which mirrors specs/schema.sql.
 */
import { addDays, addMinutes, format, nextMonday, startOfWeek } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type {
  Booking,
  Customer,
  Salon,
  Service,
  Staff,
  StaffHours,
  StaffService,
  TimeOff,
  Timestamptz,
  Uuid,
  Weekday,
} from "./types";

const TIMEZONE = "Europe/Ljubljana";

/** Readable, deterministic uuid: kind picks the "table", n the row. */
function uuid(kind: number, n: number): Uuid {
  const head = kind.toString(16).padStart(8, "0");
  const tail = n.toString(16).padStart(12, "0");
  return `${head}-0000-4000-8000-${tail}`;
}

// ---------- dates: everything is relative to "next week" ----------

// Local calendar date in the salon's timezone, then the Monday after it.
const nextWeekMonday = nextMonday(toZonedTime(new Date(), TIMEZONE));

/** Local wall-clock time of a day next week ("HH:mm") -> absolute ISO instant. */
function nextWeekAt(dayOffset: number, hhmm: string): Timestamptz {
  const day = format(addDays(nextWeekMonday, dayOffset), "yyyy-MM-dd");
  return fromZonedTime(`${day}T${hhmm}:00`, TIMEZONE).toISOString();
}

/** Postgres text form of a tstzrange, like the generated bookings.period column. */
export function toPeriod(from: Date, to: Date): string {
  const pg = (d: Date) =>
    d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "+00");
  return `["${pg(from)}","${pg(to)})`;
}

// ---------- salon ----------

const salonId = uuid(1, 1);

const salon: Salon = {
  id: salonId,
  slug: "test",
  custom_domain: null,
  name: "Frizerstvo Test",
  phone: "01 234 56 78",
  email: "salon@example.com",
  address: "Slovenska cesta 1, 1000 Ljubljana",
  timezone: TIMEZONE,
  logo_url: null,
  brand_color: "#0f766e",
  slot_interval_min: 15,
  min_lead_time_min: 120,
  max_days_ahead: 60,
  cancel_window_hours: 24,
  require_confirmation: false,
  reminder_hours_before: 24,
  subscription_status: "trial",
  trial_ends_at: addDays(new Date(), 14).toISOString(),
  created_at: addDays(new Date(), -1).toISOString(),
};

// ---------- staff ----------

const staff: Staff[] = [
  {
    id: uuid(2, 1),
    salon_id: salonId,
    user_id: null,
    name: "Maja Novak",
    email: "maja@example.com",
    phone: "031 000 111",
    color: "#6366f1",
    is_active: true,
    sort_order: 1,
  },
  {
    id: uuid(2, 2),
    salon_id: salonId,
    user_id: null,
    name: "Luka Kovač",
    email: "luka@example.com",
    phone: "031 000 222",
    color: "#f59e0b",
    is_active: true,
    sort_order: 2,
  },
];

const [maja, luka] = staff;

// ---------- services ----------

function service(
  n: number,
  name: string,
  category: string,
  duration_min: number,
  buffer_after_min: number,
  price_cents: number,
  description: string,
): Service {
  return {
    id: uuid(3, n),
    salon_id: salonId,
    name,
    description,
    category,
    duration_min,
    buffer_after_min,
    price_cents,
    is_active: true,
    sort_order: n,
  };
}

const services: Service[] = [
  service(1, "Moško striženje", "Striženje", 30, 0, 1800, "Striženje s strojčkom ali škarjami, s pranjem."),
  service(2, "Žensko striženje", "Striženje", 45, 5, 3200, "Svetovanje, pranje, striženje in feniranje."),
  service(3, "Otroško striženje", "Striženje", 30, 0, 1400, "Za otroke do 12 let."),
  service(4, "Barvanje las", "Barvanje", 90, 10, 5500, "Barvanje korenin ali celotnih las, s feniranjem."),
  service(5, "Globinska nega las", "Nega", 30, 0, 2000, "Maska in masaža lasišča za suhe ali poškodovane lase."),
];

const [mensCut, womensCut, kidsCut, coloring, treatment] = services;

// Maja does everything; Luka does not do coloring.
const staffServices: StaffService[] = [
  ...services.map((s) => ({ staff_id: maja.id, service_id: s.id, salon_id: salonId })),
  ...services
    .filter((s) => s.id !== coloring.id)
    .map((s) => ({ staff_id: luka.id, service_id: s.id, salon_id: salonId })),
];

// ---------- weekly hours: Mon-Fri 9:00-17:00 for everyone ----------

const weekdays: Weekday[] = [1, 2, 3, 4, 5];

const staffHours: StaffHours[] = staff.flatMap((member, i) =>
  weekdays.map((weekday) => ({
    id: uuid(6, i * 10 + weekday),
    salon_id: salonId,
    staff_id: member.id,
    weekday,
    start_time: "09:00:00",
    end_time: "17:00:00",
  })),
);

// ---------- time off: Luka is away next Friday ----------

const timeOff: TimeOff[] = [
  {
    id: uuid(8, 1),
    salon_id: salonId,
    staff_id: luka.id,
    starts_at: nextWeekAt(4, "00:00"),
    ends_at: nextWeekAt(5, "00:00"),
    reason: "Dopust",
  },
];

// ---------- customers ----------

function customer(
  n: number,
  first_name: string,
  last_name: string,
  marketing_consent: boolean,
  notes: string | null = null,
): Customer {
  return {
    id: uuid(4, n),
    salon_id: salonId,
    first_name,
    last_name,
    phone: `040 000 ${String(n).padStart(3, "0")}`,
    email: `${first_name}.${last_name}@example.com`
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, ""),
    notes,
    marketing_consent,
    anonymized_at: null,
    created_at: addDays(new Date(), -120).toISOString(),
  };
}

const customers: Customer[] = [
  customer(1, "Ana", "Horvat", true),
  customer(2, "Marko", "Zupan", false),
  customer(3, "Eva", "Kovačič", true, "Alergična na barve z amoniakom."),
  customer(4, "Nina", "Krajnc", false),
  customer(5, "Tina", "Vidmar", false),
  customer(6, "Jure", "Potočnik", false),
  customer(7, "Sara", "Mlakar", true),
  customer(8, "Andrej", "Golob", false, "Raje tiho, brez pogovora."),
  customer(9, "Katja", "Božič", true),
  customer(10, "Rok", "Korošec", false),
  customer(11, "Petra", "Vidic", true),
  customer(12, "Matej", "Turk", false),
];

// Another 108 customers from name lists: (i % 20, 8 * floor(i / 20) + i % 20 mod 15)
// never repeats a combination, so every name is unique.
const firstNames = [
  "Špela", "Nika", "Ema", "Lara", "Anja", "Tjaša", "Urša", "Mojca", "Barbara", "Simona",
  "Jana", "Klara", "Vesna", "Tanja", "Jan", "Žiga", "Tilen", "Blaž", "David", "Nejc",
];
const lastNames = [
  "Novak", "Kovač", "Krajnc", "Zupančič", "Kos", "Vidmar", "Mlakar", "Petek", "Kolar",
  "Rozman", "Hribar", "Zajc", "Oblak", "Kastelic", "Pirc",
];
for (let i = 0; i < 108; i++) {
  customers.push(
    customer(
      13 + i,
      firstNames[i % 20],
      lastNames[(8 * Math.floor(i / 20) + (i % 20)) % 15],
      i % 3 === 0,
    ),
  );
}

// ---------- bookings ----------

function makeBooking(
  n: number,
  who: Customer,
  by: Staff,
  what: Service,
  start: Date,
  status: Booking["status"],
  customer_note: string | null = null,
): Booking {
  const end = addMinutes(start, what.duration_min);
  const bufferEnd = addMinutes(end, what.buffer_after_min);
  const created = addDays(start, -3).toISOString();
  return {
    id: uuid(5, n),
    salon_id: salonId,
    staff_id: by.id,
    service_id: what.id,
    customer_id: who.id,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    buffer_min: what.buffer_after_min,
    status,
    price_cents: what.price_cents,
    customer_note,
    internal_note: null,
    source: "online",
    cancel_token: uuid(7, n),
    created_at: created,
    updated_at: created,
    period: toPeriod(start, bufferEnd),
  };
}

/** Five bookings next week (bookings 1-5). */
function nextWeekBooking(
  n: number,
  who: Customer,
  by: Staff,
  what: Service,
  dayOffset: number,
  hhmm: string,
  status: Booking["status"],
  customer_note: string | null = null,
): Booking {
  return makeBooking(n, who, by, what, new Date(nextWeekAt(dayOffset, hhmm)), status, customer_note);
}

const bookings: Booking[] = [
  nextWeekBooking(1, customers[0], maja, womensCut, 0, "10:00", "confirmed"),
  nextWeekBooking(2, customers[1], luka, mensCut, 0, "13:00", "confirmed"),
  nextWeekBooking(3, customers[2], maja, coloring, 1, "09:00", "confirmed", "Rada bi bolj hladen odtenek."),
  nextWeekBooking(4, customers[3], luka, kidsCut, 2, "15:30", "pending"),
  nextWeekBooking(5, customers[4], maja, treatment, 3, "11:00", "confirmed"),
];

// ---------- history: the last 12 weeks up to the end of this week ----------
// Generated with a fixed seed, so it is the same on every start. It only exists
// so that the calendar, customer history and analytics have something to show.

/** Small deterministic random number generator (LCG), values in [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function localInstant(day: string, minutes: number): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return fromZonedTime(`${day}T${hh}:${mm}:00`, TIMEZONE);
}

(function generateHistory() {
  const random = seededRandom(20260918);
  const now = new Date();
  const thisMonday = startOfWeek(toZonedTime(now, TIMEZONE), { weekStartsOn: 1 });
  let n = 100;

  for (let week = -12; week <= 0; week++) {
    for (let weekday = 0; weekday < 5; weekday++) {
      const day = format(addDays(thisMonday, week * 7 + weekday), "yyyy-MM-dd");

      for (const member of staff) {
        const offered = services.filter((s) =>
          staffServices.some((l) => l.staff_id === member.id && l.service_id === s.id),
        );
        let cursor = 9 * 60 + Math.floor(random() * 3) * 15; // minutes since midnight

        for (;;) {
          const what = offered[Math.floor(random() * offered.length)];
          const needed = what.duration_min + what.buffer_after_min;
          if (cursor + needed > 17 * 60) break;

          if (random() < 0.78) {
            const start = localInstant(day, cursor);
            let status: Booking["status"] = "confirmed";
            if (start < now) {
              const roll = random();
              status = roll < 0.82 ? "completed" : roll < 0.9 ? "no_show" : "cancelled";
            }
            // Skewed towards the first customers, so a few are regulars.
            const who = customers[Math.floor(random() ** 1.5 * customers.length)];
            bookings.push(makeBooking(n++, who, member, what, start, status));
            cursor += needed + Math.floor(random() * 3) * 15;
          } else {
            cursor += 15 * (1 + Math.floor(random() * 3));
          }
        }
      }
    }
  }
})();

/**
 * The fake "database". Arrays are mutable on purpose so that createBooking in
 * lib/data.ts can append to them. State lives in server memory only and resets
 * when the server restarts.
 */
export const mock = {
  salons: [salon],
  staff,
  services,
  staffServices,
  staffHours,
  timeOff,
  customers,
  bookings,
};
