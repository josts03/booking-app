-- 005_booking_contact_email.sql: the e-mail address given with a booking.
--
-- Messages about a booking (confirmation, reminder, cancellation) go to the
-- e-mail typed in for THAT booking. The customer row, found by phone number,
-- is never changed from the public form (lib/data.ts findOrCreateCustomer), so:
-- - a returning customer who types a new e-mail still gets the messages, and
-- - someone who only knows a phone number cannot change that person's e-mail.
-- Null for bookings without one (older bookings, phone bookings entered by the
-- salon): those use customers.email.
--
-- Personal data: anonymizing a customer must clear it on their bookings too
-- (specs/security.md).

alter table bookings add column contact_email text;

-- A backstop only: the server action checks the address properly (Zod).
alter table bookings add constraint bookings_contact_email_format
  check (contact_email is null
     or (length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

-- Privileges: anon has none on bookings (003_rls.sql). authenticated and
-- service_role have table-wide privileges there, which include a new column.
