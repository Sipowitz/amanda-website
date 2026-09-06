-- A terminal result belongs to an attempt, not automatically to its booking.
-- All lifecycle writers (including begin_payment_attempt) lock the booking
-- before changing/creating attempts. Keep that lock through the relevance
-- check and slot transition; no attempt writer can cross this decision.
create function private.expire_payment_booking_if_current(
  p_booking_id uuid, p_attempt_id uuid
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
  selected_slot public.availability_slots%rowtype;
begin
  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  select * into selected_attempt from private.payment_attempts
  where id = p_attempt_id and booking_id = p_booking_id for update;
  if selected_booking.id is null or selected_attempt.id is null
    or selected_booking.service_payment_flow_snapshot is distinct from 'direct_payment'
    or selected_booking.status is distinct from 'pending_payment'
    or selected_booking.payment_status is distinct from 'unpaid'
    or selected_booking.amount_paid is distinct from 0
    or selected_booking.paid_at is not null
    or selected_attempt.status not in ('failed', 'expired')
    or selected_attempt.completed_at is not null
    or selected_attempt.provider_status = 'COMPLETED'
  then return false; end if;

  -- Deterministic history ordering, plus fail-closed payment evidence even
  -- when transaction-start timestamps do not reflect insertion/commit order.
  if exists (
    select 1 from private.payment_attempts other
    where other.booking_id = selected_booking.id and other.id <> selected_attempt.id
      and ((other.created_at, other.id) > (selected_attempt.created_at, selected_attempt.id)
        or other.status in ('reserved', 'processing', 'unknown', 'completed')
        or other.completed_at is not null or other.provider_status = 'COMPLETED')
  ) then return false; end if;

  if selected_booking.service_booking_mode_snapshot = 'timed' then
    select * into selected_slot from public.availability_slots
    where id = selected_booking.slot_id for update;
    if not found then raise exception 'The booking slot no longer exists.'; end if;
    if selected_slot.is_available is distinct from false
      or exists (
        select 1 from public.bookings
        where slot_id = selected_booking.slot_id and id <> selected_booking.id
          and status in ('pending', 'pending_payment', 'confirmed', 'completed', 'no_show')
      )
    then raise exception 'The booking no longer safely owns its slot.'; end if;
  elsif selected_booking.slot_id is not null then
    raise exception 'An untimed booking cannot own a slot.';
  end if;

  update public.bookings set status = 'payment_expired', updated_at = now()
  where id = selected_booking.id;
  if selected_booking.service_booking_mode_snapshot = 'timed' then
    update public.availability_slots set is_available = true
    where id = selected_booking.slot_id;
  end if;
  return true;
end;
$$;
alter function private.expire_payment_booking_if_current(uuid, uuid) owner to postgres;
revoke all on function private.expire_payment_booking_if_current(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fail_payment_attempt(
  p_booking_id uuid, p_attempt_id uuid, p_provider_status text,
  p_failure_code text default null, p_failure_detail text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  select * into selected_booking from public.bookings where id = p_booking_id for update;
  select * into selected_attempt from private.payment_attempts
    where id = p_attempt_id and booking_id = p_booking_id for update;
  if selected_booking.id is null or selected_attempt.id is null then
    raise exception 'Payment attempt was not found.';
  end if;
  if selected_booking.service_payment_flow_snapshot <> 'direct_payment'
    or selected_booking.payment_status <> 'unpaid'
  then raise exception 'The booking is not awaiting a direct payment.';
  end if;
  if selected_attempt.status in ('completed', 'failed', 'expired', 'cancelled') then
    return false;
  end if;
  update private.payment_attempts set status = 'failed',
    provider_status = nullif(btrim(p_provider_status), ''),
    failure_code = left(nullif(btrim(p_failure_code), ''), 100),
    failure_detail = left(nullif(btrim(p_failure_detail), ''), 500),
    failed_at = now(), last_reconciled_at = now(), updated_at = now()
  where id = selected_attempt.id;
  perform private.expire_payment_booking_if_current(p_booking_id, p_attempt_id);
  return true;
end;
$$;

create or replace function public.record_provider_payment_result(
  p_provider text, p_event_id text, p_event_type text, p_booking_id uuid,
  p_attempt_id uuid, p_provider_payment_id text,
  p_provider_location_id text, p_provider_status text,
  p_amount_minor integer, p_currency text
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
  selected_slot public.availability_slots%rowtype;
  email_config public.booking_email_config%rowtype;
  inserted_event_id text;
  cleaned_payment_id text := nullif(btrim(p_provider_payment_id), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  if p_provider <> 'square' or p_booking_id is null or p_attempt_id is null
    or cleaned_payment_id is null or nullif(btrim(p_provider_location_id), '') is null
    or p_provider_status not in ('COMPLETED', 'FAILED', 'CANCELED')
  then raise exception 'A complete provider result is required.'; end if;

  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  select * into selected_attempt from private.payment_attempts
  where id = p_attempt_id and booking_id = p_booking_id for update;
  if selected_booking.id is null or selected_attempt.id is null
    or selected_attempt.provider <> p_provider
  then raise exception 'The payment is unrelated to this booking.'; end if;
  if selected_attempt.amount_minor <> p_amount_minor
    or selected_attempt.currency <> upper(p_currency)
    or selected_booking.service_price_amount_snapshot <> p_amount_minor
    or selected_booking.service_currency_snapshot <> upper(p_currency)
    or selected_booking.service_payment_flow_snapshot <> 'direct_payment'
    or selected_attempt.provider_location_id <> p_provider_location_id
  then raise exception 'Provider payment details do not match the booking.'; end if;
  if selected_attempt.provider_payment_id is not null
    and selected_attempt.provider_payment_id <> cleaned_payment_id
  then raise exception 'The payment attempt already belongs to another provider payment.'; end if;

  if nullif(btrim(p_event_id), '') is not null then
    insert into private.payment_webhook_events (
      provider, event_id, event_type, provider_payment_id
    ) values (p_provider, btrim(p_event_id), btrim(p_event_type), cleaned_payment_id)
    on conflict (provider, event_id) do nothing returning event_id into inserted_event_id;
    if inserted_event_id is null then return false; end if;
  end if;

  -- Never rewrite completed payment evidence with a delayed failure.
  if p_provider_status <> 'COMPLETED' and selected_attempt.status = 'completed' then
    if inserted_event_id is not null then
      update private.payment_webhook_events set processed_at = now()
      where provider = p_provider and event_id = btrim(p_event_id);
    end if;
    return false;
  end if;

  update private.payment_attempts set
    provider_payment_id = cleaned_payment_id,
    provider_status = p_provider_status,
    last_reconciled_at = now(), updated_at = now()
  where id = selected_attempt.id;

  if p_provider_status <> 'COMPLETED' then
    update private.payment_attempts set status = 'failed', failed_at = now()
      where id = selected_attempt.id;
    perform private.expire_payment_booking_if_current(p_booking_id, p_attempt_id);
    if inserted_event_id is not null then
      update private.payment_webhook_events set processed_at = now()
      where provider = p_provider and event_id = btrim(p_event_id);
    end if;
    return true;
  end if;

  if selected_booking.service_booking_mode_snapshot = 'timed' then
    if selected_booking.slot_id is null then
      raise exception 'The timed booking has no slot.';
    end if;
    select * into selected_slot from public.availability_slots
    where id = selected_booking.slot_id for update;
    if not found then raise exception 'The booking slot no longer exists.'; end if;
    if selected_slot.is_available is not false
      or exists (
        select 1 from public.bookings
        where slot_id = selected_booking.slot_id
          and id <> selected_booking.id
          and status in (
            'pending', 'pending_payment', 'confirmed', 'completed', 'no_show'
          )
      )
    then raise exception 'The booking no longer safely owns its slot.';
    end if;
  elsif selected_booking.slot_id is not null then
    raise exception 'An untimed booking cannot own a slot.';
  end if;

  if selected_booking.status = 'confirmed'
    and selected_booking.payment_status = 'paid'
    and selected_attempt.status = 'completed'
  then return false; end if;
  if selected_attempt.status not in ('processing', 'unknown')
    or selected_booking.status <> 'pending_payment'
    or selected_booking.payment_status <> 'unpaid'
  then raise exception 'The booking is not awaiting this direct payment.'; end if;

  select * into email_config from public.booking_email_config where id = true;
  if not found then raise exception 'Booking email configuration has not been created.'; end if;

  update public.bookings set status = 'confirmed', payment_status = 'paid',
    amount_paid = p_amount_minor::numeric / 100,
    paid_at = coalesce(paid_at, now()), payment_method = 'square',
    payment_reference = cleaned_payment_id,
    confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
  where id = selected_booking.id;
  update private.payment_attempts set status = 'completed',
    completed_at = coalesce(completed_at, now()), updated_at = now()
  where id = selected_attempt.id;

  perform public.queue_booking_email(
    selected_booking.id, 'booking_confirmed', selected_booking.customer_email,
    selected_booking.customer_name, jsonb_strip_nulls(jsonb_build_object(
      'booking_id', selected_booking.id,
      'customer_name', selected_booking.customer_name,
      'customer_email', selected_booking.customer_email,
      'service_name', selected_booking.service_name_snapshot,
      'service_booking_mode', selected_booking.service_booking_mode_snapshot,
      'service_currency', selected_booking.service_currency_snapshot,
      'slot_date', selected_slot.slot_date,
      'slot_time', selected_slot.slot_time,
      'direct_payment', true, 'payment_status', 'paid',
      'amount_due', p_amount_minor::numeric / 100,
      'amount_paid', p_amount_minor::numeric / 100
    ))
  );
  perform public.queue_booking_email(
    selected_booking.id, 'booking_request_admin', email_config.admin_email,
    email_config.admin_name, jsonb_strip_nulls(jsonb_build_object(
      'booking_id', selected_booking.id,
      'customer_name', selected_booking.customer_name,
      'customer_email', selected_booking.customer_email,
      'customer_phone', selected_booking.customer_phone,
      'customer_message', selected_booking.customer_message,
      'service_name', selected_booking.service_name_snapshot,
      'service_booking_mode', selected_booking.service_booking_mode_snapshot,
      'service_currency', selected_booking.service_currency_snapshot,
      'slot_date', selected_slot.slot_date,
      'slot_time', selected_slot.slot_time,
      'direct_payment', true, 'payment_status', 'paid',
      'amount_due', p_amount_minor::numeric / 100,
      'amount_paid', p_amount_minor::numeric / 100,
      'payment_method', 'square',
      'payment_reference', cleaned_payment_id
    ))
  );
  if inserted_event_id is not null then
    update private.payment_webhook_events set processed_at = now()
    where provider = p_provider and event_id = btrim(p_event_id);
  end if;
  return true;
end;
$$;

create or replace function private.expire_stale_reserved_payment_attempts()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  candidate record;
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
  expired_count integer := 0;
begin
  for candidate in
    select id, booking_id from private.payment_attempts
    where status = 'reserved' and submitted_at is null
      and created_at < now() - interval '1 hour'
  loop
    select * into selected_booking from public.bookings
    where id = candidate.booking_id for update;
    if not found then continue; end if;
    select * into selected_attempt from private.payment_attempts
    where id = candidate.id and booking_id = selected_booking.id for update;
    if not found or selected_attempt.status <> 'reserved'
      or selected_attempt.submitted_at is not null
      or selected_attempt.created_at >= now() - interval '1 hour'
      or selected_booking.status <> 'pending_payment'
      or selected_booking.payment_status <> 'unpaid'
    then continue; end if;
    update private.payment_attempts set status = 'expired', expired_at = now(),
      updated_at = now() where id = selected_attempt.id;
    perform private.expire_payment_booking_if_current(selected_booking.id, selected_attempt.id);
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

-- CREATE OR REPLACE retains existing grants; explicitly preserve the boundary.
alter function public.fail_payment_attempt(uuid,uuid,text,text,text) owner to postgres;
revoke all on function public.fail_payment_attempt(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.fail_payment_attempt(uuid,uuid,text,text,text) to service_role;
alter function public.record_provider_payment_result(text,text,text,uuid,uuid,text,text,text,integer,text) owner to postgres;
revoke all on function public.record_provider_payment_result(text,text,text,uuid,uuid,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.record_provider_payment_result(text,text,text,uuid,uuid,text,text,text,integer,text) to service_role;
alter function private.expire_stale_reserved_payment_attempts() owner to postgres;
revoke all on function private.expire_stale_reserved_payment_attempts() from public, anon, authenticated, service_role;
