-- Admin capability for provider-managed direct-payment lifecycle states.
-- This migration does not activate any service or alter historical snapshots.

create function public.get_admin_direct_payment_states()
returns table (
  booking_id uuid,
  provider text,
  attempt_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  return query
  select
    booking.id,
    attempt.provider,
    attempt.status
  from public.bookings as booking
  left join lateral (
    select payment_attempt.provider, payment_attempt.status
    from private.payment_attempts as payment_attempt
    where payment_attempt.booking_id = booking.id
    order by payment_attempt.created_at desc
    limit 1
  ) as attempt on true
  where booking.service_payment_flow_snapshot = 'direct_payment';
end;
$$;

alter function public.get_admin_direct_payment_states() owner to postgres;
revoke all on function public.get_admin_direct_payment_states()
  from public, anon;
grant execute on function public.get_admin_direct_payment_states()
  to authenticated, service_role;

comment on function public.get_admin_direct_payment_states() is
  'Admin-only provider and lifecycle status; excludes attempt IDs, tokens, idempotency keys and provider payloads.';

-- A direct-payment cancellation is valid only while its latest attempt is a
-- never-submitted reservation. Booking cancellation, attempt cancellation,
-- timed-slot release and the existing cancellation email share one transaction.
create or replace function public.cancel_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
begin
  perform private.require_admin();

  select * into selected_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  if selected_booking.service_payment_flow_snapshot <> 'direct_payment' then
    return private.cancel_booking(p_booking_id);
  end if;

  if selected_booking.status <> 'pending_payment'
    or selected_booking.payment_status <> 'unpaid'
  then
    raise exception 'Only an awaiting direct-payment checkout can be cancelled.';
  end if;

  select * into selected_attempt
  from private.payment_attempts
  where booking_id = selected_booking.id
  order by created_at desc
  limit 1
  for update;

  if not found
    or selected_attempt.provider <> 'square'
    or selected_attempt.status <> 'reserved'
    or selected_attempt.submitted_at is not null
  then
    raise exception 'Direct-payment bookings cannot be cancelled after payment submission begins.';
  end if;

  update private.payment_attempts
  set status = 'cancelled', updated_at = now()
  where id = selected_attempt.id;

  return private.cancel_booking(p_booking_id);
end;
$$;

-- Provider-managed bookings cannot be resurrected or manually confirmed.
-- Only a settled Square booking may progress to the ordinary terminal
-- appointment outcomes.
create or replace function public.update_booking_status(
  p_booking_id uuid,
  p_status text
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
begin
  perform private.require_admin();

  select * into selected_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  if selected_booking.service_payment_flow_snapshot <> 'direct_payment' then
    return private.update_booking_status(p_booking_id, p_status);
  end if;

  select * into selected_attempt
  from private.payment_attempts
  where booking_id = selected_booking.id
  order by created_at desc
  limit 1;

  if selected_booking.status <> 'confirmed'
    or selected_booking.payment_status <> 'paid'
    or selected_booking.payment_method <> 'square'
    or selected_attempt.provider <> 'square'
    or selected_attempt.status <> 'completed'
    or p_status not in ('completed', 'no_show')
  then
    raise exception 'The payment provider controls this booking until Square payment is settled.';
  end if;

  return private.update_booking_status(p_booking_id, p_status);
end;
$$;

alter function public.cancel_booking(uuid) owner to postgres;
alter function public.update_booking_status(uuid, text) owner to postgres;
revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.update_booking_status(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid)
  to authenticated, service_role;
grant execute on function public.update_booking_status(uuid, text)
  to authenticated, service_role;
