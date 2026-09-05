-- Checkout termination is separate from administrator cancellation. Unpaid
-- direct-payment checkouts have queued no confirmation; send no cancellation
-- email. Preserve provider failure/submission history when closing a retry.
alter table private.payment_attempts add column checkout_abandoned_at timestamptz;

create function public.abandon_timed_payment_booking(
  p_booking_id uuid, p_payment_access_token text, p_attempt_id uuid
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
  selected_slot public.availability_slots%rowtype;
  owns_slot boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;

  -- Serialize against submission, restart, expiry and provider completion.
  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  if not found or not exists (
    select 1 from private.booking_payment_access access
    where access.booking_id = p_booking_id
      and access.token_hash = extensions.digest(p_payment_access_token, 'sha256')
  ) then
    raise exception using errcode = '42501', message = 'Payment access is invalid.';
  end if;
  if selected_booking.service_payment_flow_snapshot is distinct from 'direct_payment'
    or selected_booking.service_booking_mode_snapshot is distinct from 'timed'
    or selected_booking.payment_status is distinct from 'unpaid'
    or selected_booking.amount_paid is distinct from 0
    or selected_booking.slot_id is null
  then raise exception 'This booking cannot be abandoned.'; end if;

  select * into selected_attempt from private.payment_attempts
  where booking_id = selected_booking.id
  order by created_at desc, id desc limit 1 for update;
  if not found or selected_attempt.id is distinct from p_attempt_id
    or selected_attempt.provider is distinct from 'square'
    or exists (
      select 1 from private.payment_attempts
      where booking_id = selected_booking.id and id <> selected_attempt.id
        and status in ('reserved', 'processing', 'unknown')
    )
  then raise exception 'Payment attempt changed; recover payment status.'; end if;

  if selected_attempt.completed_at is not null or selected_attempt.provider_status = 'COMPLETED' then
    raise exception 'Completed payments cannot be abandoned.';
  end if;

  -- A lost response may be acknowledged without touching a slot that now
  -- belongs to another booking. The marker is private and preserves all
  -- provider failure codes, timestamps and payment IDs for audit/reconciliation.
  if selected_booking.status = 'cancelled'
    and selected_attempt.status = 'cancelled'
    and selected_attempt.checkout_abandoned_at is not null
  then return true; end if;

  -- The supported administrator lifecycle already cancelled this reservation
  -- and released its slot. Acknowledge its terminal state without writing an
  -- abandonment marker, payment evidence, timestamps, emails or availability.
  -- cancelled_at is set by that lifecycle; incomplete or submitted states
  -- cannot be inferred safe from the booking status alone.
  if selected_booking.status = 'cancelled'
    and selected_booking.cancelled_at is not null
    and selected_booking.paid_at is null
    and selected_booking.payment_reference is null
    and selected_attempt.status = 'cancelled'
    and selected_attempt.submitted_at is null
    and selected_attempt.provider_payment_id is null
    and selected_attempt.provider_location_id is null
    and selected_attempt.provider_status is null
    and not exists (
      select 1 from private.payment_attempts
      where booking_id = selected_booking.id and id <> selected_attempt.id
        and (completed_at is not null or (
          (status = 'failed' and failed_at is not null
            and provider_status in ('FAILED', 'CANCELED'))
          or (status in ('expired', 'cancelled') and submitted_at is null
            and provider_payment_id is null and provider_status is null)
        ) is not true)
    )
  then return true; end if;

  owns_slot := selected_booking.status = 'pending_payment';
  if owns_slot then
    if selected_attempt.status is distinct from 'reserved'
      or selected_attempt.submitted_at is not null
      or selected_attempt.provider_payment_id is not null
      or selected_attempt.provider_status is not null
    then raise exception 'Payment submission may have begun; recover payment status.'; end if;
  elsif selected_booking.status = 'payment_expired' then
    -- Expiry is safe only if never submitted. A failed submission is safe
    -- only with the definitive failure recorded by the provider lifecycle.
    if (
      (selected_attempt.status = 'expired'
        and selected_attempt.submitted_at is null
        and selected_attempt.provider_payment_id is null
        and selected_attempt.provider_status is null)
      or (selected_attempt.status = 'failed'
        and selected_attempt.failed_at is not null
        and selected_attempt.provider_status in ('FAILED', 'CANCELED'))
    ) is not true
    then raise exception 'No definitively closed payment attempt exists.'; end if;
  else
    raise exception 'This booking cannot be abandoned.';
  end if;

  select * into selected_slot from public.availability_slots
  where id = selected_booking.slot_id for update;
  if not found then raise exception 'The booking slot no longer exists.'; end if;
  if owns_slot and (selected_slot.is_available is distinct from false
    or exists (
      select 1 from public.bookings
      where slot_id = selected_booking.slot_id and id <> selected_booking.id
        and status in ('pending', 'pending_payment', 'confirmed', 'completed', 'no_show')
    ))
  then raise exception 'The booking no longer owns its reserved slot.'; end if;

  update private.payment_attempts
  set status = 'cancelled', checkout_abandoned_at = now(), updated_at = now()
  where id = selected_attempt.id;
  -- begin_payment_attempt and provider completion reject this terminal state.
  update public.bookings
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = selected_booking.id;
  -- Failed/expired attempts already released their slot. Never write its
  -- availability again: a replacement booking may already own it.
  if owns_slot then
    update public.availability_slots set is_available = true
    where id = selected_slot.id;
  end if;
  return true;
end;
$$;

alter function public.abandon_timed_payment_booking(uuid, text, uuid) owner to postgres;
revoke all on function public.abandon_timed_payment_booking(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.abandon_timed_payment_booking(uuid, text, uuid)
  to service_role;
