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
