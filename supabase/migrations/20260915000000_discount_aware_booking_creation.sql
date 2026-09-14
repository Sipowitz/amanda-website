-- Stage 2: freeze authoritative optional-discount pricing when a direct
-- payment booking is created. Square clients and customer UI remain unchanged.

drop trigger bookings_create_undiscounted_pricing on public.bookings;
drop function private.create_undiscounted_booking_pricing();

create function private.create_pending_payment_booking_with_pricing(
  p_service_id uuid, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_message text, p_slot_id uuid,
  p_discount_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  service public.services%rowtype; slot public.availability_slots%rowtype;
  calculated record; booking_id uuid; pricing_id uuid; access_token text;
  name text := nullif(btrim(p_customer_name), '');
  email text := lower(nullif(btrim(p_customer_email), ''));
  phone text := nullif(btrim(p_customer_phone), '');
  message text := nullif(btrim(p_customer_message), '');
  code text := nullif(btrim(p_discount_code), '');
begin
  if p_service_id is null or name is null or email is null then
    raise exception 'A service, customer name, and customer email are required.';
  end if;
  select * into service from public.services where id = p_service_id for share;
  if not found or service.is_active is not true or service.payment_required is not true
    or service.payment_flow <> 'direct_payment' or service.price_amount <= 0
    or service.currency <> 'USD' then
    raise exception 'The selected service is not eligible for direct payment.';
  end if;
  if service.booking_mode = 'timed' then
    if p_slot_id is null then raise exception 'A booking slot is required for this service.'; end if;
    select * into slot from public.availability_slots where id = p_slot_id for update;
    if not found or not private.slot_is_future(slot.slot_date, slot.slot_time)
      or slot.is_available is not true or exists (
        select 1 from public.bookings where slot_id = p_slot_id
          and status in ('pending','pending_payment','confirmed','completed','no_show')
      ) then raise exception 'The selected booking slot is no longer available.'; end if;
  elsif service.booking_mode = 'untimed' then
    if p_slot_id is not null then raise exception 'A booking slot must not be supplied for this service.'; end if;
    if message is null then raise exception 'A reading topic or question is required.'; end if;
  else raise exception 'The selected service has an invalid booking mode.'; end if;

  if code is null then
    select service.id as service_id, service.price_amount as original_amount_minor,
      0::integer as discount_amount_minor, service.price_amount as final_amount_minor,
      service.currency as currency, null::uuid as discount_code_id, null::text as discount_code,
      null::integer as percentage_off, null::integer as discount_code_revision into calculated;
  else
    select * into calculated from private.calculate_discount_pricing(service.id, code);
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
  insert into private.payment_attempts(
    booking_id, provider, idempotency_key, amount_minor, currency, pricing_id
  ) values (
    booking_id, 'square', 'sq-' || replace(gen_random_uuid()::text, '-', ''),
    calculated.final_amount_minor, calculated.currency, pricing_id
  );
  if service.booking_mode = 'timed' then
    update public.availability_slots set is_available = false where id = slot.id;
  end if;
  return jsonb_build_object('booking_id', booking_id, 'payment_access_token', access_token);
end;
$$;
alter function private.create_pending_payment_booking_with_pricing(uuid,text,text,text,text,uuid,text) owner to postgres;
revoke all on function private.create_pending_payment_booking_with_pricing(uuid,text,text,text,text,uuid,text) from public, anon, authenticated, service_role;

-- Exact existing RPC signature: deployed clients continue to omit a code.
create or replace function public.create_pending_payment_booking(
  p_service_id uuid, p_customer_name text, p_customer_email text,
  p_customer_phone text default null, p_customer_message text default null,
  p_slot_id uuid default null
) returns jsonb language sql security definer set search_path = '' as $$
  select private.create_pending_payment_booking_with_pricing($1,$2,$3,$4,$5,$6,null);
$$;

-- Future callers must deliberately supply the seventh nullable argument.
create function public.create_pending_payment_booking(
  p_service_id uuid, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_message text, p_slot_id uuid,
  p_discount_code text
) returns jsonb language sql security definer set search_path = '' as $$
  select private.create_pending_payment_booking_with_pricing($1,$2,$3,$4,$5,$6,$7);
$$;
alter function public.create_pending_payment_booking(uuid,text,text,text,text,uuid,text) owner to postgres;
revoke all on function public.create_pending_payment_booking(uuid,text,text,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.create_pending_payment_booking(uuid,text,text,text,text,uuid,text) to service_role;

create function private.direct_booking_pricing(p_booking_id uuid)
returns private.booking_pricing language plpgsql stable security definer set search_path = '' as $$
declare result private.booking_pricing%rowtype;
begin
  select * into result from private.booking_pricing where booking_id = p_booking_id;
  if result.id is null then raise exception 'Direct-payment booking pricing was not found.'; end if;
  return result;
end;
$$;
alter function private.direct_booking_pricing(uuid) owner to postgres;
revoke all on function private.direct_booking_pricing(uuid) from public, anon, authenticated, service_role;

create or replace function public.begin_payment_attempt(p_booking_id uuid, p_payment_access_token text, p_provider text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare booking public.bookings%rowtype; attempt private.payment_attempts%rowtype;
  pricing private.booking_pricing%rowtype; slot public.availability_slots%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception using errcode='42501', message='Service-role access is required.'; end if;
  if p_booking_id is null or nullif(btrim(p_payment_access_token),'') is null or p_provider <> 'square' then raise exception 'Valid payment access is required.'; end if;
  select * into booking from public.bookings where id=p_booking_id for update;
  if not found or not exists (select 1 from private.booking_payment_access a where a.booking_id=p_booking_id and a.token_hash=extensions.digest(p_payment_access_token,'sha256')) then raise exception using errcode='42501', message='Payment access is invalid.'; end if;
  pricing := private.direct_booking_pricing(booking.id);
  if booking.status='confirmed' and booking.payment_status='paid' then return jsonb_build_object('action','paid','booking_status',booking.status,'payment_status',booking.payment_status,'service_name',booking.service_name_snapshot,'amount_minor',pricing.final_amount_minor,'currency',pricing.currency); end if;
  if booking.status not in ('pending_payment','payment_expired') or booking.payment_status<>'unpaid' or booking.service_payment_flow_snapshot<>'direct_payment' or booking.amount_due<>pricing.final_amount_minor::numeric/100 or booking.amount_paid<>0 then raise exception 'This booking is not eligible for direct payment.'; end if;
  select * into attempt from private.payment_attempts where booking_id=booking.id and status in ('reserved','processing','unknown') for update;
  if found then return jsonb_build_object('action',case attempt.status when 'reserved' then 'submit' else 'wait' end,'attempt_id',attempt.id,'attempt_status',attempt.status,'booking_id',booking.id,'service_name',booking.service_name_snapshot,'amount_minor',attempt.amount_minor,'currency',attempt.currency); end if;
  if booking.status='pending_payment' then raise exception 'The pending booking has no active payment attempt.'; end if;
  if booking.service_booking_mode_snapshot='timed' then
    select * into slot from public.availability_slots where id=booking.slot_id for update;
    if not found or not private.slot_is_future(slot.slot_date,slot.slot_time) or slot.is_available is not true or exists(select 1 from public.bookings where slot_id=booking.slot_id and id<>booking.id and status in ('pending','pending_payment','confirmed','completed','no_show')) then raise exception 'The original booking slot is no longer available.'; end if;
    update public.availability_slots set is_available=false where id=slot.id;
  end if;
  update public.bookings set status='pending_payment',updated_at=now() where id=booking.id;
  insert into private.payment_attempts(booking_id,provider,idempotency_key,amount_minor,currency,pricing_id) values(booking.id,'square','sq-'||replace(gen_random_uuid()::text,'-',''),pricing.final_amount_minor,pricing.currency,pricing.id) returning * into attempt;
  return jsonb_build_object('action','submit','attempt_id',attempt.id,'attempt_status',attempt.status,'booking_id',booking.id,'service_name',booking.service_name_snapshot,'amount_minor',attempt.amount_minor,'currency',attempt.currency);
end;
$$;

create or replace function public.mark_payment_attempt_processing(p_booking_id uuid,p_attempt_id uuid,p_provider_location_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare booking public.bookings%rowtype; attempt private.payment_attempts%rowtype; pricing private.booking_pricing%rowtype; slot public.availability_slots%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception using errcode='42501',message='Service-role access is required.'; end if;
  select * into booking from public.bookings where id=p_booking_id for update; select * into attempt from private.payment_attempts where id=p_attempt_id and booking_id=p_booking_id for update; pricing:=private.direct_booking_pricing(p_booking_id);
  if booking.id is null or attempt.id is null or attempt.provider<>'square' then raise exception 'Payment attempt was not found.'; end if;
  if booking.status<>'pending_payment' or booking.payment_status<>'unpaid' or booking.service_payment_flow_snapshot<>'direct_payment' or attempt.pricing_id<>pricing.id or attempt.amount_minor<>pricing.final_amount_minor or attempt.currency<>pricing.currency then raise exception 'The booking is no longer eligible for payment.'; end if;
  if attempt.status<>'reserved' then return jsonb_build_object('should_submit',false,'attempt_status',attempt.status); end if;
  if booking.service_booking_mode_snapshot='timed' then select * into slot from public.availability_slots where id=booking.slot_id for update; if not found or not private.slot_is_future(slot.slot_date,slot.slot_time) then raise exception 'The appointment start time has passed.'; end if; end if;
  update private.payment_attempts set status='processing',provider_location_id=nullif(btrim(p_provider_location_id),''),submitted_at=now(),updated_at=now() where id=attempt.id;
  return jsonb_build_object('should_submit',true,'idempotency_key',attempt.idempotency_key,'amount_minor',attempt.amount_minor,'currency',attempt.currency);
end;
$$;

create or replace function public.get_payment_status(p_booking_id uuid,p_payment_access_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare booking public.bookings%rowtype; attempt private.payment_attempts%rowtype; pricing private.booking_pricing%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception using errcode='42501',message='Service-role access is required.'; end if;
  select * into booking from public.bookings where id=p_booking_id;
  if not found or not exists(select 1 from private.booking_payment_access a where a.booking_id=p_booking_id and a.token_hash=extensions.digest(p_payment_access_token,'sha256')) then raise exception using errcode='42501',message='Payment access is invalid.'; end if;
  pricing:=private.direct_booking_pricing(booking.id); select * into attempt from private.payment_attempts where booking_id=booking.id order by created_at desc limit 1;
  return jsonb_build_object('booking_status',booking.status,'payment_status',booking.payment_status,'attempt_id',attempt.id,'attempt_status',attempt.status,'provider_status',attempt.provider_status,'service_name',booking.service_name_snapshot,'amount_minor',pricing.final_amount_minor,'currency',pricing.currency,'paid',booking.status='confirmed' and booking.payment_status='paid','can_restart',booking.status='payment_expired' and booking.payment_status='unpaid' and (attempt.id is null or attempt.status in ('failed','expired','cancelled')));
end;
$$;

-- Keep the existing webhook/API completion contract, but prove the provider
-- amount against frozen pricing rather than the original catalogue snapshot.
create or replace function public.record_provider_payment_result(
  p_provider text,p_event_id text,p_event_type text,p_booking_id uuid,p_attempt_id uuid,
  p_provider_payment_id text,p_provider_location_id text,p_provider_status text,
  p_amount_minor integer,p_currency text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare booking public.bookings%rowtype; attempt private.payment_attempts%rowtype;
  pricing private.booking_pricing%rowtype; slot public.availability_slots%rowtype;
  config public.booking_email_config%rowtype; inserted text;
  payment_id text := nullif(btrim(p_provider_payment_id),'');
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception using errcode='42501',message='Service-role access is required.'; end if;
  if p_provider<>'square' or p_booking_id is null or p_attempt_id is null or payment_id is null or nullif(btrim(p_provider_location_id),'') is null or p_provider_status not in ('COMPLETED','FAILED','CANCELED') then raise exception 'A complete provider result is required.'; end if;
  select * into booking from public.bookings where id=p_booking_id for update;
  select * into attempt from private.payment_attempts where id=p_attempt_id and booking_id=p_booking_id for update;
  pricing:=private.direct_booking_pricing(p_booking_id);
  if booking.id is null or attempt.id is null or attempt.provider<>p_provider then raise exception 'The payment is unrelated to this booking.'; end if;
  if attempt.pricing_id<>pricing.id or attempt.amount_minor<>p_amount_minor or attempt.currency<>upper(p_currency) or pricing.final_amount_minor<>p_amount_minor or pricing.currency<>upper(p_currency) or booking.service_payment_flow_snapshot<>'direct_payment' or attempt.provider_location_id<>p_provider_location_id then raise exception 'Provider payment details do not match the booking.'; end if;
  if attempt.provider_payment_id is not null and attempt.provider_payment_id<>payment_id then raise exception 'The payment attempt already belongs to another provider payment.'; end if;
  if nullif(btrim(p_event_id),'') is not null then insert into private.payment_webhook_events(provider,event_id,event_type,provider_payment_id) values(p_provider,btrim(p_event_id),btrim(p_event_type),payment_id) on conflict(provider,event_id) do nothing returning event_id into inserted; if inserted is null then return false; end if; end if;
  if p_provider_status<>'COMPLETED' and attempt.status='completed' then
    if inserted is not null then
      update private.payment_webhook_events set processed_at=now()
      where provider=p_provider and event_id=btrim(p_event_id);
    end if;
    return false;
  end if;
  update private.payment_attempts set provider_payment_id=payment_id,provider_status=p_provider_status,last_reconciled_at=now(),updated_at=now() where id=attempt.id;
  if p_provider_status<>'COMPLETED' then update private.payment_attempts set status='failed',failed_at=now() where id=attempt.id; perform private.expire_payment_booking_if_current(p_booking_id,p_attempt_id); if inserted is not null then update private.payment_webhook_events set processed_at=now() where provider=p_provider and event_id=btrim(p_event_id); end if; return true; end if;
  if booking.service_booking_mode_snapshot='timed' then select * into slot from public.availability_slots where id=booking.slot_id for update; if not found or slot.is_available is not false or exists(select 1 from public.bookings where slot_id=booking.slot_id and id<>booking.id and status in ('pending','pending_payment','confirmed','completed','no_show')) then raise exception 'The booking no longer safely owns its slot.'; end if;
  elsif booking.slot_id is not null then raise exception 'An untimed booking cannot own a slot.'; end if;
  if booking.status='confirmed' and booking.payment_status='paid' and attempt.status='completed' then return false; end if;
  if attempt.status not in ('processing','unknown') or booking.status<>'pending_payment' or booking.payment_status<>'unpaid' then raise exception 'The booking is not awaiting this direct payment.'; end if;
  select * into config from public.booking_email_config where id=true; if not found then raise exception 'Booking email configuration has not been created.'; end if;
  update public.bookings set status='confirmed',payment_status='paid',amount_paid=p_amount_minor::numeric/100,paid_at=coalesce(paid_at,now()),payment_method='square',payment_reference=payment_id,confirmed_at=coalesce(confirmed_at,now()),updated_at=now() where id=booking.id;
  update private.payment_attempts set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=attempt.id;
  perform public.queue_booking_email(booking.id,'booking_confirmed',booking.customer_email,booking.customer_name,jsonb_strip_nulls(jsonb_build_object('booking_id',booking.id,'customer_name',booking.customer_name,'customer_email',booking.customer_email,'service_name',booking.service_name_snapshot,'service_booking_mode',booking.service_booking_mode_snapshot,'service_currency',pricing.currency,'slot_date',slot.slot_date,'slot_time',slot.slot_time,'direct_payment',true,'payment_status','paid','amount_due',p_amount_minor::numeric/100,'amount_paid',p_amount_minor::numeric/100)));
  perform public.queue_booking_email(booking.id,'booking_request_admin',config.admin_email,config.admin_name,jsonb_strip_nulls(jsonb_build_object('booking_id',booking.id,'customer_name',booking.customer_name,'customer_email',booking.customer_email,'customer_phone',booking.customer_phone,'customer_message',booking.customer_message,'service_name',booking.service_name_snapshot,'service_booking_mode',booking.service_booking_mode_snapshot,'service_currency',pricing.currency,'slot_date',slot.slot_date,'slot_time',slot.slot_time,'direct_payment',true,'payment_status','paid','amount_due',p_amount_minor::numeric/100,'amount_paid',p_amount_minor::numeric/100,'payment_method','square','payment_reference',payment_id)));
  if inserted is not null then update private.payment_webhook_events set processed_at=now() where provider=p_provider and event_id=btrim(p_event_id); end if;
  return true;
end;
$$;

notify pgrst, 'reload schema';
