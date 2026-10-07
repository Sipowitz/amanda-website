-- Focused admin-managed catalogue for the two supported booking models.
-- Booking/payment snapshots remain immutable historical records and are not
-- changed by this migration.

alter table public.services
  add column public_summary text;

-- Preserve the existing public service copy while moving bookable cards to the
-- catalogue. The column remains nullable for compatibility with any legacy
-- catalogue rows; new admin services and activation require a valid summary.
update public.services
set public_summary = case slug
  when 'private-readings' then 'A full hour to dive into your quandary and get to the heart of the matter.'
  when 'wheel-of-the-year' then 'A 12-card predictive reading, perfect for birthdays, New Year or any new beginning. Typically lasts just under an hour.'
  when 'voice-memo-reading' then 'This is a one-topic reading. A voice memo reading allows you to have the insight and clarity you want, with the flexibility to receive the reading in your own time.'
  else public_summary
end
where slug in ('private-readings', 'wheel-of-the-year', 'voice-memo-reading');

drop function public.get_active_services();
create function public.get_active_services()
returns table (
  id uuid, slug text, name text, public_summary text, booking_mode text,
  duration_minutes integer, price_amount integer, currency text,
  payment_required boolean, payment_flow text, display_order integer
)
language sql stable security definer set search_path = ''
as $$
  select service.id, service.slug, service.name, service.public_summary,
    service.booking_mode, service.duration_minutes, service.price_amount,
    service.currency, service.payment_required, service.payment_flow,
    service.display_order
  from public.services as service
  where service.is_active is true
  order by service.display_order, service.name, service.id;
$$;
alter function public.get_active_services() owner to postgres;
revoke all on function public.get_active_services() from public;
grant execute on function public.get_active_services() to anon, authenticated, service_role;

-- Browser clients use the narrow RPCs below; no authenticated browser role
-- receives direct catalogue-table access.
revoke all on table public.services from authenticated;

create function private.admin_service_slug(p_name text)
returns text language sql immutable security definer set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'
    ),
    ''
  );
$$;
alter function private.admin_service_slug(text) owner to postgres;
revoke all on function private.admin_service_slug(text) from public, anon, authenticated, service_role;

create function private.validate_admin_service_values(
  p_name text, p_public_summary text, p_booking_mode text, p_price_amount integer
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if nullif(btrim(p_name), '') is null or length(btrim(p_name)) > 160 then
    raise exception 'Enter a service name of 160 characters or fewer.';
  end if;
  if nullif(btrim(p_public_summary), '') is null or length(btrim(p_public_summary)) > 1000 then
    raise exception 'Enter a public summary of 1,000 characters or fewer.';
  end if;
  if p_booking_mode not in ('timed', 'untimed') then
    raise exception 'Booking mode must be timed or untimed.';
  end if;
  if p_price_amount is null or p_price_amount <= 0 or p_price_amount > 100000000 then
    raise exception 'Enter a positive whole-cent price.';
  end if;
end;
$$;
alter function private.validate_admin_service_values(text,text,text,integer) owner to postgres;
revoke all on function private.validate_admin_service_values(text,text,text,integer) from public, anon, authenticated, service_role;

create function public.get_admin_services()
returns table (
  id uuid, slug text, name text, public_summary text, booking_mode text,
  duration_minutes integer, price_amount integer, currency text,
  payment_required boolean, payment_flow text, is_active boolean,
  display_order integer, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select service.id, service.slug, service.name, service.public_summary,
    service.booking_mode, service.duration_minutes, service.price_amount,
    service.currency, service.payment_required, service.payment_flow,
    service.is_active, service.display_order, service.created_at, service.updated_at
  from public.services as service
  order by service.display_order, service.name, service.id;
end;
$$;

create function public.create_admin_service(
  p_name text, p_public_summary text, p_booking_mode text, p_price_amount integer
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  new_slug text;
  new_id uuid;
  next_order integer;
begin
  perform private.require_admin();
  perform private.validate_admin_service_values(p_name, p_public_summary, p_booking_mode, p_price_amount);
  new_slug := private.admin_service_slug(p_name);
  if new_slug is null then
    raise exception 'The service name cannot produce a usable URL slug.';
  end if;
  lock table public.services in share row exclusive mode;
  if exists (select 1 from public.services where slug = new_slug) then
    raise exception 'A service with this URL slug already exists.';
  end if;
  select coalesce(max(display_order), 0) + 10 into next_order from public.services;
  insert into public.services (
    slug, name, public_summary, booking_mode, duration_minutes, price_amount,
    currency, payment_required, payment_flow, is_active, display_order, updated_at
  ) values (
    new_slug, btrim(p_name), btrim(p_public_summary), p_booking_mode,
    case when p_booking_mode = 'timed' then 60 else null end, p_price_amount,
    'USD', true, 'direct_payment', false, next_order, now()
  ) returning id into new_id;
  return new_id;
end;
$$;

create function public.update_admin_service(
  p_service_id uuid, p_name text, p_public_summary text, p_price_amount integer
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare service public.services%rowtype;
begin
  perform private.require_admin();
  select * into service from public.services where id = p_service_id for update;
  if not found then raise exception 'The service does not exist.'; end if;
  perform private.validate_admin_service_values(p_name, p_public_summary, service.booking_mode, p_price_amount);
  update public.services set name = btrim(p_name), public_summary = btrim(p_public_summary),
    price_amount = p_price_amount, updated_at = now() where id = service.id;
  return true;
end;
$$;

create function public.set_admin_service_active(p_service_id uuid, p_is_active boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare service public.services%rowtype;
begin
  perform private.require_admin();
  if p_service_id is null or p_is_active is null then raise exception 'Service and active state are required.'; end if;
  select * into service from public.services where id = p_service_id for update;
  if not found then raise exception 'The service does not exist.'; end if;
  if p_is_active then
    perform private.validate_admin_service_values(service.name, service.public_summary, service.booking_mode, service.price_amount);
    if service.currency <> 'USD' or service.payment_required is not true
      or service.payment_flow <> 'direct_payment'
      or (service.booking_mode = 'timed' and service.duration_minutes <> 60)
      or (service.booking_mode = 'untimed' and service.duration_minutes is not null)
    then raise exception 'This service does not meet the V1 booking and payment requirements.'; end if;
  end if;
  update public.services set is_active = p_is_active, updated_at = now() where id = service.id;
  return true;
end;
$$;

create function public.move_admin_service(p_service_id uuid, p_direction text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare service_ids uuid[]; current_index integer; target_index integer; index integer;
begin
  perform private.require_admin();
  if p_direction is null or p_direction not in ('up', 'down') then raise exception 'Direction must be up or down.'; end if;
  lock table public.services in share row exclusive mode;
  select array_agg(id order by display_order, name, id) into service_ids from public.services;
  current_index := array_position(service_ids, p_service_id);
  if current_index is null then raise exception 'The service does not exist.'; end if;
  target_index := current_index + case when p_direction = 'up' then -1 else 1 end;
  if target_index < 1 or target_index > cardinality(service_ids) then return false; end if;
  service_ids[current_index] := service_ids[target_index];
  service_ids[target_index] := p_service_id;
  for index in 1..cardinality(service_ids) loop
    update public.services set display_order = index * 10, updated_at = now()
      where id = service_ids[index];
  end loop;
  return true;
end;
$$;

alter function public.get_admin_services() owner to postgres;
alter function public.create_admin_service(text,text,text,integer) owner to postgres;
alter function public.update_admin_service(uuid,text,text,integer) owner to postgres;
alter function public.set_admin_service_active(uuid,boolean) owner to postgres;
alter function public.move_admin_service(uuid,text) owner to postgres;
revoke all on function public.get_admin_services() from public, anon;
revoke all on function public.create_admin_service(text,text,text,integer) from public, anon;
revoke all on function public.update_admin_service(uuid,text,text,integer) from public, anon;
revoke all on function public.set_admin_service_active(uuid,boolean) from public, anon;
revoke all on function public.move_admin_service(uuid,text) from public, anon;
grant execute on function public.get_admin_services() to authenticated, service_role;
grant execute on function public.create_admin_service(text,text,text,integer) to authenticated, service_role;
grant execute on function public.update_admin_service(uuid,text,text,integer) to authenticated, service_role;
grant execute on function public.set_admin_service_active(uuid,boolean) to authenticated, service_role;
grant execute on function public.move_admin_service(uuid,text) to authenticated, service_role;

notify pgrst, 'reload schema';
