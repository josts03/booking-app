-- 001_tables.sql: types, tables and one helper function.
-- Source: specs/schema.sql. Constraints and indexes: 002. Row level security: 003.
-- Changes against the first version of the spec are marked with "FIX:".

create schema if not exists extensions;
-- For the exclusion constraint on bookings (gist index with uuid "="). Supabase
-- keeps extensions in their own schema, not in public.
create extension if not exists btree_gist with schema extensions;

create type booking_status as enum
  ('pending','confirmed','cancelled','no_show','completed');
create type subscription_status as enum
  ('trial','active','past_due','suspended','cancelled');

create table salons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  custom_domain text unique,
  name text not null,
  phone text, email text, address text,
  timezone text not null default 'Europe/Ljubljana',
  logo_url text, brand_color text default '#111111',
  -- booking settings
  slot_interval_min int not null default 15,
  min_lead_time_min int not null default 120,
  max_days_ahead int not null default 60,
  cancel_window_hours int not null default 24,
  require_confirmation boolean not null default false,
  reminder_hours_before int not null default 24,
  -- subscription
  subscription_status subscription_status not null default 'trial',
  trial_ends_at timestamptz default now() + interval '14 days',
  created_at timestamptz not null default now()
);

create table salon_users (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'owner' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  unique (salon_id, user_id)
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons on delete cascade,
  user_id uuid references auth.users on delete set null,
  name text not null, email text, phone text,
  color text default '#6366f1',
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons on delete cascade,
  name text not null, description text, category text,
  duration_min int not null check (duration_min between 5 and 600),
  buffer_after_min int not null default 0,
  price_cents int not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table staff_services (
  staff_id uuid not null references staff on delete cascade,
  service_id uuid not null references services on delete cascade,
  salon_id uuid not null references salons on delete cascade,
  primary key (staff_id, service_id)
);

create table staff_hours (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons on delete cascade,
  staff_id uuid not null references staff on delete cascade,
  weekday int not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time time not null,  -- local wall-clock time in salons.timezone
  end_time time not null,
  check (end_time > start_time)
);

create table time_off (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons on delete cascade,
  staff_id uuid references staff on delete cascade,  -- null = whole salon closed
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons on delete cascade,
  first_name text not null, last_name text,
  phone text, email text,  -- phone in E.164, see 002 (customers_phone_e164)
  notes text,
  marketing_consent boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now()
);

-- FIX: ts + whole minutes. Postgres marks "timestamptz + interval" only STABLE
-- (an interval in days or months depends on the time zone), and a generated
-- column needs an IMMUTABLE expression, so the spec's bookings.period was
-- rejected ("generation expression is not immutable"). Whole minutes never
-- depend on the time zone, so this wrapper really is immutable.
create function public.add_minutes(ts timestamptz, mins int)
returns timestamptz
language sql immutable parallel safe
set search_path = ''
as $$ select ts + make_interval(mins => mins) $$;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons on delete cascade,
  staff_id uuid not null references staff on delete restrict,
  service_id uuid not null references services on delete restrict,
  customer_id uuid not null references customers on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,  -- what the customer sees, without the buffer
  buffer_min int not null default 0,
  status booking_status not null default 'confirmed',
  price_cents int not null default 0,
  customer_note text, internal_note text,
  source text not null default 'online',
  cancel_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Time the staff member is busy: the booking plus the cleaning buffer.
  period tstzrange generated always as
    (tstzrange(starts_at, public.add_minutes(ends_at, buffer_min), '[)')) stored
);

create table booking_notifications (
  id uuid primary key default gen_random_uuid(),
  -- FIX: salon_id, like every other salon table (CLAUDE.md), so RLS can use it.
  salon_id uuid not null references salons on delete cascade,
  booking_id uuid not null references bookings on delete cascade,
  kind text not null check (kind in ('confirmation','reminder','cancellation')),
  channel text not null default 'email',
  status text not null default 'sent',
  provider_id text,
  sent_at timestamptz not null default now(),
  unique (booking_id, kind, channel)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons on delete cascade,
  booking_id uuid references bookings on delete set null,
  kind text not null check (kind in ('deposit','full')),
  amount_cents int not null,
  provider text, provider_ref text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  salon_id uuid references salons on delete cascade,  -- null = platform-level action
  actor_user_id uuid,
  action text not null, entity text not null, entity_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- The one table without salon_id (CLAUDE.md lists the exception): limits are
-- counted per IP or phone number across all salons. service_role only.
create table rate_limits (
  id bigserial primary key,
  bucket text not null,          -- e.g. 'ip:1.2.3.4' or 'phone:+38640123456'
  window_start timestamptz not null,
  count int not null default 1,
  unique (bucket, window_start)
);
