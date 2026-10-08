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
