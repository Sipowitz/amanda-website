-- Persistent batch creation still executes row triggers, unlike the projected
-- preview.  Reconciliation already validates the business timezone once and
-- adoption already joins only desired starts; carry those verified facts into
-- the row triggers instead of repeating a database lookup/full schedule scan
-- for every slot written.

create or replace function private.maintain_availability_slot_starts_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_timezone text;
begin
  -- Reconciliation supplies starts_at directly from the authoritative desired
  -- cadence after its timezone/DST validation.  Retaining that value avoids
  -- repeating the same conversion for every inserted appointment row.
  if current_setting('app.inserting_desired_period_slots', true) = 'on'
    and new.starts_at is not null
  then
    return new;
  end if;
  business_timezone := nullif(current_setting('app.availability_slot_timezone', true), '');
  if business_timezone is null then
    business_timezone := public.get_business_timezone();
  end if;

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

create or replace function private.guard_period_slot_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- private.adopt_retired_legacy_slots_for_periods_impl() reaches this point
  -- only after joining the row to the authoritative desired set.  Do not
  -- regenerate that complete set once per adopted row.
  if current_setting('app.adopting_desired_period_slots', true) = 'on' then
    return new;
  end if;
  if new.availability_source = 'period' and new.is_available is true
    and not private.slot_is_desired_by_period(new.slot_date, new.slot_time, new.starts_at)
  then
    new.is_available := false;
  end if;
  return new;
end;
$$;

alter function private.guard_period_slot_reopen() owner to postgres;
revoke all on function private.guard_period_slot_reopen()
  from public, anon, authenticated, service_role;

create or replace function private.adopt_retired_legacy_slots_for_periods_impl()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.adopting_desired_period_slots', 'on', true);
  with desired as materialized (
    select distinct slot_date, slot_time, starts_at
    from private.desired_availability_period_slots()
    where skipped_dst is false
  ), adopted as (
    update public.availability_slots slot
    set availability_source = 'period', legacy_retired_at = null,
        legacy_cutover_id = null, is_available = true
    from desired
    where slot.availability_source = 'legacy'
      and slot.legacy_retired_at is not null
      and slot.slot_date = desired.slot_date
      and slot.slot_time = desired.slot_time
      and slot.starts_at = desired.starts_at
      and not exists (
        select 1 from public.bookings booking where booking.slot_id = slot.id
      )
    returning slot.id
  )
  update private.legacy_availability_cutover_slots audit
  set restored_at = coalesce(audit.restored_at, clock_timestamp())
  from adopted
  where audit.slot_id = adopted.id;
end;
$$;

alter function private.adopt_retired_legacy_slots_for_periods_impl() owner to postgres;
revoke all on function private.adopt_retired_legacy_slots_for_periods_impl()
  from public, anon, authenticated, service_role;

create or replace function private.reconcile_availability_slots_from_periods()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  desired_count integer;
  inserted_count integer;
  obsolete_deleted_count integer;
  protected_count integer;
  skipped_dst_count integer;
  business_timezone text;
begin
  business_timezone := private.availability_period_business_timezone();
  perform set_config('app.availability_slot_timezone', business_timezone, true);
  perform set_config('app.inserting_desired_period_slots', 'on', true);
  lock table public.availability_slots in share row exclusive mode;

  drop table if exists pg_temp.availability_period_reconcile_desired_slots;
  create temporary table availability_period_reconcile_desired_slots
    on commit drop
  as
    select distinct slot_date, slot_time, starts_at, skipped_dst
    from private.desired_availability_period_slots();
  create unique index on availability_period_reconcile_desired_slots(slot_date, slot_time, starts_at)
    where skipped_dst is false;

  select count(*) into desired_count
  from pg_temp.availability_period_reconcile_desired_slots
  where skipped_dst is false;
  select count(*) into skipped_dst_count
  from pg_temp.availability_period_reconcile_desired_slots
  where skipped_dst is true;

  with inserted as (
    insert into public.availability_slots(slot_date, slot_time, starts_at, is_available, availability_source)
    select slot_date, slot_time, starts_at, true, 'period'
    from pg_temp.availability_period_reconcile_desired_slots
    where skipped_dst is false
    on conflict (slot_date, slot_time) do nothing
    returning id
  )
  select count(*) into inserted_count from inserted;

  select count(*) into protected_count
  from public.availability_slots slot
  where slot.availability_source = 'period'
    and not exists (
      select 1 from pg_temp.availability_period_reconcile_desired_slots desired
      where desired.skipped_dst is false
        and desired.slot_date = slot.slot_date
        and desired.slot_time = slot.slot_time
        and desired.starts_at = slot.starts_at
    )
    and exists (select 1 from public.bookings booking where booking.slot_id = slot.id);

  update public.availability_slots slot
  set is_available = false
  where slot.availability_source = 'period'
    and slot.is_available is true
    and not exists (
      select 1 from pg_temp.availability_period_reconcile_desired_slots desired
      where desired.skipped_dst is false
        and desired.slot_date = slot.slot_date
        and desired.slot_time = slot.slot_time
        and desired.starts_at = slot.starts_at
    )
    and exists (select 1 from public.bookings booking where booking.slot_id = slot.id);

  with removed as (
    delete from public.availability_slots slot
    where slot.availability_source = 'period'
      and not exists (
        select 1 from pg_temp.availability_period_reconcile_desired_slots desired
        where desired.skipped_dst is false
          and desired.slot_date = slot.slot_date
          and desired.slot_time = slot.slot_time
          and desired.starts_at = slot.starts_at
      )
      and not exists (select 1 from public.bookings booking where booking.slot_id = slot.id)
    returning id
  )
  select count(*) into obsolete_deleted_count from removed;

  return jsonb_build_object(
    'desired_slots', desired_count,
    'slots_created', inserted_count,
    'slots_existing', desired_count - inserted_count,
    'obsolete_slots_deleted', obsolete_deleted_count,
    'protected_slots_preserved', protected_count,
    'dst_occurrences_skipped', skipped_dst_count
  );
end;
$$;

alter function private.reconcile_availability_slots_from_periods() owner to postgres;
revoke all on function private.reconcile_availability_slots_from_periods()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
