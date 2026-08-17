-- Store optional Stripe Payment Links per service. These values are private
-- operational configuration and are never exposed by get_active_services().

create table public.service_payment_settings (
  service_id uuid primary key
    references public.services(id)
    on delete cascade,
  stripe_payment_link_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_payment_settings_stripe_link_check
    check (
      stripe_payment_link_url is null
      or (
        length(stripe_payment_link_url) <= 2048
        and stripe_payment_link_url ~ '^https://buy\.stripe\.com/'
      )
    )
);

alter table public.service_payment_settings owner to postgres;
alter table public.service_payment_settings enable row level security;

revoke all on table public.service_payment_settings
  from public, anon, authenticated;
grant all on table public.service_payment_settings
  to authenticated, service_role;

create policy "Admins can manage service payment settings"
on public.service_payment_settings
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.service_payment_settings (
  service_id,
  stripe_payment_link_url
)
select
  service.id,
  'https://buy.stripe.com/aFa28kd0g4St2oB1IbdIA00'
from public.services as service
where service.slug in (
  'private-readings',
  'wheel-of-the-year',
  'voice-memo-reading'
);

create function public.get_service_payment_settings()
returns table (
  service_id uuid,
  service_name text,
  price_amount integer,
  currency text,
  stripe_payment_link_url text,
  display_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  return query
  select
    service.id,
    service.name,
    service.price_amount,
    service.currency,
    payment_settings.stripe_payment_link_url,
    service.display_order
  from public.services as service
  left join public.service_payment_settings as payment_settings
    on payment_settings.service_id = service.id
  where service.is_active is true
  order by service.display_order, service.name;
end;
$$;

alter function public.get_service_payment_settings() owner to postgres;
revoke all on function public.get_service_payment_settings()
  from public, anon, authenticated, service_role;
grant execute on function public.get_service_payment_settings()
  to authenticated, service_role;

create function public.update_service_payment_setting(
  p_service_id uuid,
  p_stripe_payment_link_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_service public.services%rowtype;
  cleaned_payment_link_url text;
begin
  perform private.require_admin();

  if p_service_id is null then
    raise exception 'A service is required.';
  end if;

  select *
  into selected_service
  from public.services
  where id = p_service_id;

  if not found then
    raise exception 'The selected service does not exist.';
  end if;

  cleaned_payment_link_url := nullif(
    btrim(p_stripe_payment_link_url),
    ''
  );

  if cleaned_payment_link_url is not null
    and (
      length(cleaned_payment_link_url) > 2048
      or cleaned_payment_link_url !~ '^https://buy\.stripe\.com/'
    )
  then
    raise exception 'Enter a valid HTTPS Stripe Payment Link URL.';
  end if;

  insert into public.service_payment_settings (
    service_id,
    stripe_payment_link_url,
    updated_at
  )
  values (
    selected_service.id,
    cleaned_payment_link_url,
    now()
  )
  on conflict (service_id) do update
  set
    stripe_payment_link_url = excluded.stripe_payment_link_url,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'service_id', selected_service.id,
    'service_name', selected_service.name,
    'price_amount', selected_service.price_amount,
    'currency', selected_service.currency,
    'stripe_payment_link_url', cleaned_payment_link_url,
    'display_order', selected_service.display_order
  );
end;
$$;

alter function public.update_service_payment_setting(uuid, text)
  owner to postgres;
revoke all on function public.update_service_payment_setting(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_service_payment_setting(uuid, text)
  to authenticated, service_role;

-- Snapshot trusted payment state and the configured service link into the
-- booking-confirmed queue payload. The browser never supplies these values.
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
  configured_payment_link_url text;
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

  select payment_settings.stripe_payment_link_url
  into configured_payment_link_url
  from public.service_payment_settings as payment_settings
  where payment_settings.service_id = selected_booking.service_id;

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
        'booking_id', updated_booking.id,
        'customer_name', updated_booking.customer_name,
        'customer_email', updated_booking.customer_email,
        'payment_status', updated_booking.payment_status,
        'amount_due', updated_booking.amount_due,
        'amount_paid', updated_booking.amount_paid,
        'stripe_payment_link_url', configured_payment_link_url,
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

comment on table public.service_payment_settings is
  'Private per-service payment configuration for server-generated booking emails.';
