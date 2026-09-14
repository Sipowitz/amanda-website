-- Stage 3: preserve frozen commercial terms while requiring that a discount
-- remains currently redeemable at the exact pre-provider submission boundary.
-- A changed percentage never reprices an existing booking; it is a current
-- policy change only.  Enabled/expiry/service/scope determine redemption.

create function private.discount_pricing_is_currently_redeemable(
  p_pricing_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pricing private.booking_pricing%rowtype;
  code private.discount_codes%rowtype;
begin
  select * into pricing
  from private.booking_pricing
  where id = p_pricing_id;
  if not found then
    raise exception 'Direct-payment booking pricing was not found.';
  end if;

  if pricing.discount_code_id is null then return true; end if;

  -- FOR SHARE serializes this decision with the supported admin mutation RPCs,
  -- which first lock and then update the definition/mappings atomically.
  select * into code
  from private.discount_codes
  where id = pricing.discount_code_id
  for share;
  if not found
    or code.enabled is not true
    or code.percentage_off not between 1 and 99
    or (code.expires_at is not null and code.expires_at <= clock_timestamp())
    or not exists (
      select 1 from public.services as service
      where service.id = pricing.service_id
        and service.is_active is true
        and service.payment_required is true
        and service.payment_flow = 'direct_payment'
        and service.price_amount > 0
        and service.currency = 'USD'
    )
  then return false; end if;

  if code.scope = 'all' then return true; end if;
  if code.scope <> 'selected' then return false; end if;
  return exists (
    select 1 from private.discount_code_services as mapping
    where mapping.discount_code_id = code.id
      and mapping.service_id = pricing.service_id
  );
end;
$$;
alter function private.discount_pricing_is_currently_redeemable(uuid) owner to postgres;
revoke all on function private.discount_pricing_is_currently_redeemable(uuid)
  from public, anon, authenticated, service_role;

create function private.record_discount_redemption(
  p_booking_id uuid,
  p_booking_pricing_id uuid,
  p_completed_payment_attempt_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pricing private.booking_pricing%rowtype;
begin
  select * into pricing from private.booking_pricing where id = p_booking_pricing_id;
  if not found then raise exception 'Direct-payment booking pricing was not found.'; end if;
  if pricing.discount_code_id is null then return; end if;

  -- The booking, pricing and completed-attempt unique keys make API/webhook
  -- races and repeated provider notifications one immutable redemption.
  insert into private.discount_redemptions(
    discount_code_id, booking_id, booking_pricing_id, completed_payment_attempt_id
  ) values (
    pricing.discount_code_id, p_booking_id, pricing.id, p_completed_payment_attempt_id
  ) on conflict (booking_id) do nothing;
end;
$$;
alter function private.record_discount_redemption(uuid, uuid, uuid) owner to postgres;
revoke all on function private.record_discount_redemption(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.mark_payment_attempt_processing(
  p_booking_id uuid,p_attempt_id uuid,p_provider_location_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare booking public.bookings%rowtype; attempt private.payment_attempts%rowtype;
  pricing private.booking_pricing%rowtype; slot public.availability_slots%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception using errcode='42501',message='Service-role access is required.'; end if;
  select * into booking from public.bookings where id=p_booking_id for update;
  select * into attempt from private.payment_attempts where id=p_attempt_id and booking_id=p_booking_id for update;
  pricing:=private.direct_booking_pricing(p_booking_id);
  if booking.id is null or attempt.id is null or attempt.provider<>'square' then raise exception 'Payment attempt was not found.'; end if;
  if booking.status<>'pending_payment' or booking.payment_status<>'unpaid' or booking.service_payment_flow_snapshot<>'direct_payment' or attempt.pricing_id<>pricing.id or attempt.amount_minor<>pricing.final_amount_minor or attempt.currency<>pricing.currency then raise exception 'The booking is no longer eligible for payment.'; end if;

  -- Only a reserved attempt is still pre-submission. Processing/unknown may
  -- already have reached Square and therefore must keep frozen terms.
  if attempt.status<>'reserved' then return jsonb_build_object('should_submit',false,'attempt_status',attempt.status); end if;
  if pricing.discount_code_id is not null
    and not private.discount_pricing_is_currently_redeemable(pricing.id)
  then
    update private.payment_attempts set status='expired',
      failure_code='DISCOUNT_NO_LONGER_VALID',
      failure_detail='Discount policy changed before payment submission.',
      expired_at=now(), updated_at=now()
    where id=attempt.id;
    perform private.expire_payment_booking_if_current(p_booking_id,attempt.id);
    return jsonb_build_object(
      'should_submit',false,
      'attempt_status','expired',
      'failure_code','DISCOUNT_NO_LONGER_VALID',
      'price_review',true
    );
  end if;
  if booking.service_booking_mode_snapshot='timed' then
    select * into slot from public.availability_slots where id=booking.slot_id for update;
    if not found or not private.slot_is_future(slot.slot_date,slot.slot_time) then raise exception 'The appointment start time has passed.'; end if;
  end if;
  update private.payment_attempts set status='processing',provider_location_id=nullif(btrim(p_provider_location_id),''),submitted_at=now(),updated_at=now() where id=attempt.id;
  return jsonb_build_object('should_submit',true,'idempotency_key',attempt.idempotency_key,'amount_minor',attempt.amount_minor,'currency',attempt.currency);
end;
$$;

-- Keep the Stage 2 provider amount checks.  Redemption is inserted only after
-- the authoritative booking and attempt have transitioned to completed.
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
    if inserted is not null then update private.payment_webhook_events set processed_at=now() where provider=p_provider and event_id=btrim(p_event_id); end if;
    return false;
  end if;
  update private.payment_attempts set provider_payment_id=payment_id,provider_status=p_provider_status,last_reconciled_at=now(),updated_at=now() where id=attempt.id;
  if p_provider_status<>'COMPLETED' then
    update private.payment_attempts set status='failed',failed_at=now() where id=attempt.id;
    perform private.expire_payment_booking_if_current(p_booking_id,p_attempt_id);
    if inserted is not null then update private.payment_webhook_events set processed_at=now() where provider=p_provider and event_id=btrim(p_event_id); end if;
    return true;
  end if;
  if booking.service_booking_mode_snapshot='timed' then
    select * into slot from public.availability_slots where id=booking.slot_id for update;
    if not found or slot.is_available is not false or exists(select 1 from public.bookings where slot_id=booking.slot_id and id<>booking.id and status in ('pending','pending_payment','confirmed','completed','no_show')) then raise exception 'The booking no longer safely owns its slot.'; end if;
  elsif booking.slot_id is not null then raise exception 'An untimed booking cannot own a slot.'; end if;
  if booking.status='confirmed' and booking.payment_status='paid' and attempt.status='completed' then
    perform private.record_discount_redemption(booking.id,pricing.id,attempt.id);
    if inserted is not null then
      update private.payment_webhook_events set processed_at=now()
      where provider=p_provider and event_id=btrim(p_event_id);
    end if;
    return false;
  end if;
  if attempt.status not in ('processing','unknown') or booking.status<>'pending_payment' or booking.payment_status<>'unpaid' then raise exception 'The booking is not awaiting this direct payment.'; end if;
  select * into config from public.booking_email_config where id=true; if not found then raise exception 'Booking email configuration has not been created.'; end if;
  update public.bookings set status='confirmed',payment_status='paid',amount_paid=p_amount_minor::numeric/100,paid_at=coalesce(paid_at,now()),payment_method='square',payment_reference=payment_id,confirmed_at=coalesce(confirmed_at,now()),updated_at=now() where id=booking.id;
  update private.payment_attempts set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=attempt.id;
  perform private.record_discount_redemption(booking.id,pricing.id,attempt.id);
  perform public.queue_booking_email(booking.id,'booking_confirmed',booking.customer_email,booking.customer_name,jsonb_strip_nulls(jsonb_build_object('booking_id',booking.id,'customer_name',booking.customer_name,'customer_email',booking.customer_email,'service_name',booking.service_name_snapshot,'service_booking_mode',booking.service_booking_mode_snapshot,'service_currency',pricing.currency,'slot_date',slot.slot_date,'slot_time',slot.slot_time,'direct_payment',true,'payment_status','paid','amount_due',p_amount_minor::numeric/100,'amount_paid',p_amount_minor::numeric/100)));
  perform public.queue_booking_email(booking.id,'booking_request_admin',config.admin_email,config.admin_name,jsonb_strip_nulls(jsonb_build_object('booking_id',booking.id,'customer_name',booking.customer_name,'customer_email',booking.customer_email,'customer_phone',booking.customer_phone,'customer_message',booking.customer_message,'service_name',booking.service_name_snapshot,'service_booking_mode',booking.service_booking_mode_snapshot,'service_currency',pricing.currency,'slot_date',slot.slot_date,'slot_time',slot.slot_time,'direct_payment',true,'payment_status','paid','amount_due',p_amount_minor::numeric/100,'amount_paid',p_amount_minor::numeric/100,'payment_method','square','payment_reference',payment_id)));
  if inserted is not null then update private.payment_webhook_events set processed_at=now() where provider=p_provider and event_id=btrim(p_event_id); end if;
  return true;
end;
$$;

alter function public.mark_payment_attempt_processing(uuid,uuid,text) owner to postgres;
revoke all on function public.mark_payment_attempt_processing(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.mark_payment_attempt_processing(uuid,uuid,text) to service_role;
alter function public.record_provider_payment_result(text,text,text,uuid,uuid,text,text,text,integer,text) owner to postgres;
revoke all on function public.record_provider_payment_result(text,text,text,uuid,uuid,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.record_provider_payment_result(text,text,text,uuid,uuid,text,text,text,integer,text) to service_role;

notify pgrst, 'reload schema';
