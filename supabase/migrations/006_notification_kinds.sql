-- 006_notification_kinds.sql: messages that follow the salon's own actions (week 8).
--
-- Two new kinds in booking_notifications:
--   request      the "request received" e-mail of a booking that waits for the
--                salon (status pending). "confirmation" follows when the salon
--                confirms it. Before 006 the request e-mail was stored as
--                "confirmation", so the real confirmation could never be sent.
--   reschedule   "your booking was moved". A booking can be moved more than
--                once, so this kind is not unique per booking.
-- Every other kind stays at most once per booking and channel: the unique
-- constraint becomes a unique index that leaves out "reschedule".
--
-- One transaction: if a constraint name differs, nothing changes.

begin;

alter table booking_notifications drop constraint booking_notifications_kind_check;
alter table booking_notifications add constraint booking_notifications_kind_check
  check (kind in ('request', 'confirmation', 'reminder', 'reschedule', 'cancellation'));

alter table booking_notifications drop constraint booking_notifications_booking_id_kind_channel_key;
create unique index booking_notifications_once
  on booking_notifications (booking_id, kind, channel)
  where kind <> 'reschedule';

commit;
