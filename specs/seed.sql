-- =============================================================================
-- Demo data: the "Frizerstvo Test" salon, reachable at test.<ROOT_DOMAIN>.
--
-- Run AFTER specs/schema.sql:  psql "$DATABASE_URL" -f specs/seed.sql
-- (or paste into the Supabase SQL editor).
--
-- Rerunnable: every statement is guarded, so running it twice changes nothing.
--
-- The ids are the same deterministic ones lib/mock.ts used, so links that were
-- shared during phase 1 keep working.
--
-- This seeds only what a salon IS: staff, services, who does what, opening
-- hours. It deliberately creates no customers and no bookings — make those
-- through the booking page, so you exercise the real path.
-- =============================================================================

-- ---------- salon ----------

insert into salons (
  id, slug, name, phone, email, address, timezone, brand_color,
  slot_interval_min, min_lead_time_min, max_days_ahead,
  cancel_window_hours, require_confirmation, reminder_hours_before,
  subscription_status
) values (
  '00000001-0000-4000-8000-000000000001',
  'test',
  'Frizerstvo Test',
  '01 234 56 78',
  'salon@example.com',
  'Slovenska cesta 1, 1000 Ljubljana',
  'Europe/Ljubljana',
  '#0f766e',
  15, 120, 60, 24, false, 24,
  'trial'
) on conflict (id) do nothing;

-- ---------- staff ----------

insert into staff (id, salon_id, name, email, phone, color, is_active, sort_order)
values
  ('00000002-0000-4000-8000-000000000001',
   '00000001-0000-4000-8000-000000000001',
   'Maja Novak', 'maja@example.com', '031 000 111', '#6366f1', true, 1),
  ('00000002-0000-4000-8000-000000000002',
   '00000001-0000-4000-8000-000000000001',
   'Luka Kovač', 'luka@example.com', '031 000 222', '#f59e0b', true, 2)
on conflict (id) do nothing;

-- ---------- services ----------

insert into services (
  id, salon_id, name, description, category,
  duration_min, buffer_after_min, price_cents, is_active, sort_order
) values
  ('00000003-0000-4000-8000-000000000001',
   '00000001-0000-4000-8000-000000000001',
   'Moško striženje', 'Striženje s strojčkom ali škarjami, s pranjem.',
   'Striženje', 30, 0, 1800, true, 1),
  ('00000003-0000-4000-8000-000000000002',
   '00000001-0000-4000-8000-000000000001',
   'Žensko striženje', 'Svetovanje, pranje, striženje in feniranje.',
   'Striženje', 45, 5, 3200, true, 2),
  ('00000003-0000-4000-8000-000000000003',
   '00000001-0000-4000-8000-000000000001',
   'Otroško striženje', 'Za otroke do 12 let.',
   'Striženje', 30, 0, 1400, true, 3),
  ('00000003-0000-4000-8000-000000000004',
   '00000001-0000-4000-8000-000000000001',
   'Barvanje las', 'Barvanje korenin ali celotnih las, s feniranjem.',
   'Barvanje', 90, 10, 5500, true, 4),
  ('00000003-0000-4000-8000-000000000005',
   '00000001-0000-4000-8000-000000000001',
   'Globinska nega las', 'Maska in masaža lasišča za suhe ali poškodovane lase.',
   'Nega', 30, 0, 2000, true, 5)
on conflict (id) do nothing;

-- ---------- who performs what ----------
-- Maja does everything; Luka does everything except colouring.

insert into staff_services (staff_id, service_id, salon_id)
select st.id, sv.id, sv.salon_id
from staff st
join services sv on sv.salon_id = st.salon_id
where st.salon_id = '00000001-0000-4000-8000-000000000001'
  and not (st.name = 'Luka Kovač' and sv.name = 'Barvanje las')
on conflict (staff_id, service_id) do nothing;

-- ---------- weekly hours: Mon-Fri 09:00-17:00 for everyone ----------

insert into staff_hours (salon_id, staff_id, weekday, start_time, end_time)
select st.salon_id, st.id, d.weekday, time '09:00', time '17:00'
from staff st
cross join (values (1), (2), (3), (4), (5)) as d(weekday)
where st.salon_id = '00000001-0000-4000-8000-000000000001'
  and not exists (
    select 1 from staff_hours h
    where h.staff_id = st.id and h.weekday = d.weekday
  );

-- ---------- one absence, so the calendar has something to show ----------
-- Luka is away next Friday, in the salon's own timezone.

insert into time_off (salon_id, staff_id, starts_at, ends_at, reason)
select
  st.salon_id,
  st.id,
  ((date_trunc('week', (now() at time zone s.timezone)) + interval '1 week 4 days')
     at time zone s.timezone),
  ((date_trunc('week', (now() at time zone s.timezone)) + interval '1 week 5 days')
     at time zone s.timezone),
  'Dopust'
from staff st
join salons s on s.id = st.salon_id
where s.slug = 'test'
  and st.name = 'Luka Kovač'
  and not exists (
    select 1 from time_off t where t.staff_id = st.id and t.reason = 'Dopust'
  );
