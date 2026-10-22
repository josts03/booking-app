-- 007_salon_settings_and_hours.sql: week 9 (staff, hours, salon settings).
--
-- 1. salons.confirmation_note: the salon's own sentence in the confirmation
--    e-mail (e.g. "Parkirate lahko za hišo."). Public on purpose, like the
--    salon's address: anon may read salons (003_rls.sql).
-- 2. replace_staff_hours(): replaces one staff member's whole week in ONE
--    statement, so a failure never leaves half the old and half the new week.
--    SECURITY INVOKER (not DEFINER: CLAUDE.md), callable only by service_role,
--    which the server uses after checking that the user owns the salon.
--
-- One transaction: if anything fails, nothing changes.

begin;

alter table salons add column confirmation_note text;
alter table salons add constraint salons_confirmation_note_length
  check (confirmation_note is null or length(confirmation_note) <= 500);
-- Like the other salon settings in 003_rls.sql.
grant update (confirmation_note) on salons to authenticated;

create function public.replace_staff_hours(p_salon_id uuid, p_staff_id uuid, p_hours jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.staff where id = p_staff_id and salon_id = p_salon_id) then
    raise exception 'staff member is not in this salon' using errcode = '23503';
  end if;
  delete from public.staff_hours where salon_id = p_salon_id and staff_id = p_staff_id;
  insert into public.staff_hours (salon_id, staff_id, weekday, start_time, end_time)
  select p_salon_id, p_staff_id, (h ->> 'weekday')::int, (h ->> 'start_time')::time, (h ->> 'end_time')::time
  from jsonb_array_elements(p_hours) as h;
end
$$;

revoke all on function public.replace_staff_hours(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_staff_hours(uuid, uuid, jsonb) to service_role;

commit;
