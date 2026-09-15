-- Stage 4A: browser-safe discount quotation and reviewed discounted booking
-- creation.  The HMAC guard is only evidence of the quote the browser saw;
-- all commercial values are recalculated by the database at creation time.

create table private.discount_review_guard_secrets (
  id boolean primary key default true check (id),
  secret bytea not null check (octet_length(secret) >= 32),
  created_at timestamptz not null default now()
);
alter table private.discount_review_guard_secrets owner to postgres;
revoke all on table private.discount_review_guard_secrets from public, anon, authenticated, service_role;
insert into private.discount_review_guard_secrets(id, secret)
values (true, extensions.gen_random_bytes(32));

create function private.build_discount_review_guard(
  p_service_id uuid,
  p_discount_code_id uuid,
  p_canonical_code text,
  p_original_amount_minor integer,
  p_discount_percentage integer,
  p_discount_amount_minor integer,
  p_final_amount_minor integer,
  p_currency text,
  p_discount_revision integer
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  guard_secret bytea;
  payload text;
begin
  select secret into guard_secret from private.discount_review_guard_secrets where id = true;
  if guard_secret is null then raise exception 'Discount review guard is unavailable.'; end if;
  payload := format(
    'discount-review-v1|%s|%s|%s|%s|%s|%s|%s|%s|%s',
    p_service_id, p_discount_code_id, p_canonical_code,
    p_original_amount_minor, p_discount_percentage, p_discount_amount_minor,
    p_final_amount_minor, p_currency, p_discount_revision
  );
  return encode(extensions.hmac(convert_to(payload, 'utf8'), guard_secret, 'sha256'), 'hex');
end;
$$;
alter function private.build_discount_review_guard(uuid,uuid,text,integer,integer,integer,integer,text,integer) owner to postgres;
revoke all on function private.build_discount_review_guard(uuid,uuid,text,integer,integer,integer,integer,text,integer)
  from public, anon, authenticated, service_role;

-- PostgreSQL does not provide a documented constant-time bytea equality
-- primitive.  This fixed-length comparison visits all 32 HMAC bytes and
-- accumulates every XOR difference before deciding.  It is deliberately not
-- implemented with bytea/text equality, which may stop at the first mismatch.
create function private.discount_review_guard_digests_equal(
  p_supplied bytea,
  p_expected bytea
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  byte_index integer;
  difference integer := 0;
begin
  if p_supplied is null or p_expected is null
    or octet_length(p_supplied) <> 32 or octet_length(p_expected) <> 32
  then
    return false;
  end if;

  for byte_index in 0..31 loop
    difference := difference | (
      get_byte(p_supplied, byte_index) # get_byte(p_expected, byte_index)
    );
  end loop;
  return difference = 0;
end;
$$;
alter function private.discount_review_guard_digests_equal(bytea,bytea) owner to postgres;
revoke all on function private.discount_review_guard_digests_equal(bytea,bytea)
  from public, anon, authenticated, service_role;

create function public.quote_direct_payment_discount(
  p_service_id uuid,
  p_discount_code text
)
returns table (
  accepted boolean,
  error_code text,
  canonical_code text,
  original_amount_minor integer,
  discount_percentage integer,
  discount_amount_minor integer,
  final_amount_minor integer,
  currency text,
  review_guard text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  quoted record;
begin
  if p_service_id is null or nullif(btrim(p_discount_code), '') is null
    or not exists (
      select 1 from public.services as service
      where service.id = p_service_id
        and service.is_active is true
        and service.payment_required is true
        and service.payment_flow = 'direct_payment'
        and service.price_amount > 0
        and service.currency = 'USD'
    )
  then
    return query select false, 'DISCOUNT_UNAVAILABLE', null::text,
      null::integer, null::integer, null::integer, null::integer,
      null::text, null::text;
    return;
  end if;

  begin
    select * into quoted
    from private.calculate_discount_pricing(p_service_id, p_discount_code);
  exception when raise_exception then
    return query select false, 'DISCOUNT_UNAVAILABLE', null::text,
      null::integer, null::integer, null::integer, null::integer,
      null::text, null::text;
    return;
  end;

  return query select true, null::text, quoted.discount_code,
    quoted.original_amount_minor, quoted.percentage_off,
    quoted.discount_amount_minor, quoted.final_amount_minor, quoted.currency,
    private.build_discount_review_guard(
      quoted.service_id, quoted.discount_code_id, quoted.discount_code,
      quoted.original_amount_minor, quoted.percentage_off,
      quoted.discount_amount_minor, quoted.final_amount_minor, quoted.currency,
      quoted.discount_code_revision
    );
end;
$$;
alter function public.quote_direct_payment_discount(uuid,text) owner to postgres;
revoke all on function public.quote_direct_payment_discount(uuid,text) from public;
grant execute on function public.quote_direct_payment_discount(uuid,text) to anon, authenticated, service_role;

create function private.create_pending_payment_booking_with_review_guard(
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
alter function private.create_pending_payment_booking_with_review_guard(uuid,text,text,text,text,uuid,text,text) owner to postgres;
revoke all on function private.create_pending_payment_booking_with_review_guard(uuid,text,text,text,text,uuid,text,text)
  from public, anon, authenticated, service_role;

-- Preserve the deployed private Stage 2 signature for current public wrappers.
create or replace function private.create_pending_payment_booking_with_pricing(
  p_service_id uuid, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_message text, p_slot_id uuid,
  p_discount_code text
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.create_pending_payment_booking_with_review_guard($1,$2,$3,$4,$5,$6,$7,null);
$$;
alter function private.create_pending_payment_booking_with_pricing(uuid,text,text,text,text,uuid,text) owner to postgres;
revoke all on function private.create_pending_payment_booking_with_pricing(uuid,text,text,text,text,uuid,text)
  from public, anon, authenticated, service_role;

create function public.create_discounted_pending_payment_booking(
  p_service_id uuid, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_customer_message text, p_slot_id uuid,
  p_discount_code text, p_review_guard text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created jsonb;
begin
  if nullif(btrim(p_discount_code), '') is null
    or p_review_guard is null
    or p_review_guard !~ '^[0-9a-f]{64}$'
  then
    return jsonb_build_object('created', false, 'code', 'PRICE_REVIEW_REQUIRED');
  end if;
  begin
    created := private.create_pending_payment_booking_with_review_guard(
      p_service_id, p_customer_name, p_customer_email, p_customer_phone,
      p_customer_message, p_slot_id, p_discount_code, p_review_guard
    );
  exception when sqlstate 'ZX001' then
    return jsonb_build_object('created', false, 'code', 'PRICE_REVIEW_REQUIRED');
  end;
  return created || jsonb_build_object('created', true);
end;
$$;
alter function public.create_discounted_pending_payment_booking(uuid,text,text,text,text,uuid,text,text) owner to postgres;
revoke all on function public.create_discounted_pending_payment_booking(uuid,text,text,text,text,uuid,text,text) from public;
grant execute on function public.create_discounted_pending_payment_booking(uuid,text,text,text,text,uuid,text,text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
