-- =============================================================================
-- Termin: spletno naročanje za salone
-- Postgres / Supabase schema. Mirrors lib/types.ts field for field.
--
-- Run order: extensions -> enums -> tables -> indexes -> triggers -> RLS.
-- Safe to run on an empty database:  psql "$DATABASE_URL" -f specs/schema.sql
--
-- RULES THIS SCHEMA ENFORCES (so the application cannot get them wrong):
--   * every row belongs to exactly one salon (salon_id everywhere)
--   * two bookings of the same staff member can never overlap (EXCLUDE)
--   * a booking's staff, service and customer must belong to the same salon
--   * prices, durations and windows stay inside the ranges lib/data.ts checks
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "btree_gist"; -- uuid + range in one EXCLUDE

-- ============================ enums =========================================

do $$ begin
  create type booking_status as enum
    ('pending', 'confirmed', 'cancelled', 'no_show', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum
    ('trial', 'active', 'past_due', 'suspended', 'cancelled');
exception when duplicate_object then null; end $$;

-- ============================ salons ========================================

create table if not exists salons (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  custom_domain         text unique,
  name                  text not null,
  phone                 text,
  email                 text,
  address               text,
  timezone              text not null default 'Europe/Ljubljana',
  logo_url              text,
  brand_color           text,
  slot_interval_min     integer not null default 15,
  min_lead_time_min     integer not null default 120,
  max_days_ahead        integer not null default 60,
  cancel_window_hours   integer not null default 24,
  require_confirmation  boolean not null default false,
  reminder_hours_before integer not null default 24,
  subscription_status   subscription_status not null default 'trial',
  trial_ends_at         timestamptz default (now() + interval '14 days'),
  created_at            timestamptz not null default now(),

  -- Same rule as SLUG_RULE in lib/data.ts and proxy.ts.
  constraint salons_slug_shape check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint salons_slug_length check (char_length(slug) between 3 and 40),
  -- Subdomains the platform keeps (RESERVED_SLUGS in lib/data.ts).
  constraint salons_slug_not_reserved check (slug not in (
    'www', 'admin', 'api', 'app', 'mail', 'smtp', 'ftp', 'cdn', 'static',
    'assets', 'blog', 'docs', 'help', 'support', 'status', 'dashboard',
    'login', 'signup', 'prijava', 'registracija', 'rezervacija', 'cenik',
    'demo', 'test-salon'
  )),
  constraint salons_name_length    check (char_length(name) between 2 and 80),
  constraint salons_brand_color    check (brand_color is null or brand_color ~* '^#[0-9a-f]{6}$'),
  constraint salons_slot_interval  check (slot_interval_min between 5 and 60),
  constraint salons_lead_time      check (min_lead_time_min between 0 and 10080),
  constraint salons_days_ahead     check (max_days_ahead between 1 and 365),
  constraint salons_cancel_window  check (cancel_window_hours between 0 and 168),
  constraint salons_reminder       check (reminder_hours_before between 0 and 168)
);

-- ============================ staff =========================================

create table if not exists staff (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references salons(id) on delete cascade,
  -- The owner's / employee's login. NULL = in the calendar but cannot sign in.
  user_id    uuid unique references auth.users(id) on delete set null,
  name       text not null,
  email      text,
  phone      text,
  color      text,
  is_active  boolean not null default true,
  sort_order integer not null default 0,

  constraint staff_name_length check (char_length(name) between 1 and 80),
  constraint staff_color_shape check (color is null or color ~* '^#[0-9a-f]{6}$')
);

create index if not exists staff_salon_idx on staff (salon_id, sort_order);

-- Needed by the composite foreign keys in staff_services, staff_hours,
-- time_off and bookings: they prove staff and row share one salon.
do $$ begin
  alter table staff add constraint staff_id_salon_key unique (id, salon_id);
exception when duplicate_table or duplicate_object then null; end $$;

-- ============================ services ======================================

create table if not exists services (
  id               uuid primary key default gen_random_uuid(),
  salon_id         uuid not null references salons(id) on delete cascade,
  name             text not null,
  description      text,
  category         text,
  duration_min     integer not null,
  buffer_after_min integer not null default 0,
  price_cents      integer not null,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,

  constraint services_name_length check (char_length(name) between 1 and 80),
  constraint services_duration    check (duration_min between 5 and 600),
  constraint services_buffer      check (buffer_after_min between 0 and 240),
  constraint services_price       check (price_cents between 0 and 1000000)
);

create index if not exists services_salon_idx on services (salon_id, sort_order);

do $$ begin
  alter table services add constraint services_id_salon_key unique (id, salon_id);
exception when duplicate_table or duplicate_object then null; end $$;

-- ============================ staff_services ================================
-- Who performs what. salon_id is repeated so the composite foreign keys below
-- can prove that staff and service belong to the SAME salon.

create table if not exists staff_services (
  staff_id   uuid not null,
  service_id uuid not null,
  salon_id   uuid not null references salons(id) on delete cascade,

  primary key (staff_id, service_id),
  foreign key (staff_id, salon_id)   references staff (id, salon_id)    on delete cascade,
  foreign key (service_id, salon_id) references services (id, salon_id) on delete cascade
);

create index if not exists staff_services_service_idx on staff_services (service_id);

-- ============================ staff_hours ===================================
-- The weekly schedule, in the salon's own wall-clock time (never UTC).

create table if not exists staff_hours (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references salons(id) on delete cascade,
  staff_id   uuid not null,
  weekday    smallint not null,  -- 0 = Sunday ... 6 = Saturday
  start_time time not null,
  end_time   time not null,

  foreign key (staff_id, salon_id) references staff (id, salon_id) on delete cascade,
  constraint staff_hours_weekday check (weekday between 0 and 6),
  constraint staff_hours_order   check (start_time < end_time)
);

create index if not exists staff_hours_staff_idx on staff_hours (staff_id, weekday);

-- ============================ time_off ======================================
-- staff_id NULL = the whole salon is closed (holiday, renovation).

create table if not exists time_off (
  id        uuid primary key default gen_random_uuid(),
  salon_id  uuid not null references salons(id) on delete cascade,
  staff_id  uuid,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  reason    text,

  foreign key (staff_id, salon_id) references staff (id, salon_id) on delete cascade,
  constraint time_off_order check (starts_at < ends_at)
);

create index if not exists time_off_salon_idx on time_off (salon_id, starts_at, ends_at);

-- ============================ customers =====================================
-- A customer belongs to one salon: two salons never share a customer row.

create table if not exists customers (
  id                uuid primary key default gen_random_uuid(),
  salon_id          uuid not null references salons(id) on delete cascade,
  first_name        text not null,
  last_name         text,
  phone             text,
  email             text,
  notes             text,
  marketing_consent boolean not null default false,
  -- GDPR erasure: personal columns are cleared, the row stays so the salon's
  -- history and numbers remain correct (see anonymizeCustomer in lib/data.ts).
  anonymized_at     timestamptz,
  created_at        timestamptz not null default now(),

  constraint customers_first_name check (char_length(first_name) between 1 and 80)
);

-- One phone number identifies a returning customer within a salon.
create unique index if not exists customers_salon_phone_key
  on customers (salon_id, phone) where phone is not null and anonymized_at is null;

create index if not exists customers_salon_idx on customers (salon_id, created_at desc);

do $$ begin
  alter table customers add constraint customers_id_salon_key unique (id, salon_id);
exception when duplicate_table or duplicate_object then null; end $$;

-- ============================ bookings ======================================

create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  salon_id      uuid not null references salons(id) on delete cascade,
  staff_id      uuid not null,
  service_id    uuid not null,
  customer_id   uuid not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  buffer_min    integer not null default 0,
  status        booking_status not null default 'confirmed',
  -- Copied from services.price_cents when the booking is made, so a later price
  -- change never rewrites history.
  price_cents   integer not null,
  customer_note text,
  internal_note text,
  source        text not null default 'web',
  cancel_token  uuid not null default gen_random_uuid() unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The slot the chair is actually occupied for: the service plus its cleanup.
  period tstzrange generated always as (
    tstzrange(starts_at, ends_at + make_interval(mins => buffer_min), '[)')
  ) stored,

  -- Everything on a booking must belong to the same salon.
  foreign key (staff_id, salon_id)    references staff (id, salon_id),
  foreign key (service_id, salon_id)  references services (id, salon_id),
  foreign key (customer_id, salon_id) references customers (id, salon_id),

  constraint bookings_order  check (starts_at < ends_at),
  constraint bookings_buffer check (buffer_min between 0 and 240),
  constraint bookings_price  check (price_cents between 0 and 1000000),

  -- THE important one: one staff member, one chair, one customer at a time.
  -- A cancelled booking frees its slot. Violating this raises SQLSTATE 23P01,
  -- which the server action turns into "Ta termin je bil pravkar zaseden."
  constraint bookings_no_overlap exclude using gist (
    staff_id with =,
    period   with &&
  ) where (status <> 'cancelled')
);

create index if not exists bookings_salon_time_idx on bookings (salon_id, starts_at);
create index if not exists bookings_customer_idx   on bookings (customer_id, starts_at desc);
create index if not exists bookings_staff_time_idx on bookings (staff_id, starts_at);

-- ============================ triggers ======================================

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists bookings_updated_at on bookings;
create trigger bookings_updated_at
  before update on bookings
  for each row execute function set_updated_at();

-- ============================ row level security ============================
-- Two kinds of caller:
--   * anon      - the public booking page. Reads what a visitor must see and
--                 creates bookings only through the server action.
--   * staff     - a signed-in member of THAT salon (staff.user_id = auth.uid()).

/** True when the signed-in user works at this salon. */
create or replace function is_salon_member(target_salon uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff
    where staff.salon_id = target_salon
      and staff.user_id = auth.uid()
      and staff.is_active
  );
$$;

alter table salons         enable row level security;
alter table staff          enable row level security;
alter table services       enable row level security;
alter table staff_services enable row level security;
alter table staff_hours    enable row level security;
alter table time_off       enable row level security;
alter table customers      enable row level security;
alter table bookings       enable row level security;

-- --- public reads: only what the booking page needs ---

drop policy if exists salons_public_read on salons;
create policy salons_public_read on salons
  for select using (subscription_status in ('trial', 'active'));

drop policy if exists services_public_read on services;
create policy services_public_read on services
  for select using (is_active);

drop policy if exists staff_public_read on staff;
create policy staff_public_read on staff
  for select using (is_active);

drop policy if exists staff_services_public_read on staff_services;
create policy staff_services_public_read on staff_services
  for select using (true);

drop policy if exists staff_hours_public_read on staff_hours;
create policy staff_hours_public_read on staff_hours
  for select using (true);

drop policy if exists time_off_public_read on time_off;
create policy time_off_public_read on time_off
  for select using (true);

-- --- the salon's own people: full access to their salon, nothing else ---

drop policy if exists salons_member_all on salons;
create policy salons_member_all on salons
  for all using (is_salon_member(id)) with check (is_salon_member(id));

drop policy if exists staff_member_all on staff;
create policy staff_member_all on staff
  for all using (is_salon_member(salon_id)) with check (is_salon_member(salon_id));

drop policy if exists services_member_all on services;
create policy services_member_all on services
  for all using (is_salon_member(salon_id)) with check (is_salon_member(salon_id));

drop policy if exists staff_services_member_all on staff_services;
create policy staff_services_member_all on staff_services
  for all using (is_salon_member(salon_id)) with check (is_salon_member(salon_id));

drop policy if exists staff_hours_member_all on staff_hours;
create policy staff_hours_member_all on staff_hours
  for all using (is_salon_member(salon_id)) with check (is_salon_member(salon_id));

drop policy if exists time_off_member_all on time_off;
create policy time_off_member_all on time_off
  for all using (is_salon_member(salon_id)) with check (is_salon_member(salon_id));

drop policy if exists customers_member_all on customers;
create policy customers_member_all on customers
  for all using (is_salon_member(salon_id)) with check (is_salon_member(salon_id));

drop policy if exists bookings_member_all on bookings;
create policy bookings_member_all on bookings
  for all using (is_salon_member(salon_id)) with check (is_salon_member(salon_id));

-- NOTE: customers and bookings have NO public policy on purpose. A visitor
-- never reads them directly; the booking form and the cancel link go through
-- server code holding the service role key, which bypasses RLS. Never ship
-- that key to the browser (see .env.example).
