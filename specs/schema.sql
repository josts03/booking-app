-- Shema baze za platformo naročanja (multi-tenant).
--
-- Resnica so migracije v supabase/migrations/; ta datoteka je njihova kopija
-- v enem kosu, za branje. Spremembe sheme: nova datoteka v supabase/migrations/
-- in ista sprememba tukaj. Preverja jih `npm test` (tests/db.test.ts).
--
-- Popravki glede na prvo verzijo (8. 10. 2026), v migracijah označeni s FIX/ADDED:
--  1. bookings.period: Postgres je stolpec zavrnil ("generation expression is
--     not immutable"), zato se tabela bookings sploh ni ustvarila. Zdaj
--     uporablja funkcijo add_minutes().
--  2. booking_notifications ima salon_id (pravilo: vsaka tabela ima salon_id).
--     rate_limits je edina izjema (globalna, samo service_role), zapisano v CLAUDE.md.
--  3. Anon ne bere staff.email, staff.phone, staff.user_id in time_off.reason
--     (pravice na stolpce). Urnike, dopuste in storitve zaposlenih vidi samo
--     za salone s statusom trial/active (prej using (true)).
--  4. Admin salona ne more spremeniti subscription_status, trial_ends_at, slug
--     in custom_domain (prej bi suspendiran salon lahko sam sebe vklopil).
--  5. Pravice (GRANT) so zdaj izrecne: anon in authenticated dobita samo, kar
--     rabita, service_role (strežnik) vse. Supabase od 30. 5. 2026 novim
--     tabelam ne da pravic samodejno; brez tega strežnik ne bi mogel brati.
--  6. Sestavljeni tuji ključi: termin, storitev, zaposleni in stranka morajo
--     biti iz istega salona, sicer baza zavrne (23503).
--  7. Preverjanja vrednosti: telefon stranke v zapisu E.164, slug kot poddomena,
--     barve #rrggbb, korak terminov 5-240 min, nenegativne cene in trajanja.
--  8. bookings.updated_at se posodobi ob vsaki spremembi (sprožilec).
--  9. btree_gist v shemi extensions, kot priporoča Supabase.
-- 10. 004: user_salon_ids() je v shemi private (API je ne more klicati), pravica
--     za klic Supabasove rls_auto_enable() je odvzeta. Security Advisor: 0 opozoril.



-- ============ 001_tables.sql ============

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

-- ============ 002_constraints.sql ============

-- 002_constraints.sql: rules the database enforces itself, whatever the code does.
-- Source: specs/schema.sql. Additions against the first version are marked "ADDED:".

-- ---------- no double booking ----------
-- Overlapping pending/confirmed bookings of the same staff member are rejected
-- with error 23P01. period includes the cleaning buffer. With two simultaneous
-- requests for the same time this is the only real protection: one insert wins.
alter table bookings add constraint bookings_no_overlap
  exclude using gist (staff_id with =, period with &&)
  where (status in ('pending','confirmed'));

-- ---------- indexes ----------
create index bookings_salon_time on bookings (salon_id, starts_at);
create index bookings_staff_time on bookings (staff_id, starts_at);
create index staff_hours_lookup on staff_hours (staff_id, weekday);
create index time_off_lookup on time_off (salon_id, starts_at, ends_at);
create index customers_salon on customers (salon_id);
create unique index customers_salon_phone
  on customers (salon_id, phone) where phone is not null;

-- ---------- ADDED: everything in a row belongs to the same salon ----------
-- A plain foreign key only checks that the staff member exists, not that it
-- works in the same salon as the booking. These composite keys make "a booking
-- in salon A with a staff member, service or customer of salon B" impossible
-- (error 23503), even if the code forgets to check (CLAUDE.md requires the
-- check in code as well).
alter table staff     add constraint staff_id_salon_key     unique (id, salon_id);
alter table services  add constraint services_id_salon_key  unique (id, salon_id);
alter table customers add constraint customers_id_salon_key unique (id, salon_id);
alter table bookings  add constraint bookings_id_salon_key  unique (id, salon_id);

alter table staff_services
  add constraint staff_services_staff_same_salon
    foreign key (staff_id, salon_id) references staff (id, salon_id) on delete cascade,
  add constraint staff_services_service_same_salon
    foreign key (service_id, salon_id) references services (id, salon_id) on delete cascade;

alter table staff_hours
  add constraint staff_hours_staff_same_salon
    foreign key (staff_id, salon_id) references staff (id, salon_id) on delete cascade;

-- A row with staff_id null (whole salon closed) is not checked, as intended.
alter table time_off
  add constraint time_off_staff_same_salon
    foreign key (staff_id, salon_id) references staff (id, salon_id) on delete cascade;

alter table bookings
  add constraint bookings_staff_same_salon
    foreign key (staff_id, salon_id) references staff (id, salon_id) on delete restrict,
  add constraint bookings_service_same_salon
    foreign key (service_id, salon_id) references services (id, salon_id) on delete restrict,
  add constraint bookings_customer_same_salon
    foreign key (customer_id, salon_id) references customers (id, salon_id) on delete restrict;

alter table booking_notifications
  add constraint booking_notifications_same_salon
    foreign key (booking_id, salon_id) references bookings (id, salon_id) on delete cascade;

alter table payments
  add constraint payments_booking_same_salon
    foreign key (booking_id, salon_id) references bookings (id, salon_id)
    on delete set null (booking_id);

-- ---------- ADDED: valid values ----------
-- Same pattern as SLUG_PATTERN in proxy.ts: every slug must work as a subdomain.
alter table salons add constraint salons_slug_format
  check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$');

-- Colors end up in CSS. Only #rrggbb is accepted (lib/brand.ts expects the same).
alter table salons add constraint salons_brand_color_format
  check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
alter table staff add constraint staff_color_format
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- slot_interval_min = 0 would make the free-slot engine loop forever.
alter table salons add constraint salons_booking_settings
  check (slot_interval_min between 5 and 240
     and min_lead_time_min >= 0
     and max_days_ahead between 1 and 365
     and cancel_window_hours >= 0
     and reminder_hours_before >= 0);

alter table services add constraint services_amounts
  check (buffer_after_min >= 0 and price_cents >= 0);
alter table bookings add constraint bookings_amounts
  check (buffer_min >= 0 and price_cents >= 0);
alter table payments add constraint payments_amount
  check (amount_cents > 0);

-- E.164 ("+38640123456"), see lib/phone.ts. With mixed formats the unique index
-- customers_salon_phone would let the same person in twice.
alter table customers add constraint customers_phone_e164
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

-- ---------- ADDED: bookings.updated_at follows every change ----------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger bookings_set_updated_at
  before update on bookings
  for each row execute function public.set_updated_at();

-- ============ 003_rls.sql ============

-- 003_rls.sql: who may read and write what.
-- Source: specs/schema.sql. Additions against the first version are marked "ADDED:".
--
-- Two layers, both always needed:
--   1. GRANT: which tables and columns a role may touch at all.
--   2. RLS policies: which rows.
-- Roles in Supabase:
--   anon           visitor without login (publishable key, the booking page)
--   authenticated  logged-in user (salon admin)
--   service_role   server only (secret key, lib/supabase/admin.ts); bypasses RLS

-- ---------- helper: the salons of the logged-in user ----------
create or replace function public.user_salon_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select salon_id from public.salon_users where user_id = auth.uid()
$$;
-- ADDED: only logged-in users need it (it is used in their policies).
revoke all on function public.user_salon_ids() from public, anon;
grant execute on function public.user_salon_ids() to authenticated;

-- ---------- RLS on every table, no exceptions ----------
alter table salons enable row level security;
alter table salon_users enable row level security;
alter table staff enable row level security;
alter table services enable row level security;
alter table staff_services enable row level security;
alter table staff_hours enable row level security;
alter table time_off enable row level security;
alter table customers enable row level security;
alter table bookings enable row level security;
alter table booking_notifications enable row level security;
alter table payments enable row level security;
alter table audit_log enable row level security;
alter table rate_limits enable row level security;

-- ---------- salon members: their own salon, nothing else ----------
create policy salon_rw on staff for all to authenticated
  using (salon_id in (select public.user_salon_ids()))
  with check (salon_id in (select public.user_salon_ids()));
create policy salon_rw on services for all to authenticated
  using (salon_id in (select public.user_salon_ids()))
  with check (salon_id in (select public.user_salon_ids()));
create policy salon_rw on staff_services for all to authenticated
  using (salon_id in (select public.user_salon_ids()))
  with check (salon_id in (select public.user_salon_ids()));
create policy salon_rw on staff_hours for all to authenticated
  using (salon_id in (select public.user_salon_ids()))
  with check (salon_id in (select public.user_salon_ids()));
create policy salon_rw on time_off for all to authenticated
  using (salon_id in (select public.user_salon_ids()))
  with check (salon_id in (select public.user_salon_ids()));
create policy salon_rw on customers for all to authenticated
  using (salon_id in (select public.user_salon_ids()))
  with check (salon_id in (select public.user_salon_ids()));
create policy salon_rw on bookings for all to authenticated
  using (salon_id in (select public.user_salon_ids()))
  with check (salon_id in (select public.user_salon_ids()));
create policy salon_rw on booking_notifications for all to authenticated
  using (salon_id in (select public.user_salon_ids()))
  with check (salon_id in (select public.user_salon_ids()));
create policy salon_rw on payments for all to authenticated
  using (salon_id in (select public.user_salon_ids()))
  with check (salon_id in (select public.user_salon_ids()));

create policy salon_read on salons for select to authenticated
  using (id in (select public.user_salon_ids()));
create policy salon_update on salons for update to authenticated
  using (id in (select public.user_salon_ids()))
  with check (id in (select public.user_salon_ids()));

create policy own_membership on salon_users for select to authenticated
  using (user_id = auth.uid());

-- ---------- visitors (anon): only what booking needs, only of open salons ----------
-- The public pages read with the publishable key and no user session, so a logged-in
-- salon admin sees other salons' booking pages like any visitor.
create policy public_read_salon on salons for select to anon
  using (subscription_status in ('trial','active'));
create policy public_read_services on services for select to anon
  using (is_active and salon_id in
    (select id from salons where subscription_status in ('trial','active')));
create policy public_read_staff on staff for select to anon
  using (is_active and salon_id in
    (select id from salons where subscription_status in ('trial','active')));
-- ADDED: the spec had "using (true)" on the next three, which exposed the
-- data of suspended salons too.
create policy public_read_staff_services on staff_services for select to anon
  using (salon_id in
    (select id from salons where subscription_status in ('trial','active')));
create policy public_read_hours on staff_hours for select to anon
  using (salon_id in
    (select id from salons where subscription_status in ('trial','active')));
create policy public_read_timeoff on time_off for select to anon
  using (salon_id in
    (select id from salons where subscription_status in ('trial','active')));

-- IMPORTANT: customers, bookings, booking_notifications, payments, audit_log and
-- rate_limits get NO anon policy. Bookings are created in a server action with
-- the service_role key.

-- ---------- ADDED: table and column privileges ----------
-- Older Supabase projects grant everything on new tables to anon and
-- authenticated (RLS is then the only barrier); projects created after
-- 30. 5. 2026 grant nothing, not even to service_role. Either way: start from
-- nothing and grant exactly what is needed.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- service_role (the server, secret key): every table. RLS does not apply to it.
-- Without this the booking server action fails with "permission denied" on a
-- new project.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- anon: read only. On staff and time_off only the columns the booking page needs.
-- Not readable: staff.email, staff.phone, staff.user_id (personal data) and
-- time_off.reason (can reveal health, e.g. sick leave).
grant select on salons, services, staff_services, staff_hours to anon;
grant select (id, salon_id, name, color, is_active, sort_order) on staff to anon;
grant select (id, salon_id, staff_id, starts_at, ends_at) on time_off to anon;

-- authenticated: their salon's data (RLS decides which rows).
grant select, insert, update, delete on
  staff, services, staff_services, staff_hours, time_off,
  customers, bookings, booking_notifications, payments
  to authenticated;
grant select on salon_users to authenticated;
grant select on salons to authenticated;
-- Salon settings yes. slug, custom_domain, subscription_status and trial_ends_at
-- no: only the platform owner (service_role) changes those, otherwise a
-- suspended salon could switch itself back on or extend its trial.
grant update (name, phone, email, address, timezone, logo_url, brand_color,
  slot_interval_min, min_lead_time_min, max_days_ahead, cancel_window_hours,
  require_confirmation, reminder_hours_before) on salons to authenticated;
-- audit_log and rate_limits: no privileges at all, service_role only.

-- Tables from later migrations start with no privileges for anon and
-- authenticated. Grant them explicitly (to service_role too), together with
-- their RLS policies.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ============ 004_private_helpers.sql ============

-- 004_private_helpers.sql: no SECURITY DEFINER function callable through the API.
-- Fixes the three Security Advisor warnings after 001-003.
--
-- Supabase exposes the public schema through its Data API, so every function in
-- public that a role may execute can be called as /rest/v1/rpc/<name>. Helper
-- functions used by RLS policies belong in a schema the API does not expose.

-- ---------- user_salon_ids() moves from public to private ----------
create schema if not exists private;
-- Logged-in users need the schema and the function: their RLS policies call it.
-- The API cannot reach it, because "private" is not an exposed schema.
grant usage on schema private to authenticated;

create function private.user_salon_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select salon_id from public.salon_users where user_id = auth.uid()
$$;
revoke all on function private.user_salon_ids() from public, anon;
grant execute on function private.user_salon_ids() to authenticated;

-- The same policies as in 003_rls.sql, now calling the private function.
alter policy salon_rw on staff
  using (salon_id in (select private.user_salon_ids()))
  with check (salon_id in (select private.user_salon_ids()));
alter policy salon_rw on services
  using (salon_id in (select private.user_salon_ids()))
  with check (salon_id in (select private.user_salon_ids()));
alter policy salon_rw on staff_services
  using (salon_id in (select private.user_salon_ids()))
  with check (salon_id in (select private.user_salon_ids()));
alter policy salon_rw on staff_hours
  using (salon_id in (select private.user_salon_ids()))
  with check (salon_id in (select private.user_salon_ids()));
alter policy salon_rw on time_off
  using (salon_id in (select private.user_salon_ids()))
  with check (salon_id in (select private.user_salon_ids()));
alter policy salon_rw on customers
  using (salon_id in (select private.user_salon_ids()))
  with check (salon_id in (select private.user_salon_ids()));
alter policy salon_rw on bookings
  using (salon_id in (select private.user_salon_ids()))
  with check (salon_id in (select private.user_salon_ids()));
alter policy salon_rw on booking_notifications
  using (salon_id in (select private.user_salon_ids()))
  with check (salon_id in (select private.user_salon_ids()));
alter policy salon_rw on payments
  using (salon_id in (select private.user_salon_ids()))
  with check (salon_id in (select private.user_salon_ids()));
alter policy salon_read on salons
  using (id in (select private.user_salon_ids()));
alter policy salon_update on salons
  using (id in (select private.user_salon_ids()))
  with check (id in (select private.user_salon_ids()));

-- No policy uses the public version any more.
drop function public.user_salon_ids();

-- ---------- Supabase's rls_auto_enable() ----------
-- Created by Supabase when "Enable automatic RLS" is on: an event trigger that
-- turns on RLS for every new table. It runs as a trigger and keeps working
-- without anyone having EXECUTE on it, so the API roles do not need it.
-- Only present on projects with that option, hence the check.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
