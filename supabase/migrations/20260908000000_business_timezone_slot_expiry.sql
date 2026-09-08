-- Business-local wall times are converted once, by PostgreSQL. Public clients
-- receive computed instants, never email/admin configuration. Existing rows,
-- payment evidence, slot ownership and cron scheduling are not rewritten.
create function public.get_business_timezone()
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select z.name from public.email_settings e
    join pg_catalog.pg_timezone_names z on z.name = btrim(e.timezone)
    where e.id = true and (z.name like '%/%' or z.name = 'UTC')
      and z.name not like 'posix/%' and z.name not like 'right/%'
    limit 1
  ), 'America/Chicago');
$$;
alter function public.get_business_timezone() owner to postgres;
revoke all on function public.get_business_timezone() from public;
grant execute on function public.get_business_timezone() to anon, authenticated, service_role;

create function private.slot_start_instant(p_date date, p_time text)
returns timestamptz language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_date is null or p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    return null;
  end if;
  -- PostgreSQL resolves a repeated fall-back time with the post-transition
  -- offset, and a nonexistent spring-forward time with the pre-transition
  -- offset. Returning the resulting instant gives every client identical DST
  -- semantics, including historical slots without an explicit offset/fold.
  return (p_date + p_time::time) at time zone public.get_business_timezone();
end;
$$;
alter function private.slot_start_instant(date,text) owner to postgres;
revoke all on function private.slot_start_instant(date,text) from public, anon, authenticated, service_role;

-- PostgREST computed field, explicitly selected as starts_at:slot_starts_at.
-- The argument is the caller's row; this function performs no slot lookup.
create function public.slot_starts_at(public.availability_slots)
returns timestamptz language sql stable security definer set search_path = ''
as $$ select private.slot_start_instant($1.slot_date, $1.slot_time); $$;
alter function public.slot_starts_at(public.availability_slots) owner to postgres;
revoke all on function public.slot_starts_at(public.availability_slots) from public;
grant execute on function public.slot_starts_at(public.availability_slots) to anon, authenticated, service_role;

create function private.slot_is_future(p_date date, p_time text, p_now timestamptz default clock_timestamp())
returns boolean language sql volatile security definer set search_path = ''
as $$
  select coalesce(private.slot_start_instant(p_date,p_time) >= p_now, false);
$$;
alter function private.slot_is_future(date,text,timestamptz) owner to postgres;
revoke all on function private.slot_is_future(date,text,timestamptz) from public, anon, authenticated, service_role;

-- The admin read policy remains unchanged. Public access remains restricted
-- to available slots, now with a precise start instant rather than UTC date.
drop policy "Public can view future available slots" on public.availability_slots;
create policy "Public can view future available slots" on public.availability_slots
for select to anon, authenticated
using (is_available is true and public.slot_starts_at(availability_slots) >= clock_timestamp());

create or replace function private.delete_past_availability_slots()
returns integer language plpgsql security definer set search_path = ''
as $$
declare deleted_count integer;
begin
  delete from public.availability_slots as slot
  where private.slot_start_instant(slot.slot_date, slot.slot_time) < clock_timestamp()
    and not exists (select 1 from public.bookings b where b.slot_id = slot.id);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
comment on function public.delete_past_availability_slots() is
  'Admin-guarded cleanup of unreferenced slots whose business-time start has passed.';
-- The existing cron job calls this private function; no schedule change needed.

-- Preserve the existing authorization, locking and lifecycle; replace only expiry checks.
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

    if not private.slot_is_future(selected_slot.slot_date, selected_slot.slot_time) then
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

-- Preserve the existing authorization, locking and lifecycle; replace only expiry checks.
create or replace function public.create_pending_payment_booking(
  p_service_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default null,
  p_customer_message text default null,
  p_slot_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  selected_service public.services%rowtype;
  selected_slot public.availability_slots%rowtype;
  new_booking_id uuid;
  payment_access_token text;
  cleaned_name text := nullif(btrim(p_customer_name), '');
  cleaned_email text := lower(nullif(btrim(p_customer_email), ''));
  cleaned_phone text := nullif(btrim(p_customer_phone), '');
  cleaned_message text := nullif(btrim(p_customer_message), '');
begin
  if p_service_id is null then raise exception 'A service is required.'; end if;
  if cleaned_name is null then raise exception 'Customer name is required.'; end if;
  if cleaned_email is null then raise exception 'Customer email is required.'; end if;

  select * into selected_service from public.services
  where id = p_service_id for share;
  if not found then raise exception 'The selected service does not exist.'; end if;
  if selected_service.is_active is not true
    or selected_service.payment_required is not true
    or selected_service.payment_flow <> 'direct_payment'
    or selected_service.price_amount <= 0
    or selected_service.currency <> 'USD'
  then raise exception 'The selected service is not eligible for direct payment.';
  end if;

  if selected_service.booking_mode = 'timed' then
    if p_slot_id is null then
      raise exception 'A booking slot is required for this service.';
    end if;
    select * into selected_slot from public.availability_slots
    where id = p_slot_id for update;
    if not found then raise exception 'The selected booking slot does not exist.'; end if;
    if not private.slot_is_future(selected_slot.slot_date, selected_slot.slot_time) then
      raise exception 'Past booking slots cannot be booked.';
    end if;
    if selected_slot.is_available is not true then
      raise exception 'The selected booking slot is no longer available.';
    end if;
    if exists (
      select 1 from public.bookings
      where slot_id = p_slot_id
        and status in (
          'pending', 'pending_payment', 'confirmed', 'completed', 'no_show'
        )
    ) then raise exception 'The selected booking slot has already been booked.';
    end if;
  elsif selected_service.booking_mode = 'untimed' then
    if p_slot_id is not null then
      raise exception 'A booking slot must not be supplied for this service.';
    end if;
    if cleaned_message is null then
      raise exception 'A reading topic or question is required.';
    end if;
  else
    raise exception 'The selected service has an invalid booking mode.';
  end if;

  insert into public.bookings (
    service_id, service_name_snapshot, service_booking_mode_snapshot,
    service_duration_minutes_snapshot, service_price_amount_snapshot,
    service_currency_snapshot, service_payment_flow_snapshot, slot_id,
    customer_name, customer_email, customer_phone, customer_message,
    status, payment_status, amount_due, amount_paid, updated_at
  ) values (
    selected_service.id, selected_service.name, selected_service.booking_mode,
    selected_service.duration_minutes, selected_service.price_amount,
    selected_service.currency, selected_service.payment_flow, p_slot_id,
    cleaned_name, cleaned_email, cleaned_phone, cleaned_message,
    'pending_payment', 'unpaid', selected_service.price_amount::numeric / 100,
    0, now()
  ) returning id into new_booking_id;

  payment_access_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.booking_payment_access (booking_id, token_hash)
  values (new_booking_id, extensions.digest(payment_access_token, 'sha256'));

  insert into private.payment_attempts (
    booking_id, provider, idempotency_key, amount_minor, currency
  ) values (
    new_booking_id, 'square',
    'sq-' || replace(gen_random_uuid()::text, '-', ''),
    selected_service.price_amount, selected_service.currency
  );

  if selected_service.booking_mode = 'timed' then
    update public.availability_slots set is_available = false
    where id = selected_slot.id;
  end if;

  return jsonb_build_object(
    'booking_id', new_booking_id,
    'payment_access_token', payment_access_token
  );
end;
$$;

-- Preserve the existing authorization, locking and lifecycle; replace only expiry checks.
create or replace function public.begin_payment_attempt(
  p_booking_id uuid, p_payment_access_token text, p_provider text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
  selected_slot public.availability_slots%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  if p_booking_id is null or nullif(btrim(p_payment_access_token), '') is null
    or p_provider <> 'square'
  then raise exception 'Valid payment access is required.'; end if;

  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  if not found or not exists (
    select 1 from private.booking_payment_access access
    where access.booking_id = p_booking_id
      and access.token_hash = extensions.digest(p_payment_access_token, 'sha256')
  ) then raise exception using errcode = '42501', message = 'Payment access is invalid.';
  end if;

  if selected_booking.status = 'confirmed'
    and selected_booking.payment_status = 'paid'
  then return jsonb_build_object(
    'action', 'paid', 'booking_status', selected_booking.status,
    'payment_status', selected_booking.payment_status,
    'service_name', selected_booking.service_name_snapshot,
    'amount_minor', selected_booking.service_price_amount_snapshot,
    'currency', selected_booking.service_currency_snapshot
  ); end if;

  if selected_booking.status not in ('pending_payment', 'payment_expired')
    or selected_booking.payment_status <> 'unpaid'
    or selected_booking.service_booking_mode_snapshot not in ('timed', 'untimed')
    or selected_booking.service_payment_flow_snapshot <> 'direct_payment'
    or selected_booking.service_price_amount_snapshot <= 0
    or selected_booking.service_currency_snapshot <> 'USD'
    or round(selected_booking.amount_due * 100)::integer
      <> selected_booking.service_price_amount_snapshot
    or selected_booking.amount_paid <> 0
    or (selected_booking.service_booking_mode_snapshot = 'timed'
      and selected_booking.slot_id is null)
    or (selected_booking.service_booking_mode_snapshot = 'untimed'
      and selected_booking.slot_id is not null)
  then raise exception 'This booking is not eligible for direct payment.'; end if;

  select * into selected_attempt from private.payment_attempts
  where booking_id = selected_booking.id
    and status in ('reserved', 'processing', 'unknown')
  for update;

  if found then
    return jsonb_build_object(
      'action', case selected_attempt.status
        when 'reserved' then 'submit' else 'wait' end,
      'attempt_id', selected_attempt.id,
      'attempt_status', selected_attempt.status,
      'booking_id', selected_booking.id,
      'service_name', selected_booking.service_name_snapshot,
      'amount_minor', selected_attempt.amount_minor,
      'currency', selected_attempt.currency
    );
  end if;

  if selected_booking.status = 'pending_payment' then
    raise exception 'The pending booking has no active payment attempt.';
  end if;

  if selected_booking.service_booking_mode_snapshot = 'timed' then
    select * into selected_slot from public.availability_slots
    where id = selected_booking.slot_id for update;
    if not found
      or not private.slot_is_future(selected_slot.slot_date, selected_slot.slot_time)
      or selected_slot.is_available is not true
      or exists (
        select 1 from public.bookings
        where slot_id = selected_booking.slot_id
          and id <> selected_booking.id
          and status in (
            'pending', 'pending_payment', 'confirmed', 'completed', 'no_show'
          )
      )
    then raise exception 'The original booking slot is no longer available.';
    end if;
    update public.availability_slots set is_available = false
    where id = selected_slot.id;
  end if;

  update public.bookings set status = 'pending_payment', updated_at = now()
  where id = selected_booking.id;
  insert into private.payment_attempts (
    booking_id, provider, idempotency_key, amount_minor, currency
  ) values (
    selected_booking.id, 'square',
    'sq-' || replace(gen_random_uuid()::text, '-', ''),
    selected_booking.service_price_amount_snapshot,
    selected_booking.service_currency_snapshot
  ) returning * into selected_attempt;

  return jsonb_build_object(
    'action', 'submit', 'attempt_id', selected_attempt.id,
    'attempt_status', selected_attempt.status,
    'booking_id', selected_booking.id,
    'service_name', selected_booking.service_name_snapshot,
    'amount_minor', selected_attempt.amount_minor,
    'currency', selected_attempt.currency
  );
end;
$$;

-- Preserve the existing authorization, locking and lifecycle; replace only expiry checks.
create or replace function public.create_availability_slots(p_slots jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
  inserted_count integer;
begin
  perform private.require_admin();
  if jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'Slot date/time pairs are required.';
  end if;
  for item in select value from jsonb_array_elements(p_slots)
  loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'Each slot must contain only a date and time.';
    end if;
    if (item - 'slot_date' - 'slot_time') <> '{}'::jsonb
      or jsonb_typeof(item -> 'slot_date') is distinct from 'string'
      or jsonb_typeof(item -> 'slot_time') is distinct from 'string'
      or (item ->> 'slot_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (item ->> 'slot_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    then raise exception 'Each slot must contain only a valid date and HH:MM time.';
    end if;
    if not private.slot_is_future((item ->> 'slot_date')::date, item ->> 'slot_time') then
      raise exception 'New availability cannot be in the past.';
    end if;
  end loop;

  insert into public.availability_slots (slot_date, slot_time, is_available)
  select distinct (value ->> 'slot_date')::date, value ->> 'slot_time', true
  from jsonb_array_elements(p_slots)
  order by 1, 2
  on conflict (slot_date, slot_time) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.mark_payment_attempt_processing(
  p_booking_id uuid, p_attempt_id uuid, p_provider_location_id text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
  selected_slot public.availability_slots%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  select * into selected_attempt from private.payment_attempts
  where id = p_attempt_id and booking_id = p_booking_id for update;
  if selected_booking.id is null or selected_attempt.id is null
    or selected_attempt.provider <> 'square'
  then raise exception 'Payment attempt was not found.'; end if;
  if selected_booking.status <> 'pending_payment'
    or selected_booking.payment_status <> 'unpaid'
    or selected_booking.service_payment_flow_snapshot <> 'direct_payment'
    or selected_booking.service_price_amount_snapshot <> selected_attempt.amount_minor
    or selected_booking.service_currency_snapshot <> selected_attempt.currency
  then raise exception 'The booking is no longer eligible for payment.'; end if;
  if selected_attempt.status <> 'reserved' then
    return jsonb_build_object('should_submit', false,
      'attempt_status', selected_attempt.status);
  end if;
  -- Do not initiate a new charge after start. Already submitted attempts
  -- returned above remain recoverable and webhook settlement is unchanged.
  if selected_booking.service_booking_mode_snapshot = 'timed' then
    select * into selected_slot from public.availability_slots
    where id = selected_booking.slot_id for update;
    if not found or not private.slot_is_future(selected_slot.slot_date, selected_slot.slot_time) then
      raise exception 'The appointment start time has passed.';
    end if;
  end if;
  update private.payment_attempts set status = 'processing',
    provider_location_id = nullif(btrim(p_provider_location_id), ''),
    submitted_at = now(), updated_at = now()
  where id = selected_attempt.id;
  return jsonb_build_object('should_submit', true,
    'idempotency_key', selected_attempt.idempotency_key,
    'amount_minor', selected_attempt.amount_minor,
    'currency', selected_attempt.currency);
end;
$$;

-- CREATE OR REPLACE preserves existing owners/grants on replaced functions.
notify pgrst, 'reload schema';
