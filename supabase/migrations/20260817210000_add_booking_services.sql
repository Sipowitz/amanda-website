-- Introduce the public service catalogue and support timed and untimed bookings.
-- Existing bookings and their queued emails are test data and are reset here.

-- Serialize the destructive test-data reset with any in-flight legacy booking
-- request. The locks are held only for this migration transaction.
lock table public.availability_slots in access exclusive mode;
lock table public.bookings in access exclusive mode;

-- Prevent stale queue messages from referencing booking/email-log rows removed
-- by this migration.
select pgmq.purge_queue('booking_emails');

delete from public.bookings;

update public.availability_slots
set is_available = true
where is_available is distinct from true;

create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  booking_mode text not null,
  duration_minutes integer,
  price_amount integer not null,
  currency text not null default 'USD',
  payment_required boolean not null default true,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_slug_check
    check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint services_name_check
    check (btrim(name) <> ''),
  constraint services_booking_mode_check
    check (booking_mode in ('timed', 'untimed')),
  constraint services_duration_check
    check (
      (booking_mode = 'timed' and duration_minutes is not null and duration_minutes > 0)
      or
      (booking_mode = 'untimed' and duration_minutes is null)
    ),
  constraint services_price_amount_check
    check (price_amount >= 0),
  constraint services_currency_check
    check (currency = 'USD'),
  constraint services_display_order_check
    check (display_order >= 0)
);

alter table public.services owner to postgres;
alter table public.services enable row level security;

create index services_active_display_order_index
  on public.services (is_active, display_order, name);

insert into public.services (
  slug,
  name,
  booking_mode,
  duration_minutes,
  price_amount,
  currency,
  payment_required,
  is_active,
  display_order
)
values
  ('private-readings', 'Private Readings', 'timed', 60, 8500, 'USD', true, true, 10),
  ('wheel-of-the-year', 'Wheel of the Year', 'timed', 60, 8500, 'USD', true, true, 20),
  ('voice-memo-reading', 'Voice Memo Reading', 'untimed', null, 2000, 'USD', true, true, 30);

revoke all on table public.services from public, anon, authenticated;
grant all on table public.services to authenticated, service_role;

create policy "Admins can manage services"
on public.services
to authenticated
using (public.is_admin())
with check (public.is_admin());

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
  display_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    service.id,
    service.slug,
    service.name,
    service.booking_mode,
    service.duration_minutes,
    service.price_amount,
    service.currency,
    service.payment_required,
    service.display_order
  from public.services as service
  where service.is_active is true
  order by service.display_order, service.name;
$$;

alter function public.get_active_services() owner to postgres;
revoke all on function public.get_active_services() from public;
grant execute on function public.get_active_services()
  to anon, authenticated, service_role;

alter table public.bookings
  alter column slot_id drop not null,
  add column service_id uuid not null,
  add column service_name_snapshot text not null,
  add column service_booking_mode_snapshot text not null,
  add column service_duration_minutes_snapshot integer,
  add column service_price_amount_snapshot integer not null,
  add column service_currency_snapshot text not null;

alter table public.bookings
  add constraint bookings_service_id_fkey
    foreign key (service_id)
    references public.services(id)
    on delete restrict,
  add constraint bookings_service_name_snapshot_check
    check (btrim(service_name_snapshot) <> ''),
  add constraint bookings_service_booking_mode_snapshot_check
    check (service_booking_mode_snapshot in ('timed', 'untimed')),
  add constraint bookings_service_duration_snapshot_check
    check (
      (
        service_booking_mode_snapshot = 'timed'
        and slot_id is not null
        and service_duration_minutes_snapshot is not null
        and service_duration_minutes_snapshot > 0
      )
      or
      (
        service_booking_mode_snapshot = 'untimed'
        and slot_id is null
        and service_duration_minutes_snapshot is null
      )
    ),
  add constraint bookings_service_price_snapshot_check
    check (service_price_amount_snapshot >= 0),
  add constraint bookings_service_currency_snapshot_check
    check (service_currency_snapshot = 'USD');

create index bookings_service_id_index
  on public.bookings (service_id);

-- Replace the legacy slot-first public signature. Price and currency are never
-- accepted from callers.
drop function public.create_booking_request(uuid, text, text, text, text);

create function public.create_booking_request(
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
        and status <> 'cancelled'
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

  -- Existing payment columns remain major-unit numeric USD values. Catalogue
  -- and snapshot prices are integer cents.
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

-- TRANSITIONAL COMPATIBILITY ONLY.
-- Keep the legacy slot-first API available while older frontend assets may
-- still be cached or served. Legacy requests always resolve the active
-- Private Readings catalogue row by slug and delegate all validation, slot
-- locking, snapshotting, pricing and email queueing to the service-aware RPC.
-- Remove this overload after the service-aware frontend is fully deployed.
create function public.create_booking_request(
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
  private_readings_service_id uuid;
begin
  select service.id
  into private_readings_service_id
  from public.services as service
  where service.slug = 'private-readings'
    and service.booking_mode = 'timed'
    and service.is_active is true;

  if not found then
    raise exception 'Private Readings is not currently available.';
  end if;

  return public.create_booking_request(
    private_readings_service_id,
    p_slot_id,
    p_customer_name,
    p_customer_email,
    p_customer_phone,
    p_customer_message
  );
end;
$$;

alter function public.create_booking_request(uuid, text, text, text, text)
  owner to postgres;
revoke all on function public.create_booking_request(uuid, text, text, text, text)
  from public;
grant execute on function public.create_booking_request(uuid, text, text, text, text)
  to anon, authenticated, service_role;

comment on function public.create_booking_request(uuid, text, text, text, text) is
  'Transitional legacy booking API; maps requests to active Private Readings and must be removed after the service-aware frontend rollout.';

-- Enrich every queued email from immutable booking snapshots. Caller payloads
-- cannot override these trusted values.
create or replace function public.queue_booking_email(
  p_booking_id uuid,
  p_email_type text,
  p_recipient_email text,
  p_recipient_name text,
  p_payload jsonb,
  p_reminder_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking_context public.bookings%rowtype;
  new_log_id uuid;
  new_queue_message_id bigint;
  cleaned_recipient_email text;
  cleaned_recipient_name text;
  cleaned_reminder_key text;
  is_reminder_email boolean;
  enriched_payload jsonb;
begin
  if p_booking_id is null then
    raise exception 'A booking ID is required.';
  end if;

  if p_email_type not in (
    'booking_request_customer',
    'booking_request_admin',
    'booking_confirmed',
    'booking_cancelled',
    'part_payment_received',
    'payment_received',
    'booking_reminder_24h',
    'booking_reminder_customer',
    'booking_reminder_admin'
  ) then
    raise exception 'Invalid booking email type.';
  end if;

  cleaned_recipient_email := lower(nullif(btrim(p_recipient_email), ''));
  cleaned_recipient_name := nullif(btrim(p_recipient_name), '');
  cleaned_reminder_key := nullif(btrim(p_reminder_key), '');

  is_reminder_email := p_email_type in (
    'booking_reminder_24h',
    'booking_reminder_customer',
    'booking_reminder_admin'
  );

  if cleaned_recipient_email is null then
    raise exception 'A recipient email address is required.';
  end if;

  if is_reminder_email and cleaned_reminder_key is null then
    raise exception 'A reminder key is required for reminder emails.';
  end if;

  if not is_reminder_email and cleaned_reminder_key is not null then
    raise exception 'A reminder key may only be used for reminder emails.';
  end if;

  select *
  into booking_context
  from public.bookings
  where id = p_booking_id;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  enriched_payload := jsonb_strip_nulls(
    coalesce(p_payload, '{}'::jsonb)
    || jsonb_build_object(
      'service_id', booking_context.service_id,
      'service_name', booking_context.service_name_snapshot,
      'service_booking_mode', booking_context.service_booking_mode_snapshot,
      'service_duration_minutes', booking_context.service_duration_minutes_snapshot,
      'service_price_amount', booking_context.service_price_amount_snapshot,
      'service_currency', booking_context.service_currency_snapshot,
      'amount_due', booking_context.amount_due
    )
  );

  insert into public.booking_email_log (
    booking_id,
    email_type,
    recipient_email,
    recipient_name,
    reminder_key,
    status,
    created_at,
    updated_at
  )
  values (
    p_booking_id,
    p_email_type,
    cleaned_recipient_email,
    cleaned_recipient_name,
    cleaned_reminder_key,
    'queued',
    now(),
    now()
  )
  on conflict do nothing
  returning id
  into new_log_id;

  if new_log_id is null then
    select id
    into new_log_id
    from public.booking_email_log
    where booking_id = p_booking_id
      and email_type = p_email_type
      and recipient_email = cleaned_recipient_email
      and reminder_key is not distinct from cleaned_reminder_key
    order by created_at desc
    limit 1;

    return new_log_id;
  end if;

  select pgmq_public.send(
    queue_name => 'booking_emails',
    message => jsonb_build_object(
      'email_log_id', new_log_id,
      'booking_id', p_booking_id,
      'email_type', p_email_type,
      'recipient_email', cleaned_recipient_email,
      'recipient_name', cleaned_recipient_name,
      'reminder_key', cleaned_reminder_key,
      'payload', enriched_payload
    )
  )
  into new_queue_message_id;

  update public.booking_email_log
  set
    queue_message_id = new_queue_message_id,
    updated_at = now()
  where id = new_log_id;

  return new_log_id;
end;
$$;

alter function public.queue_booking_email(uuid, text, text, text, jsonb, text)
  owner to postgres;
revoke all on function public.queue_booking_email(uuid, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.queue_booking_email(uuid, text, text, text, jsonb, text)
  to service_role;

-- Private admin implementations retain their public admin-guard wrappers, but
-- now tolerate the intentionally null slot on untimed bookings.
create or replace function private.cancel_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_booking public.bookings%rowtype;
  selected_slot public.availability_slots%rowtype;
begin
  if p_booking_id is null then
    raise exception 'A booking ID is required.';
  end if;

  select *
  into selected_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  if selected_booking.status = 'cancelled' then
    raise exception 'The booking has already been cancelled.';
  end if;

  if selected_booking.slot_id is not null then
    select *
    into selected_slot
    from public.availability_slots
    where id = selected_booking.slot_id;

    if not found then
      raise exception 'The booking slot does not exist.';
    end if;
  end if;

  update public.bookings
  set
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  where id = p_booking_id;

  if selected_booking.slot_id is not null then
    update public.availability_slots
    set is_available = true
    where id = selected_booking.slot_id;
  end if;

  perform public.queue_booking_email(
    selected_booking.id,
    'booking_cancelled',
    selected_booking.customer_email,
    selected_booking.customer_name,
    jsonb_strip_nulls(jsonb_build_object(
      'customer_name', selected_booking.customer_name,
      'slot_date', selected_slot.slot_date,
      'slot_time', selected_slot.slot_time
    ))
  );

  return true;
end;
$$;

alter function private.cancel_booking(uuid) owner to postgres;
revoke all on function private.cancel_booking(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.update_booking_status(
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
  selected_slot public.availability_slots%rowtype;
  updated_booking public.bookings%rowtype;
begin
  if p_booking_id is null then
    raise exception 'A booking ID is required.';
  end if;

  if p_status not in ('pending', 'confirmed', 'completed', 'no_show') then
    raise exception 'Invalid booking status.';
  end if;

  select *
  into selected_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  if selected_booking.status = 'cancelled' then
    raise exception 'A cancelled booking cannot be changed.';
  end if;

  if selected_booking.slot_id is not null then
    select *
    into selected_slot
    from public.availability_slots
    where id = selected_booking.slot_id;

    if not found then
      raise exception 'The booking slot does not exist.';
    end if;
  end if;

  update public.bookings
  set
    status = p_status,
    confirmed_at = case
      when p_status = 'confirmed' then coalesce(confirmed_at, now())
      when p_status = 'pending' then null
      else confirmed_at
    end,
    completed_at = case
      when p_status = 'completed' then coalesce(completed_at, now())
      when p_status in ('pending', 'confirmed') then null
      else completed_at
    end,
    updated_at = now()
  where id = p_booking_id
  returning *
  into updated_booking;

  if p_status = 'confirmed' and selected_booking.status <> 'confirmed' then
    perform public.queue_booking_email(
      updated_booking.id,
      'booking_confirmed',
      updated_booking.customer_email,
      updated_booking.customer_name,
      jsonb_strip_nulls(jsonb_build_object(
        'customer_name', updated_booking.customer_name,
        'slot_date', selected_slot.slot_date,
        'slot_time', selected_slot.slot_time
      ))
    );
  end if;

  return updated_booking;
end;
$$;

alter function private.update_booking_status(uuid, text) owner to postgres;
revoke all on function private.update_booking_status(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.update_booking_payment(
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
declare
  selected_booking public.bookings%rowtype;
  selected_slot public.availability_slots%rowtype;
  updated_booking public.bookings%rowtype;
  cleaned_payment_method text;
  cleaned_payment_reference text;
  previous_amount_paid numeric;
  payment_increased boolean;
begin
  if p_booking_id is null then
    raise exception 'A booking ID is required.';
  end if;

  if p_payment_status not in ('unpaid', 'part_paid', 'paid', 'waived') then
    raise exception 'Invalid payment status.';
  end if;

  if p_amount_due is null or p_amount_due < 0 then
    raise exception 'Amount due must be zero or greater.';
  end if;

  if p_amount_paid is null or p_amount_paid < 0 then
    raise exception 'Amount paid must be zero or greater.';
  end if;

  cleaned_payment_method := nullif(btrim(p_payment_method), '');
  cleaned_payment_reference := nullif(btrim(p_payment_reference), '');

  if cleaned_payment_method is not null
    and cleaned_payment_method not in (
      'cash',
      'bank_transfer',
      'card',
      'payment_link',
      'stripe',
      'complimentary',
      'other'
    )
  then
    raise exception 'Invalid payment method.';
  end if;

  select *
  into selected_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  if selected_booking.slot_id is not null then
    select *
    into selected_slot
    from public.availability_slots
    where id = selected_booking.slot_id;

    if not found then
      raise exception 'The booking slot does not exist.';
    end if;
  end if;

  previous_amount_paid := coalesce(selected_booking.amount_paid, 0);
  payment_increased := p_amount_paid > previous_amount_paid;

  if p_payment_status = 'unpaid' and p_amount_paid <> 0 then
    raise exception 'An unpaid booking must have an amount paid of zero.';
  end if;

  if p_payment_status = 'part_paid' then
    if p_amount_due <= 0 then
      raise exception 'A part-paid booking must have an amount due greater than zero.';
    end if;

    if p_amount_paid <= 0 or p_amount_paid >= p_amount_due then
      raise exception 'A part payment must be greater than zero and less than the amount due.';
    end if;

    if cleaned_payment_method is null then
      raise exception 'A payment method is required when recording a part payment.';
    end if;
  end if;

  if p_payment_status = 'paid' then
    if p_amount_due <= 0 then
      raise exception 'A paid booking must have an amount due greater than zero.';
    end if;

    if p_amount_paid < p_amount_due then
      raise exception 'The amount paid must cover the full amount due.';
    end if;

    if cleaned_payment_method is null then
      raise exception 'A payment method is required when marking a booking as paid.';
    end if;
  end if;

  if p_payment_status = 'waived' then
    if p_amount_paid <> 0 then
      raise exception 'A waived booking must have an amount paid of zero.';
    end if;

    cleaned_payment_method := 'complimentary';
  end if;

  update public.bookings
  set
    payment_status = p_payment_status,
    amount_due = p_amount_due,
    amount_paid = p_amount_paid,
    payment_method = cleaned_payment_method,
    payment_reference = cleaned_payment_reference,
    paid_at = case
      when p_payment_status = 'paid' then coalesce(paid_at, now())
      else null
    end,
    updated_at = now()
  where id = p_booking_id
  returning *
  into updated_booking;

  if payment_increased and p_payment_status = 'part_paid' then
    perform public.queue_booking_email(
      updated_booking.id,
      'part_payment_received',
      updated_booking.customer_email,
      updated_booking.customer_name,
      jsonb_strip_nulls(jsonb_build_object(
        'customer_name', updated_booking.customer_name,
        'slot_date', selected_slot.slot_date,
        'slot_time', selected_slot.slot_time,
        'amount_due', updated_booking.amount_due,
        'amount_paid', updated_booking.amount_paid,
        'amount_received', updated_booking.amount_paid - previous_amount_paid,
        'amount_remaining', greatest(
          updated_booking.amount_due - updated_booking.amount_paid,
          0
        ),
        'payment_method', updated_booking.payment_method,
        'payment_reference', updated_booking.payment_reference
      ))
    );
  end if;

  if payment_increased
    and p_payment_status = 'paid'
    and selected_booking.payment_status <> 'paid'
  then
    perform public.queue_booking_email(
      updated_booking.id,
      'payment_received',
      updated_booking.customer_email,
      updated_booking.customer_name,
      jsonb_strip_nulls(jsonb_build_object(
        'customer_name', updated_booking.customer_name,
        'slot_date', selected_slot.slot_date,
        'slot_time', selected_slot.slot_time,
        'amount_due', updated_booking.amount_due,
        'amount_paid', updated_booking.amount_paid,
        'amount_received', updated_booking.amount_paid - previous_amount_paid,
        'amount_remaining', 0,
        'payment_method', updated_booking.payment_method,
        'payment_reference', updated_booking.payment_reference
      ))
    );
  end if;

  return updated_booking;
end;
$$;

alter function private.update_booking_payment(uuid, text, numeric, numeric, text, text)
  owner to postgres;
revoke all on function private.update_booking_payment(uuid, text, numeric, numeric, text, text)
  from public, anon, authenticated, service_role;

comment on table public.services is
  'Safe public service catalogue; prices are integer USD cents.';
comment on column public.bookings.amount_due is
  'Administrative amount due in major-unit USD, initialized from the service price.';
comment on column public.bookings.amount_paid is
  'Administrative amount paid in major-unit USD.';
comment on column public.bookings.service_price_amount_snapshot is
  'Booked service price snapshot in integer USD cents.';
