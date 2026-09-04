-- Compatibility fixes for the staged direct-payment lifecycle rollout.
-- This migration does not activate services or alter booking/customer data.

-- Phase one created the first payment attempt during initialization. Backfill
-- legacy pending direct-payment bookings that were created before initialization
-- while retaining the strict invariant enforced by begin_payment_attempt.
do $$
declare
  candidate record;
  locked_booking public.bookings%rowtype;
begin
  for candidate in
    select booking.id
    from public.bookings as booking
    where booking.service_payment_flow_snapshot = 'direct_payment'
      and booking.status = 'pending_payment'
      and booking.payment_status = 'unpaid'
      and not exists (
        select 1
        from private.payment_attempts as attempt
        where attempt.booking_id = booking.id
      )
    order by booking.id
  loop
    -- Serialize with booking/payment lifecycle operations, then recheck every
    -- eligibility condition after the lock has been acquired.
    select *
    into locked_booking
    from public.bookings
    where id = candidate.id
    for update;

    if found
      and locked_booking.service_payment_flow_snapshot = 'direct_payment'
      and locked_booking.status = 'pending_payment'
      and locked_booking.payment_status = 'unpaid'
      and not exists (
        select 1
        from private.payment_attempts as attempt
        where attempt.booking_id = locked_booking.id
      )
    then
      insert into private.payment_attempts (
        booking_id,
        provider,
        idempotency_key,
        status,
        amount_minor,
        currency
      )
      values (
        locked_booking.id,
        'square',
        'sq-' || replace(gen_random_uuid()::text, '-', ''),
        'reserved',
        locked_booking.service_price_amount_snapshot,
        locked_booking.service_currency_snapshot
      )
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

-- Keep the historical payment-link/manual booking API, but align its slot
-- ownership decision with the canonical positive ownership list used by the
-- lifecycle index. Expired and cancelled audit rows do not own their slots.
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
