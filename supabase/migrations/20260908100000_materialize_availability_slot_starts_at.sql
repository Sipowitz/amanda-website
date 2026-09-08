-- Materialize the authoritative appointment instant once per slot.  The
-- business timezone remains configurable; the trigger below keeps this value
-- aligned with the configured IANA timezone whenever a wall-time slot or the
-- timezone setting changes.

alter table public.availability_slots
  add column starts_at timestamptz;

-- This overload validates/converts a wall-time value using a timezone already
-- resolved by the caller.  It avoids repeatedly reading email_settings or
-- pg_timezone_names while operating on a set of slots.
create function private.slot_start_instant(
  p_date date,
  p_time text,
  p_timezone text
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_date is null
    or p_time is null
    or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
    or p_timezone is null
  then
    return null;
  end if;

  -- Callers obtain p_timezone from get_business_timezone() or validate it
  -- once before processing a set.  Do not scan pg_timezone_names per slot.
  -- PostgreSQL deliberately resolves repeated/nonexistent DST wall times in
  -- the same way as the previously deployed business-time helper.
  return (p_date + p_time::time) at time zone p_timezone;
end;
$$;

alter function private.slot_start_instant(date, text, text) owner to postgres;
revoke all on function private.slot_start_instant(date, text, text)
  from public, anon, authenticated, service_role;

-- Keep candidate validation correct before a slot row exists.  Existing rows
-- use their materialized instant, while candidate date/time pairs still use
-- the authoritative wall-time conversion.
create or replace function private.slot_is_future(
  p_date date,
  p_time text,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_starts_at timestamptz;
begin
  select slot.starts_at
  into stored_starts_at
  from public.availability_slots as slot
  where slot.slot_date = p_date
    and slot.slot_time = p_time;

  if found then
    return coalesce(stored_starts_at >= p_now, false);
  end if;

  return coalesce(
    private.slot_start_instant(p_date, p_time, public.get_business_timezone()) >= p_now,
    false
  );
end;
$$;

alter function private.slot_is_future(date, text, timestamptz) owner to postgres;
revoke all on function private.slot_is_future(date, text, timestamptz)
  from public, anon, authenticated, service_role;

do $$
declare
  business_timezone text := public.get_business_timezone();
begin
  if exists (
    select 1
    from public.availability_slots as slot
    where private.slot_start_instant(slot.slot_date, slot.slot_time, business_timezone) is null
  ) then
    raise exception 'Availability slot date/time is invalid; starts_at backfill aborted.';
  end if;

  update public.availability_slots as slot
  set starts_at = private.slot_start_instant(
    slot.slot_date,
    slot.slot_time,
    business_timezone
  );

  if exists (
    select 1 from public.availability_slots where starts_at is null
  ) then
    raise exception 'Availability slot starts_at backfill failed.';
  end if;
end;
$$;

alter table public.availability_slots
  alter column starts_at set not null;

create function private.maintain_availability_slot_starts_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_timezone text := public.get_business_timezone();
begin
  -- Always overwrite a caller-supplied value.  Availability wall time is the
  -- source of truth; starts_at is an internal derived value.
  new.starts_at := private.slot_start_instant(
    new.slot_date,
    new.slot_time,
    business_timezone
  );

  if new.starts_at is null then
    raise exception 'Availability slot date/time is invalid.';
  end if;

  return new;
end;
$$;

alter function private.maintain_availability_slot_starts_at() owner to postgres;
revoke all on function private.maintain_availability_slot_starts_at()
  from public, anon, authenticated, service_role;

create trigger availability_slots_maintain_starts_at
before insert or update of slot_date, slot_time
on public.availability_slots
for each row
execute function private.maintain_availability_slot_starts_at();

-- A timezone update changes the instant represented by every stored wall
-- time.  This trigger runs inside the protected settings update transaction,
-- so an invalid timezone or failed recalculation rolls everything back.
create function private.recompute_availability_slot_starts_at_for_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_timezone text;
begin
  if new.id is distinct from true then
    return new;
  end if;

  business_timezone := nullif(btrim(new.timezone), '');
  if business_timezone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = business_timezone
        and (name like '%/%' or name = 'UTC')
        and name not like 'posix/%'
        and name not like 'right/%'
    )
  then
    raise exception 'Invalid business time zone.';
  end if;

  if exists (
    select 1
    from public.availability_slots as slot
    where private.slot_start_instant(slot.slot_date, slot.slot_time, business_timezone) is null
  ) then
    raise exception 'Availability slot date/time is invalid; timezone update aborted.';
  end if;

  update public.availability_slots as slot
  set starts_at = private.slot_start_instant(
    slot.slot_date,
    slot.slot_time,
    business_timezone
  );

  return new;
end;
$$;

alter function private.recompute_availability_slot_starts_at_for_timezone() owner to postgres;
revoke all on function private.recompute_availability_slot_starts_at_for_timezone()
  from public, anon, authenticated, service_role;

create trigger email_settings_recompute_availability_slot_starts_at
after update of timezone
on public.email_settings
for each row
when (old.timezone is distinct from new.timezone)
execute function private.recompute_availability_slot_starts_at_for_timezone();

create index availability_slots_available_starts_at_idx
  on public.availability_slots (starts_at)
  where is_available is true;

-- Preserve the deployed PostgREST function signature for old browser assets.
-- It is now a cheap compatibility wrapper around the physical column.
create or replace function public.slot_starts_at(public.availability_slots)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$ select $1.starts_at; $$;

alter function public.slot_starts_at(public.availability_slots) owner to postgres;
revoke all on function public.slot_starts_at(public.availability_slots) from public;
grant execute on function public.slot_starts_at(public.availability_slots)
  to anon, authenticated, service_role;

drop policy "Public can view future available slots" on public.availability_slots;
create policy "Public can view future available slots" on public.availability_slots
for select to anon, authenticated
using (is_available is true and starts_at >= clock_timestamp());

create or replace function private.delete_past_availability_slots()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.availability_slots as slot
  where slot.starts_at < clock_timestamp()
    and not exists (select 1 from public.bookings b where b.slot_id = slot.id);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter function private.delete_past_availability_slots() owner to postgres;
revoke all on function private.delete_past_availability_slots()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
