-- Discount pricing foundation. This migration records immutable pricing for
-- existing and future undiscounted direct-payment bookings without changing
-- any customer-facing checkout or Square behavior.

create table private.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  percentage_off integer not null,
  enabled boolean not null default true,
  scope text not null,
  revision integer not null default 1,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_codes_code_key unique (code),
  constraint discount_codes_canonical_code_check
    check (code = upper(btrim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  constraint discount_codes_percentage_check
    check (percentage_off between 1 and 99),
  constraint discount_codes_scope_check
    check (scope in ('all', 'selected')),
  constraint discount_codes_revision_check
    check (revision >= 1)
);
alter table private.discount_codes owner to postgres;
revoke all on table private.discount_codes from public, anon, authenticated, service_role;

create table private.discount_code_services (
  discount_code_id uuid not null references private.discount_codes(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  primary key (discount_code_id, service_id)
);
alter table private.discount_code_services owner to postgres;
revoke all on table private.discount_code_services from public, anon, authenticated, service_role;
create index discount_code_services_service_id_index
  on private.discount_code_services(service_id);

create function private.normalize_discount_code(p_code text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  normalized text := upper(btrim(coalesce(p_code, '')));
begin
  if normalized !~ '^[A-Z0-9][A-Z0-9_-]{0,31}$' then
    raise exception 'Discount codes must use 1-32 uppercase letters, numbers, hyphens, or underscores.';
  end if;
  return normalized;
end;
$$;
alter function private.normalize_discount_code(text) owner to postgres;
revoke all on function private.normalize_discount_code(text) from public, anon, authenticated, service_role;

-- A code string is its permanent promotion identity.  Definitions may change,
-- but a code may never be renamed and subsequently reused for another offer.
create function private.prevent_discount_code_rename()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'Discount code identity is immutable.';
  end if;
  return new;
end;
$$;
alter function private.prevent_discount_code_rename() owner to postgres;
revoke all on function private.prevent_discount_code_rename() from public, anon, authenticated, service_role;
create trigger discount_codes_prevent_rename
before update of code on private.discount_codes
for each row execute function private.prevent_discount_code_rename();

-- Cross-row scope rules are deferred so an admin RPC can insert a selected
-- code and its service mappings in one transaction.
create function private.validate_discount_code_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  target_scope text;
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'discount_codes' then
      target_id := old.id;
    else
      target_id := old.discount_code_id;
    end if;
  elsif tg_table_name = 'discount_codes' then
    target_id := new.id;
  else
    target_id := new.discount_code_id;
  end if;

  select code.scope into target_scope
  from private.discount_codes as code
  where code.id = target_id;

  if not found then return null; end if;

  if target_scope = 'selected' and not exists (
    select 1 from private.discount_code_services where discount_code_id = target_id
  ) then
    raise exception 'Selected-service discount codes require at least one service.';
  end if;

  if target_scope = 'all' and exists (
    select 1 from private.discount_code_services where discount_code_id = target_id
  ) then
    raise exception 'All-service discount codes cannot have selected-service mappings.';
  end if;

  return null;
end;
$$;
alter function private.validate_discount_code_scope() owner to postgres;
revoke all on function private.validate_discount_code_scope() from public, anon, authenticated, service_role;

create constraint trigger discount_codes_validate_scope
after insert or update or delete on private.discount_codes
deferrable initially deferred
for each row execute function private.validate_discount_code_scope();
create constraint trigger discount_code_services_validate_scope
after insert or update or delete on private.discount_code_services
deferrable initially deferred
for each row execute function private.validate_discount_code_scope();

create table private.booking_pricing (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  original_amount_minor integer not null,
  discount_amount_minor integer not null default 0,
  final_amount_minor integer not null,
  currency text not null,
  discount_code_id uuid references private.discount_codes(id) on delete restrict,
  discount_code_snapshot text,
  discount_percentage_snapshot integer,
  discount_code_revision integer,
  calculation_version integer not null default 1,
  created_at timestamptz not null default now(),
  constraint booking_pricing_original_amount_check check (original_amount_minor > 0),
  constraint booking_pricing_discount_amount_check check (discount_amount_minor >= 0),
  constraint booking_pricing_final_amount_check check (final_amount_minor > 0),
  constraint booking_pricing_amount_relationship_check
    check (final_amount_minor = original_amount_minor - discount_amount_minor),
  constraint booking_pricing_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint booking_pricing_calculation_version_check check (calculation_version >= 1),
  constraint booking_pricing_discount_metadata_check check (
    (discount_amount_minor = 0
      and discount_code_id is null
      and discount_code_snapshot is null
      and discount_percentage_snapshot is null
      and discount_code_revision is null)
    or
    (discount_amount_minor > 0
      and discount_code_id is not null
      and discount_code_snapshot is not null
      and discount_code_snapshot ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'
      and discount_percentage_snapshot is not null
      and discount_percentage_snapshot between 1 and 99
      and discount_code_revision is not null
      and discount_code_revision >= 1)
  )
);
alter table private.booking_pricing owner to postgres;
revoke all on table private.booking_pricing from public, anon, authenticated, service_role;
create index booking_pricing_discount_code_id_index
  on private.booking_pricing(discount_code_id) where discount_code_id is not null;

create function private.validate_booking_pricing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
begin
  select * into booking from public.bookings where id = new.booking_id;
  if not found
    or booking.service_id <> new.service_id
    or booking.service_price_amount_snapshot <> new.original_amount_minor
    or booking.service_currency_snapshot <> new.currency
    or booking.amount_due <> new.final_amount_minor::numeric / 100
  then
    raise exception 'Booking pricing does not match the booking snapshot.';
  end if;
  return new;
end;
$$;
alter function private.validate_booking_pricing() owner to postgres;
revoke all on function private.validate_booking_pricing() from public, anon, authenticated, service_role;
create trigger booking_pricing_validate_before_insert
before insert on private.booking_pricing
for each row execute function private.validate_booking_pricing();

create function private.prevent_booking_pricing_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historical booking pricing is immutable.';
end;
$$;
alter function private.prevent_booking_pricing_mutation() owner to postgres;
revoke all on function private.prevent_booking_pricing_mutation() from public, anon, authenticated, service_role;
create trigger booking_pricing_prevent_update_or_delete
before update or delete on private.booking_pricing
for each row execute function private.prevent_booking_pricing_mutation();

-- Backfill only records whose existing stored booking totals prove the
-- undiscounted snapshot. Any direct-payment exception fails rather than being
-- reinterpreted as a discount or silently omitted.
insert into private.booking_pricing (
  booking_id, service_id, original_amount_minor, discount_amount_minor,
  final_amount_minor, currency
)
select
  booking.id, booking.service_id, booking.service_price_amount_snapshot, 0,
  booking.service_price_amount_snapshot, booking.service_currency_snapshot
from public.bookings as booking
where booking.service_price_amount_snapshot > 0
  and booking.service_currency_snapshot ~ '^[A-Z]{3}$'
  and booking.amount_due = booking.service_price_amount_snapshot::numeric / 100;

do $$
begin
  if exists (
    select 1
    from public.bookings as booking
    left join private.booking_pricing as pricing on pricing.booking_id = booking.id
    where booking.service_payment_flow_snapshot = 'direct_payment'
      and pricing.booking_id is null
  ) then
    raise exception 'Cannot safely backfill pricing for every direct-payment booking.';
  end if;
end;
$$;

alter table private.payment_attempts add column pricing_id uuid
  references private.booking_pricing(id) on delete restrict;
create index payment_attempts_pricing_id_index
  on private.payment_attempts(pricing_id) where pricing_id is not null;

create function private.assign_and_validate_payment_attempt_pricing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  pricing private.booking_pricing%rowtype;
begin
  select * into booking from public.bookings where id = new.booking_id;
  if not found then raise exception 'Payment attempt booking was not found.'; end if;

  if new.pricing_id is null and booking.service_payment_flow_snapshot = 'direct_payment' then
    select id into new.pricing_id from private.booking_pricing
    where booking_id = new.booking_id;
  end if;

  if new.pricing_id is null then return new; end if;
  select * into pricing from private.booking_pricing where id = new.pricing_id;
  if pricing.id is null
    or pricing.booking_id <> new.booking_id
    or pricing.final_amount_minor <> new.amount_minor
    or pricing.currency <> new.currency
  then
    raise exception 'Payment attempt does not match immutable booking pricing.';
  end if;
  return new;
end;
$$;
alter function private.assign_and_validate_payment_attempt_pricing() owner to postgres;
revoke all on function private.assign_and_validate_payment_attempt_pricing() from public, anon, authenticated, service_role;
create trigger payment_attempts_assign_and_validate_pricing
before insert or update of booking_id, amount_minor, currency, pricing_id
on private.payment_attempts
for each row execute function private.assign_and_validate_payment_attempt_pricing();

update private.payment_attempts as attempt
set pricing_id = pricing.id
from private.booking_pricing as pricing
join public.bookings as booking on booking.id = pricing.booking_id
where attempt.booking_id = pricing.booking_id
  and booking.service_payment_flow_snapshot = 'direct_payment'
  and attempt.amount_minor = pricing.final_amount_minor
  and attempt.currency = pricing.currency;

do $$
begin
  if exists (
    select 1 from private.payment_attempts as attempt
    join public.bookings as booking on booking.id = attempt.booking_id
    where booking.service_payment_flow_snapshot = 'direct_payment'
      and attempt.pricing_id is null
  ) then
    raise exception 'Cannot safely link every direct-payment attempt to pricing.';
  end if;
end;
$$;

-- Stage 1 applies only to direct-payment bookings. Existing creation functions
-- remain unchanged; this trigger records their undiscounted snapshot after
-- booking insert. Stage 2 must replace this path atomically before discounted
-- booking creation is enabled.
create function private.create_undiscounted_booking_pricing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_payment_flow_snapshot = 'direct_payment' then
    insert into private.booking_pricing (
      booking_id, service_id, original_amount_minor, discount_amount_minor,
      final_amount_minor, currency
    ) values (
      new.id, new.service_id, new.service_price_amount_snapshot, 0,
      new.service_price_amount_snapshot, new.service_currency_snapshot
    );
  end if;
  return new;
end;
$$;
alter function private.create_undiscounted_booking_pricing() owner to postgres;
revoke all on function private.create_undiscounted_booking_pricing() from public, anon, authenticated, service_role;
create trigger bookings_create_undiscounted_pricing
after insert on public.bookings
for each row execute function private.create_undiscounted_booking_pricing();

create table private.discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references private.discount_codes(id) on delete restrict,
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  booking_pricing_id uuid not null unique references private.booking_pricing(id) on delete restrict,
  completed_payment_attempt_id uuid not null unique references private.payment_attempts(id) on delete restrict,
  completed_at timestamptz not null default now()
);
alter table private.discount_redemptions owner to postgres;
revoke all on table private.discount_redemptions from public, anon, authenticated, service_role;
comment on table private.discount_redemptions is
  'Reserved for successful discounted payments. Stage 2 completion must insert idempotently so API/webhook races acknowledge an existing redemption.';

create function private.validate_discount_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pricing private.booking_pricing%rowtype;
  attempt private.payment_attempts%rowtype;
begin
  select * into pricing from private.booking_pricing where id = new.booking_pricing_id;
  select * into attempt from private.payment_attempts where id = new.completed_payment_attempt_id;
  if pricing.id is null or attempt.id is null or pricing.booking_id <> new.booking_id
    or pricing.discount_code_id <> new.discount_code_id
    or attempt.booking_id <> new.booking_id
    or attempt.pricing_id <> pricing.id
    or attempt.status <> 'completed'
  then
    raise exception 'Discount redemption does not match completed immutable payment pricing.';
  end if;
  return new;
end;
$$;
alter function private.validate_discount_redemption() owner to postgres;
revoke all on function private.validate_discount_redemption() from public, anon, authenticated, service_role;
create trigger discount_redemptions_validate_before_insert
before insert on private.discount_redemptions
for each row execute function private.validate_discount_redemption();

create function private.calculate_percentage_discount(
  p_original_amount_minor integer,
  p_percentage_off integer
)
returns table (
  original_amount_minor integer,
  discount_amount_minor integer,
  final_amount_minor integer
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  calculated_discount integer;
begin
  if p_original_amount_minor is null or p_original_amount_minor <= 0 then
    raise exception 'Original amount must be positive.';
  end if;
  if p_percentage_off is null or p_percentage_off not between 1 and 99 then
    raise exception 'Discount percentage must be between 1 and 99.';
  end if;
  -- round(numeric) is nearest integer with halves away from zero; inputs are nonnegative.
  calculated_discount := round(
    (p_original_amount_minor::numeric * p_percentage_off::numeric) / 100
  )::integer;
  if p_original_amount_minor - calculated_discount <= 0 then
    raise exception 'Discounted total must be positive.';
  end if;
  return query select p_original_amount_minor, calculated_discount,
    p_original_amount_minor - calculated_discount;
end;
$$;
alter function private.calculate_percentage_discount(integer, integer) owner to postgres;
revoke all on function private.calculate_percentage_discount(integer, integer)
  from public, anon, authenticated, service_role;

create function private.calculate_discount_pricing(
  p_service_id uuid,
  p_code text
)
returns table (
  service_id uuid,
  original_amount_minor integer,
  discount_amount_minor integer,
  final_amount_minor integer,
  currency text,
  discount_code_id uuid,
  discount_code text,
  percentage_off integer,
  discount_code_revision integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_service public.services%rowtype;
  selected_code private.discount_codes%rowtype;
  calculated record;
  normalized_code text := private.normalize_discount_code(p_code);
begin
  select * into selected_service from public.services
  where id = p_service_id and is_active is true;
  if not found or selected_service.price_amount <= 0 then
    raise exception 'Discount service is unavailable.';
  end if;
  select * into selected_code from private.discount_codes
  where code = normalized_code and enabled is true
    and (expires_at is null or expires_at > clock_timestamp());
  if not found then raise exception 'Discount code is unavailable.'; end if;
  if selected_code.scope = 'selected' and not exists (
    select 1 from private.discount_code_services as mapping
    where mapping.discount_code_id = selected_code.id
      and mapping.service_id = selected_service.id
  ) then raise exception 'Discount code does not apply to this service.'; end if;
  select * into calculated from private.calculate_percentage_discount(
    selected_service.price_amount, selected_code.percentage_off
  );
  return query select selected_service.id, calculated.original_amount_minor,
    calculated.discount_amount_minor, calculated.final_amount_minor,
    selected_service.currency, selected_code.id, selected_code.code,
    selected_code.percentage_off, selected_code.revision;
end;
$$;
alter function private.calculate_discount_pricing(uuid, text) owner to postgres;
revoke all on function private.calculate_discount_pricing(uuid, text)
  from public, anon, authenticated, service_role;

create function private.validate_discount_code_services(
  p_scope text,
  p_selected_service_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_ids uuid[] := coalesce(p_selected_service_ids, '{}'::uuid[]);
  normalized_scope text := lower(btrim(coalesce(p_scope, '')));
begin
  if normalized_scope not in ('all', 'selected') then
    raise exception 'Discount scope must be all or selected.';
  end if;
  if normalized_scope = 'all' and cardinality(selected_ids) <> 0 then
    raise exception 'All-service discounts cannot select individual services.';
  end if;
  if normalized_scope = 'selected' and cardinality(selected_ids) = 0 then
    raise exception 'Selected-service discounts require at least one service.';
  end if;
  if cardinality(selected_ids) <> (
    select count(distinct selected.service_id)
    from unnest(selected_ids) as selected(service_id)
  ) then raise exception 'Selected services must be unique.'; end if;
  if exists (
    select 1 from unnest(selected_ids) as selected(service_id)
    left join public.services as service on service.id = selected.service_id
    where service.id is null
  ) then raise exception 'Selected service does not exist.'; end if;
  return selected_ids;
end;
$$;
alter function private.validate_discount_code_services(text, uuid[]) owner to postgres;
revoke all on function private.validate_discount_code_services(text, uuid[])
  from public, anon, authenticated, service_role;

create function public.get_admin_discount_codes()
returns table (
  id uuid,
  code text,
  percentage_off integer,
  scope text,
  enabled boolean,
  expires_at timestamptz,
  revision integer,
  selected_service_ids uuid[],
  uses bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select discount.id, discount.code, discount.percentage_off, discount.scope,
    discount.enabled, discount.expires_at, discount.revision,
    coalesce(array_agg(distinct mapping.service_id) filter (where mapping.service_id is not null), '{}'::uuid[]),
    count(distinct redemption.id)
  from private.discount_codes as discount
  left join private.discount_code_services as mapping on mapping.discount_code_id = discount.id
  left join private.discount_redemptions as redemption on redemption.discount_code_id = discount.id
  group by discount.id
  order by discount.created_at desc, discount.code;
end;
$$;

create function public.create_admin_discount_code(
  p_code text,
  p_percentage_off integer,
  p_scope text,
  p_selected_service_ids uuid[] default '{}'::uuid[],
  p_enabled boolean default true,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_code_id uuid;
  canonical_code text := private.normalize_discount_code(p_code);
  normalized_scope text := lower(btrim(coalesce(p_scope, '')));
  selected_ids uuid[];
begin
  perform private.require_admin();
  if p_percentage_off is null or p_percentage_off not between 1 and 99 then
    raise exception 'Discount percentage must be between 1 and 99.';
  end if;
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then
    raise exception 'Discount expiry must be in the future.';
  end if;
  selected_ids := private.validate_discount_code_services(normalized_scope, p_selected_service_ids);
  insert into private.discount_codes(code, percentage_off, enabled, scope, expires_at)
  values (canonical_code, p_percentage_off, coalesce(p_enabled, true), normalized_scope, p_expires_at)
  returning id into new_code_id;
  insert into private.discount_code_services(discount_code_id, service_id)
  select new_code_id, selected.service_id
  from unnest(selected_ids) as selected(service_id);
  return new_code_id;
end;
$$;

create function public.update_admin_discount_code(
  p_discount_code_id uuid,
  p_percentage_off integer,
  p_scope text,
  p_selected_service_ids uuid[] default '{}'::uuid[],
  p_enabled boolean default true,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_scope text := lower(btrim(coalesce(p_scope, '')));
  selected_ids uuid[];
begin
  perform private.require_admin();
  if p_discount_code_id is null then raise exception 'Discount code is required.'; end if;
  if p_percentage_off is null or p_percentage_off not between 1 and 99 then
    raise exception 'Discount percentage must be between 1 and 99.';
  end if;
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then
    raise exception 'Discount expiry must be in the future.';
  end if;
  selected_ids := private.validate_discount_code_services(normalized_scope, p_selected_service_ids);
  perform 1 from private.discount_codes where id = p_discount_code_id for update;
  if not found then raise exception 'Discount code does not exist.'; end if;
  update private.discount_codes set percentage_off = p_percentage_off, scope = normalized_scope,
    enabled = coalesce(p_enabled, true), expires_at = p_expires_at,
    revision = revision + 1, updated_at = now()
  where id = p_discount_code_id;
  delete from private.discount_code_services where discount_code_id = p_discount_code_id;
  insert into private.discount_code_services(discount_code_id, service_id)
  select p_discount_code_id, selected.service_id
  from unnest(selected_ids) as selected(service_id);
end;
$$;

create function public.set_admin_discount_code_enabled(
  p_discount_code_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update private.discount_codes set enabled = coalesce(p_enabled, false),
    revision = revision + 1, updated_at = now()
  where id = p_discount_code_id;
  if not found then raise exception 'Discount code does not exist.'; end if;
end;
$$;

alter function public.get_admin_discount_codes() owner to postgres;
alter function public.create_admin_discount_code(text, integer, text, uuid[], boolean, timestamptz) owner to postgres;
alter function public.update_admin_discount_code(uuid, integer, text, uuid[], boolean, timestamptz) owner to postgres;
alter function public.set_admin_discount_code_enabled(uuid, boolean) owner to postgres;
revoke all on function public.get_admin_discount_codes() from public, anon;
revoke all on function public.create_admin_discount_code(text, integer, text, uuid[], boolean, timestamptz) from public, anon;
revoke all on function public.update_admin_discount_code(uuid, integer, text, uuid[], boolean, timestamptz) from public, anon;
revoke all on function public.set_admin_discount_code_enabled(uuid, boolean) from public, anon;
grant execute on function public.get_admin_discount_codes() to authenticated, service_role;
grant execute on function public.create_admin_discount_code(text, integer, text, uuid[], boolean, timestamptz) to authenticated, service_role;
grant execute on function public.update_admin_discount_code(uuid, integer, text, uuid[], boolean, timestamptz) to authenticated, service_role;
grant execute on function public.set_admin_discount_code_enabled(uuid, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
