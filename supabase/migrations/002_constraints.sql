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
