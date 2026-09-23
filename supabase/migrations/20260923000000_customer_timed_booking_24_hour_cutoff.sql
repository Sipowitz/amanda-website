-- Customer timed bookings require 24 hours notice, measured on the stored
-- business-time appointment instant against database time. This helper is
-- invoked only after the selected slot has been locked by the creation RPC.
create function private.slot_is_bookable_for_customer(
  p_slot_id uuid,
  p_now timestamptz default clock_timestamp()
) returns boolean language sql volatile security definer set search_path = '' as $$
  select coalesce((select slot.starts_at >= p_now + interval '24 hours'
    from public.availability_slots as slot where slot.id = p_slot_id), false);
$$;
alter function private.slot_is_bookable_for_customer(uuid,timestamptz) owner to postgres;
revoke all on function private.slot_is_bookable_for_customer(uuid,timestamptz)
  from public, anon, authenticated, service_role;

-- Preserve admin visibility and slot management. Only the public SELECT policy
-- changes, so existing and near-term slots remain stored.
drop policy "Public can view future available slots" on public.availability_slots;
create policy "Public can view future available slots" on public.availability_slots
for select to anon, authenticated
using (is_available is true and starts_at >= clock_timestamp() + interval '24 hours');

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

    if not private.slot_is_bookable_for_customer(selected_slot.id) then
      raise exception 'This appointment requires at least 24 hours notice.';
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

  -- Recheck after email configuration and other validation: the cutoff may
  -- have elapsed while this transaction held the slot lock.
  if selected_service.booking_mode = 'timed' then
    if not private.slot_is_bookable_for_customer(selected_slot.id) then
      raise exception 'This appointment requires at least 24 hours notice.';
    end if;
  end if;

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

create or replace function private.create_pending_payment_booking_with_review_guard(
  p_service_id uuid, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_message text, p_slot_id uuid,
  p_discount_code text, p_review_guard text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  service public.services%rowtype; slot public.availability_slots%rowtype;
  calculated record; booking_id uuid; pricing_id uuid; access_token text;
  name text := nullif(btrim(p_customer_name), '');
  email text := lower(nullif(btrim(p_customer_email), ''));
  phone text := nullif(btrim(p_customer_phone), '');
  message text := nullif(btrim(p_customer_message), '');
  code text := nullif(btrim(p_discount_code), '');
  expected_guard text;
begin
  if p_service_id is null or name is null or email is null then
    raise exception 'A service, customer name, and customer email are required.';
  end if;
  select * into service from public.services where id = p_service_id for share;
  if not found or service.is_active is not true or service.payment_required is not true
    or service.payment_flow <> 'direct_payment' or service.price_amount <= 0
    or service.currency <> 'USD' then
    if p_review_guard is not null then
      raise exception using errcode = 'ZX001', message = 'Price review is required.';
    end if;
    raise exception 'The selected service is not eligible for direct payment.';
  end if;
  if service.booking_mode = 'timed' then
    if p_slot_id is null then raise exception 'A booking slot is required for this service.'; end if;
    select * into slot from public.availability_slots where id = p_slot_id for update;
    if not found or slot.is_available is not true or exists (
        select 1 from public.bookings where slot_id = p_slot_id
          and status in ('pending','pending_payment','confirmed','completed','no_show')
      ) then raise exception 'The selected booking slot is no longer available.'; end if;
    if not private.slot_is_bookable_for_customer(slot.id) then
      raise exception 'This appointment requires at least 24 hours notice.';
    end if;
  elsif service.booking_mode = 'untimed' then
    if p_slot_id is not null then raise exception 'A booking slot must not be supplied for this service.'; end if;
    if message is null then raise exception 'A reading topic or question is required.'; end if;
  else raise exception 'The selected service has an invalid booking mode.'; end if;

  if code is null then
    select service.id as service_id, service.price_amount as original_amount_minor,
      0::integer as discount_amount_minor, service.price_amount as final_amount_minor,
      service.currency as currency, null::uuid as discount_code_id, null::text as discount_code,
      null::integer as percentage_off, null::integer as discount_code_revision into calculated;
    if p_review_guard is not null then
      raise exception using errcode = 'ZX001', message = 'Price review is required.';
    end if;
  else
    begin
      select * into calculated from private.calculate_discount_pricing(service.id, code);
      -- The initial calculation identifies the immutable definition.  Hold its
      -- row stable, then calculate again so an admin edit that won this race is
      -- observed before any booking artifacts are created.  Admin mutation RPCs
      -- take FOR UPDATE on this same row before changing scope/mappings.
      perform 1 from private.discount_codes
      where id = calculated.discount_code_id
      for share;
      if not found then
        raise exception using errcode = 'ZX001', message = 'Price review is required.';
      end if;
      select * into calculated from private.calculate_discount_pricing(service.id, code);
    exception when raise_exception then
      if p_review_guard is not null then
        raise exception using errcode = 'ZX001', message = 'Price review is required.';
      end if;
      raise;
    end;
    if p_review_guard is not null then
      expected_guard := private.build_discount_review_guard(
        calculated.service_id, calculated.discount_code_id, calculated.discount_code,
        calculated.original_amount_minor, calculated.percentage_off,
        calculated.discount_amount_minor, calculated.final_amount_minor,
        calculated.currency, calculated.discount_code_revision
      );
      if not private.discount_review_guard_digests_equal(
        decode(p_review_guard, 'hex'), decode(expected_guard, 'hex')
      ) then
        raise exception using errcode = 'ZX001', message = 'Price review is required.';
      end if;
    end if;
  end if;

  -- Discount validation can wait on an admin-held definition lock. Sample a
  -- fresh database clock after that work and immediately before insertion.
  if service.booking_mode = 'timed' then
    if not private.slot_is_bookable_for_customer(slot.id) then
      raise exception 'This appointment requires at least 24 hours notice.';
    end if;
  end if;

  insert into public.bookings (
    service_id, service_name_snapshot, service_booking_mode_snapshot,
    service_duration_minutes_snapshot, service_price_amount_snapshot,
    service_currency_snapshot, service_payment_flow_snapshot, slot_id,
    customer_name, customer_email, customer_phone, customer_message,
    status, payment_status, amount_due, amount_paid, updated_at
  ) values (
    service.id, service.name, service.booking_mode, service.duration_minutes,
    service.price_amount, service.currency, service.payment_flow, p_slot_id,
    name, email, phone, message, 'pending_payment', 'unpaid',
    calculated.final_amount_minor::numeric / 100, 0, now()
  ) returning id into booking_id;
  insert into private.booking_pricing (
    booking_id, service_id, original_amount_minor, discount_amount_minor,
    final_amount_minor, currency, discount_code_id, discount_code_snapshot,
    discount_percentage_snapshot, discount_code_revision
  ) values (
    booking_id, service.id, calculated.original_amount_minor,
    calculated.discount_amount_minor, calculated.final_amount_minor,
    calculated.currency, calculated.discount_code_id, calculated.discount_code,
    calculated.percentage_off, calculated.discount_code_revision
  ) returning id into pricing_id;
  access_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.booking_payment_access(booking_id, token_hash)
    values (booking_id, extensions.digest(access_token, 'sha256'));
  insert into private.payment_attempts(booking_id,provider,idempotency_key,amount_minor,currency,pricing_id)
  values (booking_id,'square','sq-' || replace(gen_random_uuid()::text, '-', ''),
    calculated.final_amount_minor,calculated.currency,pricing_id);
  if service.booking_mode = 'timed' then
    update public.availability_slots set is_available = false where id = slot.id;
  end if;
  return jsonb_build_object('booking_id', booking_id, 'payment_access_token', access_token);
end;
$$;

notify pgrst, 'reload schema';
