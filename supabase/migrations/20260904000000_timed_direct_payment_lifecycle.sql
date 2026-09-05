-- Extend the existing provider-neutral direct-payment lifecycle to timed
-- services. Historical bookings and payment snapshots are left unchanged.

alter table public.services drop constraint services_payment_flow_check;
alter table public.services
  add constraint services_payment_flow_check check (
    (payment_required is not true and payment_flow = 'none')
    or (payment_required is true and payment_flow in ('payment_link', 'direct_payment'))
  );

alter table public.bookings drop constraint bookings_direct_payment_untimed_check;

-- Only statuses that actively hold a slot participate in ownership. In
-- particular, payment_expired and cancelled bookings retain history without
-- preventing a new owner from reserving the slot.
drop index public.bookings_one_active_booking_per_slot;
create unique index bookings_one_active_booking_per_slot
  on public.bookings (slot_id)
  where status in (
    'pending', 'pending_payment', 'confirmed', 'completed', 'no_show'
  );

-- Availability history must never disappear through a cascading slot delete.
alter table public.bookings drop constraint bookings_slot_id_fkey;
alter table public.bookings
  add constraint bookings_slot_id_fkey foreign key (slot_id)
  references public.availability_slots(id) on delete restrict;

-- Keep the existing five-argument callers compatible by placing the optional
-- slot at the end of the replacement signature.
drop function public.create_pending_payment_booking(uuid, text, text, text, text);
create function public.create_pending_payment_booking(
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
    if selected_slot.slot_date < current_date then
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
alter function public.create_pending_payment_booking(uuid, text, text, text, text, uuid)
  owner to postgres;
revoke all on function public.create_pending_payment_booking(uuid, text, text, text, text, uuid)
  from public;
grant execute on function public.create_pending_payment_booking(uuid, text, text, text, text, uuid)
  to anon, authenticated, service_role;

-- Booking is locked before its attempt, and a timed restart then locks the
-- original slot. Status/recovery reads never call this reacquisition path.
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
      or selected_slot.slot_date < current_date
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

create or replace function public.fail_payment_attempt(
  p_booking_id uuid, p_attempt_id uuid, p_provider_status text,
  p_failure_code text default null, p_failure_detail text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
  selected_slot public.availability_slots%rowtype;
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
  if selected_booking.service_booking_mode_snapshot = 'timed' then
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
  end if;
  update private.payment_attempts set status = 'failed',
    provider_status = nullif(btrim(p_provider_status), ''),
    failure_code = left(nullif(btrim(p_failure_code), ''), 100),
    failure_detail = left(nullif(btrim(p_failure_detail), ''), 500),
    failed_at = now(), last_reconciled_at = now(), updated_at = now()
  where id = selected_attempt.id;
  update public.bookings set status = 'payment_expired', updated_at = now()
  where id = selected_booking.id and status = 'pending_payment'
    and payment_status = 'unpaid';
  if found and selected_booking.service_booking_mode_snapshot = 'timed' then
    update public.availability_slots set is_available = true
    where id = selected_booking.slot_id;
  end if;
  return true;
end;
$$;

-- Both CreatePayment and signed webhook processing retain this sole atomic
-- completion path. A timed completion must prove current slot ownership.
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
  booking_transitioned boolean := false;
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

  if nullif(btrim(p_event_id), '') is not null then
    insert into private.payment_webhook_events (
      provider, event_id, event_type, provider_payment_id
    ) values (p_provider, btrim(p_event_id), btrim(p_event_type), cleaned_payment_id)
    on conflict (provider, event_id) do nothing returning event_id into inserted_event_id;
    if inserted_event_id is null then return false; end if;
  end if;

  update private.payment_attempts set
    provider_payment_id = cleaned_payment_id,
    provider_status = p_provider_status,
    last_reconciled_at = now(), updated_at = now()
  where id = selected_attempt.id;

  if p_provider_status <> 'COMPLETED' then
    if selected_attempt.status = 'completed' then return false; end if;
    update private.payment_attempts set status = 'failed', failed_at = now()
      where id = selected_attempt.id;
    update public.bookings set status = 'payment_expired', updated_at = now()
      where id = selected_booking.id and status = 'pending_payment'
        and payment_status = 'unpaid';
    booking_transitioned := found;
    if booking_transitioned
      and selected_booking.service_booking_mode_snapshot = 'timed'
    then
      update public.availability_slots set is_available = true
      where id = selected_booking.slot_id;
    end if;
    if inserted_event_id is not null then
      update private.payment_webhook_events set processed_at = now()
      where provider = p_provider and event_id = btrim(p_event_id);
    end if;
    return true;
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

-- The private implementation is safe for pg_cron. The public wrapper keeps
-- the existing service-role-only operational contract.
create function private.expire_stale_reserved_payment_attempts()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  candidate record;
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
  selected_slot public.availability_slots%rowtype;
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
    if selected_booking.service_booking_mode_snapshot = 'timed' then
      select * into selected_slot from public.availability_slots
      where id = selected_booking.slot_id for update;
      if not found then raise exception 'The booking slot no longer exists.'; end if;
    end if;
    update private.payment_attempts set status = 'expired', expired_at = now(),
      updated_at = now() where id = selected_attempt.id;
    update public.bookings set status = 'payment_expired', updated_at = now()
      where id = selected_booking.id;
    if selected_booking.service_booking_mode_snapshot = 'timed' then
      update public.availability_slots set is_available = true
      where id = selected_booking.slot_id;
    end if;
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;
alter function private.expire_stale_reserved_payment_attempts() owner to postgres;
revoke all on function private.expire_stale_reserved_payment_attempts()
  from public, anon, authenticated, service_role;

create or replace function public.expire_stale_reserved_payment_attempts()
returns integer language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  return private.expire_stale_reserved_payment_attempts();
end;
$$;

-- Replacing functions preserves their privileges; restate the intended
-- service-role boundary explicitly for auditability.
do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    'public.begin_payment_attempt(uuid,text,text)'::regprocedure,
    'public.fail_payment_attempt(uuid,uuid,text,text,text)'::regprocedure,
    'public.record_provider_payment_result(text,text,text,uuid,uuid,text,text,text,integer,text)'::regprocedure,
    'public.expire_stale_reserved_payment_attempts()'::regprocedure
  ] loop
    execute format('alter function %s owner to postgres', signature);
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$$;

comment on function private.expire_stale_reserved_payment_attempts() is
  'Cron-safe implementation: expires only one-hour-old, never-submitted reservations and releases timed slots atomically.';
comment on function public.expire_stale_reserved_payment_attempts() is
  'Service-role wrapper for the reserved direct-payment expiry sweep.';

-- Scheduling by name updates this job if the migration is replayed.
select cron.schedule(
  'expire-stale-reserved-payment-attempts',
  '*/5 * * * *',
  $cron$select private.expire_stale_reserved_payment_attempts();$cron$
);
