-- Provider-neutral direct-payment phase one. Only Voice Memo Reading is opted
-- in. Existing timed Stripe Payment Link behavior remains unchanged.

alter table public.services
  add column payment_flow text not null default 'none';

update public.services
set payment_flow = case
  when payment_required is not true then 'none'
  when slug = 'voice-memo-reading' and booking_mode = 'untimed'
    then 'direct_payment'
  else 'payment_link'
end;

alter table public.services
  add constraint services_payment_flow_check check (
    (payment_required is not true and payment_flow = 'none')
    or (payment_required is true and (
      payment_flow = 'payment_link'
      or (payment_flow = 'direct_payment' and booking_mode = 'untimed')
    ))
  );

drop function public.get_active_services();
create function public.get_active_services()
returns table (
  id uuid, slug text, name text, booking_mode text,
  duration_minutes integer, price_amount integer, currency text,
  payment_required boolean, payment_flow text, display_order integer
)
language sql stable security definer set search_path = ''
as $$
  select service.id, service.slug, service.name, service.booking_mode,
    service.duration_minutes, service.price_amount, service.currency,
    service.payment_required, service.payment_flow, service.display_order
  from public.services as service
  where service.is_active is true
  order by service.display_order, service.name;
$$;
alter function public.get_active_services() owner to postgres;
revoke all on function public.get_active_services() from public;
grant execute on function public.get_active_services()
  to anon, authenticated, service_role;

alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check check (status in (
    'pending', 'pending_payment', 'payment_expired', 'confirmed',
    'cancelled', 'completed', 'no_show'
  )),
  add column service_payment_flow_snapshot text;

alter table public.bookings drop constraint bookings_payment_method_check;
alter table public.bookings add constraint bookings_payment_method_check check (
  payment_method is null or payment_method in (
    'cash', 'bank_transfer', 'card', 'payment_link', 'stripe', 'square',
    'complimentary', 'other'
  )
);

alter table public.bookings
  add constraint bookings_service_payment_flow_snapshot_check check (
    service_payment_flow_snapshot is null
    or service_payment_flow_snapshot in ('none', 'payment_link', 'direct_payment')
  ),
  add constraint bookings_direct_payment_untimed_check check (
    service_payment_flow_snapshot <> 'direct_payment'
    or service_booking_mode_snapshot = 'untimed'
  ),
  add constraint bookings_direct_payment_lifecycle_check check (
    status not in ('pending_payment', 'payment_expired')
    or service_payment_flow_snapshot = 'direct_payment'
  );

-- The raw recovery token is returned once. Only its SHA-256 digest is stored.
create table private.booking_payment_access (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  token_hash bytea not null,
  created_at timestamptz not null default now()
);
alter table private.booking_payment_access owner to postgres;
revoke all on table private.booking_payment_access
  from public, anon, authenticated, service_role;

create table private.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  provider text not null check (provider in ('square')),
  idempotency_key text not null unique
    check (length(idempotency_key) between 1 and 45),
  provider_payment_id text,
  provider_location_id text,
  status text not null default 'reserved' check (status in (
    'reserved', 'processing', 'unknown', 'completed', 'failed',
    'expired', 'cancelled'
  )),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_status text,
  failure_code text,
  failure_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  last_reconciled_at timestamptz,
  constraint payment_attempt_submission_check check (
    status in ('reserved', 'expired', 'cancelled') or submitted_at is not null
  ),
  constraint payment_attempt_completion_check check (
    status <> 'completed'
    or (provider_payment_id is not null and completed_at is not null)
  )
);
alter table private.payment_attempts owner to postgres;
revoke all on table private.payment_attempts
  from public, anon, authenticated, service_role;
create index payment_attempts_booking_id_index
  on private.payment_attempts (booking_id);
create unique index payment_attempts_provider_payment_unique
  on private.payment_attempts (provider, provider_payment_id)
  where provider_payment_id is not null;
create unique index payment_attempts_one_active_per_booking
  on private.payment_attempts (booking_id)
  where status in ('reserved', 'processing', 'unknown');

create table private.payment_webhook_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  provider_payment_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);
alter table private.payment_webhook_events owner to postgres;
revoke all on table private.payment_webhook_events
  from public, anon, authenticated, service_role;

create function public.create_pending_payment_booking(
  p_service_id uuid, p_customer_name text, p_customer_email text,
  p_customer_phone text default null, p_customer_message text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  selected_service public.services%rowtype;
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
  if cleaned_message is null then
    raise exception 'A reading topic or question is required.';
  end if;

  select * into selected_service from public.services
  where id = p_service_id for share;
  if not found then raise exception 'The selected service does not exist.'; end if;
  if selected_service.is_active is not true
    or selected_service.slug <> 'voice-memo-reading'
    or selected_service.booking_mode <> 'untimed'
    or selected_service.payment_required is not true
    or selected_service.payment_flow <> 'direct_payment'
    or selected_service.price_amount <> 2000
    or selected_service.currency <> 'USD'
  then raise exception 'The selected service is not eligible for direct payment.';
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
    selected_service.currency, selected_service.payment_flow, null,
    cleaned_name, cleaned_email, cleaned_phone, cleaned_message,
    'pending_payment', 'unpaid', selected_service.price_amount::numeric / 100,
    0, now()
  ) returning id into new_booking_id;

  payment_access_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.booking_payment_access (booking_id, token_hash)
  values (new_booking_id, extensions.digest(payment_access_token, 'sha256'));
  return jsonb_build_object('booking_id', new_booking_id,
    'payment_access_token', payment_access_token);
end;
$$;
alter function public.create_pending_payment_booking(uuid, text, text, text, text)
  owner to postgres;
revoke all on function public.create_pending_payment_booking(uuid, text, text, text, text)
  from public;
grant execute on function public.create_pending_payment_booking(uuid, text, text, text, text)
  to anon, authenticated, service_role;

-- Booking is always locked before its attempt. Concurrent callers either see
-- the same active attempt or serialize behind its creation.
create function public.begin_payment_attempt(
  p_booking_id uuid, p_payment_access_token text, p_provider text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
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
    or selected_booking.service_booking_mode_snapshot <> 'untimed'
    or selected_booking.service_payment_flow_snapshot <> 'direct_payment'
    or selected_booking.service_price_amount_snapshot <= 0
    or selected_booking.service_currency_snapshot <> 'USD'
    or round(selected_booking.amount_due * 100)::integer
      <> selected_booking.service_price_amount_snapshot
    or selected_booking.amount_paid <> 0
  then raise exception 'This booking is not eligible for direct payment.'; end if;

  select * into selected_attempt from private.payment_attempts
  where booking_id = selected_booking.id
    and status in ('reserved', 'processing', 'unknown')
  for update;

  if not found then
    insert into private.payment_attempts (
      booking_id, provider, idempotency_key, amount_minor, currency
    ) values (
      selected_booking.id, 'square',
      'sq-' || replace(gen_random_uuid()::text, '-', ''),
      selected_booking.service_price_amount_snapshot,
      selected_booking.service_currency_snapshot
    ) returning * into selected_attempt;
    if selected_booking.status = 'payment_expired' then
      update public.bookings set status = 'pending_payment', updated_at = now()
      where id = selected_booking.id;
    end if;
  end if;

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
end;
$$;

create function public.mark_payment_attempt_processing(
  p_booking_id uuid, p_attempt_id uuid, p_provider_location_id text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
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

create function public.mark_payment_attempt_unknown(
  p_booking_id uuid, p_attempt_id uuid, p_failure_detail text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare selected_booking public.bookings%rowtype; selected_attempt private.payment_attempts%rowtype;
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
  if selected_attempt.status not in ('processing', 'unknown') then return false; end if;
  update private.payment_attempts set status = 'unknown',
    failure_detail = left(nullif(btrim(p_failure_detail), ''), 500), updated_at = now()
  where id = selected_attempt.id;
  return true;
end;
$$;

create function public.fail_payment_attempt(
  p_booking_id uuid, p_attempt_id uuid, p_provider_status text,
  p_failure_code text default null, p_failure_detail text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare selected_booking public.bookings%rowtype; selected_attempt private.payment_attempts%rowtype;
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
  if selected_attempt.status in ('completed', 'failed', 'expired', 'cancelled') then
    return false;
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
  return true;
end;
$$;

-- Both CreatePayment and signed webhook processing call this same function.
-- It validates the provider result, serializes races, and queues emails once.
create function public.record_provider_payment_result(
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
    selected_booking.customer_name, jsonb_build_object(
      'booking_id', selected_booking.id,
      'customer_name', selected_booking.customer_name,
      'customer_email', selected_booking.customer_email,
      'service_name', selected_booking.service_name_snapshot,
      'service_booking_mode', selected_booking.service_booking_mode_snapshot,
      'service_currency', selected_booking.service_currency_snapshot,
      'direct_payment', true, 'payment_status', 'paid',
      'amount_due', p_amount_minor::numeric / 100,
      'amount_paid', p_amount_minor::numeric / 100
    )
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

create function public.get_payment_status(
  p_booking_id uuid, p_payment_access_token text
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare selected_booking public.bookings%rowtype; selected_attempt private.payment_attempts%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  select * into selected_booking from public.bookings where id = p_booking_id;
  if not found or not exists (
    select 1 from private.booking_payment_access access
    where access.booking_id = p_booking_id
      and access.token_hash = extensions.digest(p_payment_access_token, 'sha256')
  ) then raise exception using errcode = '42501', message = 'Payment access is invalid.';
  end if;
  select * into selected_attempt from private.payment_attempts
    where booking_id = selected_booking.id order by created_at desc limit 1;
  return jsonb_build_object(
    'booking_status', selected_booking.status,
    'payment_status', selected_booking.payment_status,
    'attempt_id', selected_attempt.id,
    'attempt_status', selected_attempt.status,
    'provider_status', selected_attempt.provider_status,
    'service_name', selected_booking.service_name_snapshot,
    'amount_minor', selected_booking.service_price_amount_snapshot,
    'currency', selected_booking.service_currency_snapshot,
    'paid', selected_booking.status = 'confirmed'
      and selected_booking.payment_status = 'paid',
    'can_restart', selected_booking.status = 'payment_expired'
      and selected_booking.payment_status = 'unpaid'
      and (selected_attempt.id is null
        or selected_attempt.status in ('failed', 'expired', 'cancelled'))
  );
end;
$$;

create function public.get_payment_attempt_booking(p_attempt_id uuid, p_provider text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare result uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  select booking_id into result from private.payment_attempts
    where id = p_attempt_id and provider = p_provider;
  return result;
end;
$$;

create function public.record_nonterminal_payment_webhook_event(
  p_provider text, p_event_id text, p_event_type text,
  p_provider_payment_id text
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare inserted_event_id text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  if p_provider <> 'square' or nullif(btrim(p_event_id), '') is null
    or p_event_type not in ('payment.created', 'payment.updated')
  then raise exception 'A valid provider event is required.'; end if;
  insert into private.payment_webhook_events (
    provider, event_id, event_type, provider_payment_id, processed_at
  ) values (
    p_provider, btrim(p_event_id), p_event_type,
    nullif(btrim(p_provider_payment_id), ''), now()
  ) on conflict (provider, event_id) do nothing
  returning event_id into inserted_event_id;
  return inserted_event_id is not null;
end;
$$;

-- Optional scheduler target. It expires only attempts for which submission
-- never began; processing/unknown attempts are deliberately excluded.
create function public.expire_stale_reserved_payment_attempts()
returns integer language plpgsql security definer set search_path = ''
as $$
declare candidate record; selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype; expired_count integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  for candidate in select id, booking_id from private.payment_attempts
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
    update public.bookings set status = 'payment_expired', updated_at = now()
      where id = selected_booking.id;
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

-- All payment-state mutation functions are service-role only.
do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    'public.begin_payment_attempt(uuid,text,text)'::regprocedure,
    'public.mark_payment_attempt_processing(uuid,uuid,text)'::regprocedure,
    'public.mark_payment_attempt_unknown(uuid,uuid,text)'::regprocedure,
    'public.fail_payment_attempt(uuid,uuid,text,text,text)'::regprocedure,
    'public.record_provider_payment_result(text,text,text,uuid,uuid,text,text,text,integer,text)'::regprocedure,
    'public.get_payment_status(uuid,text)'::regprocedure,
    'public.get_payment_attempt_booking(uuid,text)'::regprocedure,
    'public.record_nonterminal_payment_webhook_event(text,text,text,text)'::regprocedure,
    'public.expire_stale_reserved_payment_attempts()'::regprocedure
  ] loop
    execute format('alter function %s owner to postgres', signature);
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$$;

-- Direct-payment fields remain provider-controlled at the database boundary.
create or replace function public.cancel_booking(p_booking_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare selected_booking public.bookings%rowtype;
  selected_attempt private.payment_attempts%rowtype;
begin
  perform private.require_admin();
  select * into selected_booking from public.bookings
    where id = p_booking_id for update;
  if selected_booking.service_payment_flow_snapshot = 'direct_payment' then
    select * into selected_attempt from private.payment_attempts
      where booking_id = p_booking_id order by created_at desc limit 1
      for update;
    if selected_booking.payment_status = 'paid'
      or selected_attempt.status in ('processing', 'unknown', 'completed')
    then raise exception 'Direct-payment bookings cannot be cancelled while payment may be active or settled.';
    end if;
    if selected_attempt.status = 'reserved' then
      update private.payment_attempts set status = 'cancelled', updated_at = now()
      where id = selected_attempt.id;
    end if;
  end if;
  return private.cancel_booking(p_booking_id);
end;
$$;

create or replace function public.update_booking_status(p_booking_id uuid, p_status text)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare selected_booking public.bookings%rowtype;
begin
  perform private.require_admin();
  select * into selected_booking from public.bookings where id = p_booking_id;
  if selected_booking.service_payment_flow_snapshot = 'direct_payment'
    and selected_booking.status in ('pending_payment', 'payment_expired')
  then raise exception 'The payment provider controls confirmation for this booking.'; end if;
  if selected_booking.service_payment_flow_snapshot = 'direct_payment'
    and p_status in ('pending', 'confirmed')
  then raise exception 'A settled direct-payment booking cannot return to a manual payment state.';
  end if;
  return private.update_booking_status(p_booking_id, p_status);
end;
$$;

create or replace function public.update_booking_payment(
  p_booking_id uuid, p_payment_status text, p_amount_due numeric,
  p_amount_paid numeric, p_payment_method text default null,
  p_payment_reference text default null
)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare selected_booking public.bookings%rowtype;
begin
  perform private.require_admin();
  select * into selected_booking from public.bookings where id = p_booking_id;
  if selected_booking.service_payment_flow_snapshot = 'direct_payment' then
    raise exception 'Provider-controlled payment fields are read-only.';
  end if;
  return private.update_booking_payment(p_booking_id, p_payment_status,
    p_amount_due, p_amount_paid, p_payment_method, p_payment_reference);
end;
$$;

alter function public.cancel_booking(uuid) owner to postgres;
alter function public.update_booking_status(uuid, text) owner to postgres;
alter function public.update_booking_payment(uuid, text, numeric, numeric, text, text) owner to postgres;
revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.update_booking_status(uuid, text) from public, anon;
revoke all on function public.update_booking_payment(uuid, text, numeric, numeric, text, text) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated, service_role;
grant execute on function public.update_booking_status(uuid, text) to authenticated, service_role;
grant execute on function public.update_booking_payment(uuid, text, numeric, numeric, text, text) to authenticated, service_role;

comment on table private.payment_attempts is
  'Server-only provider-neutral attempts; active attempts block duplicate charges.';
comment on table private.payment_webhook_events is
  'Server-only provider/event deduplication ledger.';
comment on function public.expire_stale_reserved_payment_attempts() is
  'Expires only never-submitted reserved attempts; no cron job is installed.';
