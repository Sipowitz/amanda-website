-- Embedded Stripe Checkout phase one, deliberately limited to explicitly
-- configured paid untimed services. Timed Payment Link behavior is unchanged.

alter table public.services
  add column payment_flow text not null default 'none';

-- Embedded Checkout is an explicit service choice, not an implication of being
-- paid and untimed. Existing paid services otherwise retain Payment Links.
update public.services
set payment_flow = case
  when payment_required is not true then 'none'
  when slug = 'voice-memo-reading' and booking_mode = 'untimed'
    then 'embedded_checkout'
  else 'payment_link'
end;

alter table public.services
  add constraint services_payment_flow_check check (
    (payment_required is not true and payment_flow = 'none')
    or (payment_required is true and (
      payment_flow = 'payment_link'
      or (payment_flow = 'embedded_checkout' and booking_mode = 'untimed')
    ))
  );

-- PostgreSQL cannot replace a function when its table return type changes.
drop function public.get_active_services();
create function public.get_active_services()
returns table (
  id uuid,
  slug text,
  name text,
  booking_mode text,
  duration_minutes integer,
  price_amount integer,
  currency text,
  payment_required boolean,
  payment_flow text,
  display_order integer
)
language sql
stable
security definer
set search_path = ''
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
  add column stripe_checkout_session_id text,
  add column stripe_payment_intent_id text,
  add column service_payment_flow_snapshot text;

alter table public.bookings
  add constraint bookings_service_payment_flow_snapshot_check check (
    service_payment_flow_snapshot is null
    or service_payment_flow_snapshot in
      ('none', 'payment_link', 'embedded_checkout')
  ),
  add constraint bookings_embedded_checkout_untimed_check check (
    service_payment_flow_snapshot <> 'embedded_checkout'
    or service_booking_mode_snapshot = 'untimed'
  ),
  add constraint bookings_stripe_lifecycle_flow_check check (
    status not in ('pending_payment', 'payment_expired')
    or service_payment_flow_snapshot = 'embedded_checkout'
  );

create unique index bookings_stripe_checkout_session_unique
  on public.bookings (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- The raw customer recovery token is returned once. Only its digest is stored.
create table private.booking_payment_access (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  token_hash bytea not null,
  created_at timestamptz not null default now()
);
alter table private.booking_payment_access owner to postgres;
revoke all on table private.booking_payment_access
  from public, anon, authenticated, service_role;

-- Reserve an attempt before contacting Stripe. The partial unique index is the
-- database-level guarantee that a booking has only one payable current attempt.
create table private.stripe_checkout_sessions (
  attempt_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  session_id text unique,
  status text not null default 'creating'
    check (status in ('creating', 'open', 'completed', 'expired')),
  amount_total integer not null check (amount_total > 0),
  currency text not null check (currency = 'usd'),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expired_at timestamptz,
  constraint stripe_checkout_session_registration_check check (
    (status = 'creating' and session_id is null)
    or (status = 'expired')
    or (status in ('open', 'completed') and session_id is not null)
  )
);
alter table private.stripe_checkout_sessions owner to postgres;
revoke all on table private.stripe_checkout_sessions
  from public, anon, authenticated, service_role;
create index stripe_checkout_sessions_booking_id_index
  on private.stripe_checkout_sessions (booking_id);
create unique index stripe_checkout_one_active_attempt_per_booking
  on private.stripe_checkout_sessions (booking_id)
  where status in ('creating', 'open');

create table private.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  session_id text,
  processed_at timestamptz not null default now()
);
alter table private.stripe_webhook_events owner to postgres;
revoke all on table private.stripe_webhook_events
  from public, anon, authenticated, service_role;

create function public.create_pending_payment_booking(
  p_service_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default null,
  p_customer_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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

  select * into selected_service
  from public.services where id = p_service_id for share;
  if not found then raise exception 'The selected service does not exist.'; end if;
  if selected_service.is_active is not true
    or selected_service.booking_mode <> 'untimed'
    or selected_service.payment_required is not true
    or selected_service.payment_flow <> 'embedded_checkout'
    or selected_service.price_amount <= 0
    or selected_service.currency <> 'USD'
  then
    raise exception 'The selected service is not eligible for embedded payment.';
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
    'pending_payment', 'unpaid',
    selected_service.price_amount::numeric / 100, 0, now()
  ) returning id into new_booking_id;

  payment_access_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.booking_payment_access (booking_id, token_hash)
  values (new_booking_id,
    extensions.digest(payment_access_token, 'sha256'));

  -- No email is queued before a signed webhook verifies payment.
  return jsonb_build_object(
    'booking_id', new_booking_id,
    'payment_access_token', payment_access_token
  );
end;
$$;
alter function public.create_pending_payment_booking(uuid, text, text, text, text)
  owner to postgres;
revoke all on function public.create_pending_payment_booking(uuid, text, text, text, text)
  from public;
grant execute on function public.create_pending_payment_booking(uuid, text, text, text, text)
  to anon, authenticated, service_role;

-- The booking lock serializes concurrent initializers. A creating attempt is
-- reusable after an interrupted registration: Stripe receives the same
-- attempt-derived idempotency key and returns the original Session.
create function public.begin_stripe_checkout_attempt(
  p_booking_id uuid,
  p_payment_access_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_service public.services%rowtype;
  selected_attempt private.stripe_checkout_sessions%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  if p_booking_id is null or nullif(btrim(p_payment_access_token), '') is null then
    raise exception 'Booking payment access is required.';
  end if;

  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  if not found or not exists (
    select 1 from private.booking_payment_access as access
    where access.booking_id = p_booking_id
      and access.token_hash = extensions.digest(p_payment_access_token, 'sha256')
  ) then
    raise exception using errcode = '42501', message = 'Payment access is invalid.';
  end if;

  if selected_booking.status = 'confirmed'
    and selected_booking.payment_status = 'paid'
  then
    return jsonb_build_object(
      'action', 'paid', 'booking_status', selected_booking.status,
      'payment_status', selected_booking.payment_status,
      'service_name', selected_booking.service_name_snapshot,
      'amount_total', selected_booking.service_price_amount_snapshot,
      'currency', lower(selected_booking.service_currency_snapshot)
    );
  end if;

  if selected_booking.status not in ('pending_payment', 'payment_expired')
    or selected_booking.payment_status <> 'unpaid'
    or selected_booking.service_booking_mode_snapshot <> 'untimed'
    or selected_booking.service_payment_flow_snapshot <> 'embedded_checkout'
    or selected_booking.service_currency_snapshot <> 'USD'
    or selected_booking.service_price_amount_snapshot <= 0
    or round(selected_booking.amount_due * 100)::integer
      <> selected_booking.service_price_amount_snapshot
    or selected_booking.amount_paid <> 0
  then raise exception 'This booking is not eligible for embedded payment.'; end if;

  select * into selected_service from public.services
  where id = selected_booking.service_id;
  if not found or selected_service.is_active is not true
    or selected_service.booking_mode <> 'untimed'
    or selected_service.payment_required is not true
    or selected_service.payment_flow <> 'embedded_checkout'
  then
    raise exception 'This service is not currently available for embedded payment.';
  end if;

  select * into selected_attempt
  from private.stripe_checkout_sessions
  where booking_id = selected_booking.id
    and status in ('creating', 'open')
  for update;

  if not found then
    if selected_booking.status = 'payment_expired' then
      update public.bookings set status = 'pending_payment',
        stripe_checkout_session_id = null, updated_at = now()
      where id = selected_booking.id;
    end if;
    insert into private.stripe_checkout_sessions
      (booking_id, amount_total, currency)
    values (selected_booking.id,
      selected_booking.service_price_amount_snapshot, 'usd')
    returning * into selected_attempt;
  end if;

  return jsonb_build_object(
    'action', case when selected_attempt.status = 'open'
      then 'reuse' else 'create' end,
    'attempt_id', selected_attempt.attempt_id,
    'session_id', selected_attempt.session_id,
    'booking_id', selected_booking.id,
    'customer_email', selected_booking.customer_email,
    'service_id', selected_booking.service_id,
    'service_name', selected_booking.service_name_snapshot,
    'amount_total', selected_attempt.amount_total,
    'currency', selected_attempt.currency
  );
end;
$$;
alter function public.begin_stripe_checkout_attempt(uuid, text) owner to postgres;
revoke all on function public.begin_stripe_checkout_attempt(uuid, text)
  from public, anon, authenticated;
grant execute on function public.begin_stripe_checkout_attempt(uuid, text)
  to service_role;

create function public.register_stripe_checkout_session(
  p_attempt_id uuid,
  p_booking_id uuid,
  p_session_id text,
  p_amount_total integer,
  p_currency text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.stripe_checkout_sessions%rowtype;
  cleaned_session_id text := nullif(btrim(p_session_id), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  if p_attempt_id is null or p_booking_id is null
    or cleaned_session_id is null or p_expires_at is null
  then raise exception 'A complete Stripe Checkout registration is required.'; end if;

  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  select * into selected_attempt from private.stripe_checkout_sessions
  where attempt_id = p_attempt_id and booking_id = p_booking_id for update;
  if selected_booking.id is null or selected_attempt.attempt_id is null then
    raise exception 'The reserved Checkout attempt does not exist.';
  end if;

  if selected_attempt.status = 'open'
    and selected_attempt.session_id = cleaned_session_id
  then return false; end if;

  if selected_attempt.status <> 'creating'
    or selected_attempt.session_id is not null
    or selected_booking.status <> 'pending_payment'
    or selected_booking.payment_status <> 'unpaid'
    or selected_booking.service_payment_flow_snapshot <> 'embedded_checkout'
    or selected_attempt.amount_total <> p_amount_total
    or selected_attempt.currency <> p_currency
    or selected_booking.service_price_amount_snapshot <> p_amount_total
    or lower(selected_booking.service_currency_snapshot) <> p_currency
  then raise exception 'The booking is not eligible for this Checkout Session.'; end if;

  update private.stripe_checkout_sessions set
    session_id = cleaned_session_id, status = 'open',
    expires_at = p_expires_at, updated_at = now()
  where attempt_id = selected_attempt.attempt_id;
  update public.bookings set stripe_checkout_session_id = cleaned_session_id,
    updated_at = now() where id = selected_booking.id;
  return true;
end;
$$;
alter function public.register_stripe_checkout_session(uuid, uuid, text, integer, text, timestamptz)
  owner to postgres;
revoke all on function public.register_stripe_checkout_session(uuid, uuid, text, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_stripe_checkout_session(uuid, uuid, text, integer, text, timestamptz)
  to service_role;

create function public.get_stripe_payment_status(
  p_booking_id uuid,
  p_payment_access_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.stripe_checkout_sessions%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  select * into selected_booking from public.bookings where id = p_booking_id;
  if not found or not exists (
    select 1 from private.booking_payment_access as access
    where access.booking_id = p_booking_id
      and access.token_hash = extensions.digest(p_payment_access_token, 'sha256')
  ) then
    raise exception using errcode = '42501', message = 'Payment access is invalid.';
  end if;
  select * into selected_attempt from private.stripe_checkout_sessions
  where booking_id = selected_booking.id order by created_at desc limit 1;
  return jsonb_build_object(
    'booking_status', selected_booking.status,
    'payment_status', selected_booking.payment_status,
    'checkout_status', selected_attempt.status,
    'service_name', selected_booking.service_name_snapshot,
    'amount_total', selected_booking.service_price_amount_snapshot,
    'currency', lower(selected_booking.service_currency_snapshot),
    'paid', selected_booking.status = 'confirmed'
      and selected_booking.payment_status = 'paid',
    'can_restart', selected_booking.status = 'payment_expired'
      and selected_booking.payment_status = 'unpaid'
  );
end;
$$;
alter function public.get_stripe_payment_status(uuid, text) owner to postgres;
revoke all on function public.get_stripe_payment_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_stripe_payment_status(uuid, text)
  to service_role;

create function public.complete_stripe_checkout_payment(
  p_event_id text,
  p_booking_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_amount_total integer,
  p_currency text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.stripe_checkout_sessions%rowtype;
  email_config public.booking_email_config%rowtype;
  inserted_event_id text;
  cleaned_event_id text := nullif(btrim(p_event_id), '');
  cleaned_session_id text := nullif(btrim(p_session_id), '');
  cleaned_payment_intent_id text := nullif(btrim(p_payment_intent_id), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  if cleaned_event_id is null or p_booking_id is null
    or cleaned_session_id is null
  then raise exception 'Stripe event, booking and session identifiers are required.'; end if;

  -- Consistent lock order across initialization, completion and expiration.
  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  select * into selected_attempt from private.stripe_checkout_sessions
  where session_id = cleaned_session_id and booking_id = p_booking_id for update;
  if selected_booking.id is null or selected_attempt.attempt_id is null then
    raise exception 'The Stripe Checkout Session is not registered for this booking.';
  end if;
  if selected_attempt.amount_total <> p_amount_total
    or selected_attempt.currency <> p_currency
    or selected_booking.service_price_amount_snapshot <> p_amount_total
    or selected_booking.service_payment_flow_snapshot <> 'embedded_checkout'
    or lower(selected_booking.service_currency_snapshot) <> p_currency
  then raise exception 'Stripe payment totals do not match the booking snapshot.'; end if;

  insert into private.stripe_webhook_events (event_id, event_type, session_id)
  values (cleaned_event_id, 'checkout.session.completed', cleaned_session_id)
  on conflict (event_id) do nothing returning event_id into inserted_event_id;
  if inserted_event_id is null then return false; end if;
  if selected_booking.status = 'confirmed'
    and selected_booking.payment_status = 'paid'
    and selected_attempt.status = 'completed'
  then return false; end if;
  if selected_attempt.status <> 'open'
    or selected_booking.stripe_checkout_session_id <> cleaned_session_id
    or selected_booking.status <> 'pending_payment'
    or selected_booking.payment_status <> 'unpaid'
  then raise exception 'The booking is not awaiting this Stripe payment.'; end if;

  select * into email_config from public.booking_email_config where id = true;
  if not found then raise exception 'Booking email configuration has not been created.'; end if;

  update public.bookings set status = 'confirmed', payment_status = 'paid',
    amount_paid = p_amount_total::numeric / 100,
    paid_at = coalesce(paid_at, now()), payment_method = 'stripe',
    payment_reference = cleaned_session_id,
    confirmed_at = coalesce(confirmed_at, now()),
    stripe_checkout_session_id = cleaned_session_id,
    stripe_payment_intent_id = cleaned_payment_intent_id, updated_at = now()
  where id = selected_booking.id;
  update private.stripe_checkout_sessions set status = 'completed',
    completed_at = coalesce(completed_at, now()), updated_at = now()
  where attempt_id = selected_attempt.attempt_id;

  -- One coherent customer email confirms both acceptance and settled payment.
  perform public.queue_booking_email(
    selected_booking.id, 'booking_confirmed', selected_booking.customer_email,
    selected_booking.customer_name, jsonb_build_object(
      'booking_id', selected_booking.id,
      'customer_name', selected_booking.customer_name,
      'customer_email', selected_booking.customer_email,
      'service_name', selected_booking.service_name_snapshot,
      'service_booking_mode', selected_booking.service_booking_mode_snapshot,
      'service_currency', selected_booking.service_currency_snapshot,
      'embedded_checkout_payment', true,
      'payment_status', 'paid',
      'amount_due', p_amount_total::numeric / 100,
      'amount_paid', p_amount_total::numeric / 100
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
      'payment_status', 'paid',
      'amount_due', p_amount_total::numeric / 100,
      'amount_paid', p_amount_total::numeric / 100,
      'payment_method', 'stripe',
      'payment_reference', cleaned_session_id
    ))
  );
  return true;
end;
$$;
alter function public.complete_stripe_checkout_payment(text, uuid, text, text, integer, text)
  owner to postgres;
revoke all on function public.complete_stripe_checkout_payment(text, uuid, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.complete_stripe_checkout_payment(text, uuid, text, text, integer, text)
  to service_role;

create function public.expire_stripe_checkout_payment(
  p_event_id text,
  p_booking_id uuid,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_attempt private.stripe_checkout_sessions%rowtype;
  inserted_event_id text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  select * into selected_attempt from private.stripe_checkout_sessions
  where session_id = p_session_id and booking_id = p_booking_id for update;
  if selected_booking.id is null or selected_attempt.attempt_id is null then
    raise exception 'The Stripe Checkout Session is not registered for this booking.';
  end if;
  insert into private.stripe_webhook_events (event_id, event_type, session_id)
  values (nullif(btrim(p_event_id), ''), 'checkout.session.expired', p_session_id)
  on conflict (event_id) do nothing returning event_id into inserted_event_id;
  if inserted_event_id is null then return false; end if;
  if selected_attempt.status in ('completed', 'expired') then return false; end if;

  update private.stripe_checkout_sessions set status = 'expired',
    expired_at = coalesce(expired_at, now()), updated_at = now()
  where attempt_id = selected_attempt.attempt_id;
  if selected_booking.status = 'pending_payment'
    and selected_booking.payment_status = 'unpaid'
    and selected_booking.stripe_checkout_session_id = p_session_id
  then
    update public.bookings set status = 'payment_expired',
      stripe_checkout_session_id = null, updated_at = now()
    where id = selected_booking.id;
  end if;
  return true;
end;
$$;
alter function public.expire_stripe_checkout_payment(text, uuid, text)
  owner to postgres;
revoke all on function public.expire_stripe_checkout_payment(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.expire_stripe_checkout_payment(text, uuid, text)
  to service_role;

-- Optional scheduler target for attempts abandoned before Stripe Session
-- registration completed. Registered/open Session expiry remains exclusively
-- authoritative through Stripe's signed checkout.session.expired webhook.
-- No cron job is installed here.
create function public.expire_stale_stripe_checkouts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale_candidate record;
  selected_booking public.bookings%rowtype;
  selected_attempt private.stripe_checkout_sessions%rowtype;
  expired_count integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  for stale_candidate in
    select attempt.attempt_id, attempt.booking_id
    from private.stripe_checkout_sessions as attempt
    where attempt.status = 'creating'
      and attempt.created_at < now() - interval '1 hour'
  loop
    -- Match checkout initialization, registration and webhook lock order:
    -- booking first, then checkout attempt.
    select * into selected_booking
    from public.bookings
    where id = stale_candidate.booking_id
    for update;

    if not found then
      continue;
    end if;

    select * into selected_attempt
    from private.stripe_checkout_sessions
    where attempt_id = stale_candidate.attempt_id
      and booking_id = selected_booking.id
    for update;

    -- Revalidate after both locks. Registered/open Sessions are never expired
    -- by local database time; Stripe's signed expiry webhook owns that state.
    if not found
      or selected_attempt.status <> 'creating'
      or selected_attempt.session_id is not null
      or selected_attempt.created_at >= now() - interval '1 hour'
      or selected_booking.status <> 'pending_payment'
      or selected_booking.payment_status <> 'unpaid'
      or selected_booking.stripe_checkout_session_id is not null
    then
      continue;
    end if;

    update private.stripe_checkout_sessions set status = 'expired',
      expired_at = coalesce(expired_at, now()), updated_at = now()
    where attempt_id = selected_attempt.attempt_id;
    update public.bookings set status = 'payment_expired',
      stripe_checkout_session_id = null, updated_at = now()
    where id = selected_booking.id;
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;
alter function public.expire_stale_stripe_checkouts() owner to postgres;
revoke all on function public.expire_stale_stripe_checkouts()
  from public, anon, authenticated;
grant execute on function public.expire_stale_stripe_checkouts()
  to service_role;

-- Stripe-owned lifecycle/payment fields are protected from ordinary admin
-- mutations. The database guards remain authoritative if UI controls regress.
create or replace function public.cancel_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare selected_booking public.bookings%rowtype;
begin
  perform private.require_admin();
  select * into selected_booking from public.bookings
  where id = p_booking_id for update;
  if selected_booking.service_payment_flow_snapshot = 'embedded_checkout'
    and selected_booking.status <> 'payment_expired'
  then
    raise exception 'Stripe bookings cannot be cancelled while payment is active or settled.';
  end if;
  return private.cancel_booking(p_booking_id);
end;
$$;

create or replace function public.update_booking_status(
  p_booking_id uuid,
  p_status text
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare selected_booking public.bookings%rowtype;
begin
  perform private.require_admin();
  select * into selected_booking from public.bookings where id = p_booking_id;
  if selected_booking.service_payment_flow_snapshot = 'embedded_checkout'
    and selected_booking.status in ('pending_payment', 'payment_expired')
  then raise exception 'Stripe controls confirmation for this booking.'; end if;
  if selected_booking.service_payment_flow_snapshot = 'embedded_checkout'
    and p_status in ('pending', 'confirmed')
  then
    raise exception 'A settled Stripe booking cannot return to a manual payment state.';
  end if;
  return private.update_booking_status(p_booking_id, p_status);
end;
$$;

create or replace function public.update_booking_payment(
  p_booking_id uuid,
  p_payment_status text,
  p_amount_due numeric,
  p_amount_paid numeric,
  p_payment_method text default null,
  p_payment_reference text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare selected_booking public.bookings%rowtype;
begin
  perform private.require_admin();
  select * into selected_booking from public.bookings where id = p_booking_id;
  if selected_booking.service_payment_flow_snapshot = 'embedded_checkout' then
    raise exception 'Stripe-controlled payment fields are read-only.';
  end if;
  return private.update_booking_payment(
    p_booking_id, p_payment_status, p_amount_due, p_amount_paid,
    p_payment_method, p_payment_reference
  );
end;
$$;

alter function public.cancel_booking(uuid) owner to postgres;
alter function public.update_booking_status(uuid, text) owner to postgres;
alter function public.update_booking_payment(uuid, text, numeric, numeric, text, text)
  owner to postgres;
revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.update_booking_status(uuid, text) from public, anon;
revoke all on function public.update_booking_payment(uuid, text, numeric, numeric, text, text)
  from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated, service_role;
grant execute on function public.update_booking_status(uuid, text)
  to authenticated, service_role;
grant execute on function public.update_booking_payment(uuid, text, numeric, numeric, text, text)
  to authenticated, service_role;

comment on function public.create_pending_payment_booking(uuid, text, text, text, text) is
  'Creates an eligible paid untimed request and returns a one-time opaque recovery token.';
comment on table private.stripe_checkout_sessions is
  'Server-only attempts; at most one creating/open attempt exists per booking.';
comment on table private.stripe_webhook_events is
  'Server-only Stripe event idempotency ledger.';
comment on function public.expire_stale_stripe_checkouts() is
  'Optional scheduler target; this migration does not install a cron job.';
