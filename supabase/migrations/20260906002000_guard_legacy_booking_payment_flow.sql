-- Close the legacy RPC bypass without changing historical bookings or grants.
-- New legacy bookings snapshot the locked service payment flow explicitly.
create or replace function public.create_booking_request(
  p_service_id uuid,
  p_slot_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default null,
  p_customer_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_service public.services%rowtype;
  selected_slot public.availability_slots%rowtype;
  email_config public.booking_email_config%rowtype;
  new_booking_id uuid;
  cleaned_customer_name text;
  cleaned_customer_email text;
  cleaned_customer_phone text;
  cleaned_customer_message text;
  booking_amount_due numeric;
begin
  if p_service_id is null then
    raise exception 'A service is required.';
  end if;

  cleaned_customer_name := nullif(btrim(p_customer_name), '');
  cleaned_customer_email := lower(nullif(btrim(p_customer_email), ''));
  cleaned_customer_phone := nullif(btrim(p_customer_phone), '');
  cleaned_customer_message := nullif(btrim(p_customer_message), '');

  if cleaned_customer_name is null then
    raise exception 'Customer name is required.';
  end if;

  if cleaned_customer_email is null then
    raise exception 'Customer email is required.';
  end if;

  select *
  into selected_service
  from public.services
  where id = p_service_id
  for share;

  if not found then
    raise exception 'The selected service does not exist.';
  end if;

  if selected_service.is_active is not true then
    raise exception 'The selected service is not currently available.';
  end if;

  -- The service row remains share-locked through snapshot creation. A caller
  -- cannot route a direct-payment service through the legacy reservation path.
  if selected_service.payment_flow = 'direct_payment' then
    raise exception 'Direct-payment services require the direct-payment checkout.';
  end if;

  if selected_service.booking_mode = 'timed' then
    if p_slot_id is null then
      raise exception 'A booking slot is required for this service.';
    end if;

    select *
    into selected_slot
    from public.availability_slots
    where id = p_slot_id
    for update;

    if not found then
      raise exception 'The selected booking slot does not exist.';
    end if;

    if selected_slot.slot_date < current_date then
      raise exception 'Past booking slots cannot be booked.';
    end if;

    if selected_slot.is_available is not true then
      raise exception 'The selected booking slot is no longer available.';
    end if;

    if exists (
      select 1
      from public.bookings
      where slot_id = p_slot_id
        and status in (
          'pending',
          'pending_payment',
          'confirmed',
          'completed',
          'no_show'
        )
    ) then
      raise exception 'The selected booking slot has already been booked.';
    end if;
  elsif p_slot_id is not null then
    raise exception 'A booking slot must not be supplied for this service.';
  end if;

  select *
  into email_config
  from public.booking_email_config
  where id = true;

  if not found then
    raise exception 'Booking email configuration has not been created.';
  end if;

  booking_amount_due := selected_service.price_amount::numeric / 100;

  insert into public.bookings (
    service_id,
    service_name_snapshot,
    service_booking_mode_snapshot,
    service_duration_minutes_snapshot,
    service_price_amount_snapshot,
    service_currency_snapshot,
    service_payment_flow_snapshot,
    slot_id,
    customer_name,
    customer_email,
    customer_phone,
    customer_message,
    status,
    payment_status,
    amount_due,
    amount_paid,
    updated_at
  )
  values (
    selected_service.id,
    selected_service.name,
    selected_service.booking_mode,
    selected_service.duration_minutes,
    selected_service.price_amount,
    selected_service.currency,
    selected_service.payment_flow,
    p_slot_id,
    cleaned_customer_name,
    cleaned_customer_email,
    cleaned_customer_phone,
    cleaned_customer_message,
    'pending',
    'unpaid',
    booking_amount_due,
    0,
    now()
  )
  returning id
  into new_booking_id;

  if selected_service.booking_mode = 'timed' then
    update public.availability_slots
    set is_available = false
    where id = p_slot_id;
  end if;

  perform public.queue_booking_email(
    new_booking_id,
    'booking_request_customer',
    cleaned_customer_email,
    cleaned_customer_name,
    jsonb_strip_nulls(jsonb_build_object(
      'customer_name', cleaned_customer_name,
      'customer_message', cleaned_customer_message,
      'slot_date', selected_slot.slot_date,
      'slot_time', selected_slot.slot_time
    ))
  );

  perform public.queue_booking_email(
    new_booking_id,
    'booking_request_admin',
    email_config.admin_email,
    email_config.admin_name,
    jsonb_strip_nulls(jsonb_build_object(
      'customer_name', cleaned_customer_name,
      'customer_email', cleaned_customer_email,
      'customer_phone', cleaned_customer_phone,
      'customer_message', cleaned_customer_message,
      'slot_date', selected_slot.slot_date,
      'slot_time', selected_slot.slot_time
    ))
  );

  return new_booking_id;
end;
$$;

alter function public.create_booking_request(uuid, uuid, text, text, text, text)
  owner to postgres;
revoke all on function public.create_booking_request(uuid, uuid, text, text, text, text)
  from public;
grant execute on function public.create_booking_request(uuid, uuid, text, text, text, text)
  to anon, authenticated, service_role;

-- Historical legacy bookings predate the payment-flow snapshot and may be NULL.
-- Keep their original admin lifecycle, even if the service now uses Square.
-- Do not infer historical payment flow from today's catalogue or backfill it.
-- Explicit direct-payment snapshots retain all existing provider guards.
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

  if selected_booking.service_payment_flow_snapshot is distinct from 'direct_payment' then
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

  if selected_booking.service_payment_flow_snapshot is distinct from 'direct_payment' then
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
