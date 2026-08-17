-- Remove the temporary slot-first booking compatibility API after the
-- service-aware frontend has been fully deployed and stale frontend assets
-- are no longer in circulation.

drop function if exists public.create_booking_request(
  uuid,
  text,
  text,
  text,
  text
);
