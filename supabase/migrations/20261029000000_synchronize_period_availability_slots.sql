-- Phase 3: materialize canonical availability-period cadence into the legacy
-- availability_slots inventory. Legacy slots and every booked slot are kept.

alter table public.availability_slots
  add column availability_source text not null default 'legacy',
  add constraint availability_slots_source_check
    check (availability_source in ('legacy', 'period'));

create index availability_slots_period_source_idx
  on public.availability_slots(slot_date, slot_time)
  where availability_source = 'period';

-- Produce desired starts in business-local wall time. Period endpoints were
-- validated in Phase 2; a cadence occurrence inside a DST gap/fold is skipped
-- and counted rather than being silently normalised or duplicated.
create function private.desired_availability_period_slots()
returns table (
  slot_date date,
  slot_time text,
  starts_at timestamptz,
  skipped_dst boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  period public.availability_periods%rowtype;
  configured_timezone text;
  local_start timestamp without time zone;
  local_end timestamp without time zone;
  anchor timestamp without time zone;
  candidate timestamp without time zone;
  resolved timestamptz;
  hour_offset bigint;
begin
  configured_timezone := private.availability_period_business_timezone();
  for period in select * from public.availability_periods order by starts_at, id
  loop
    -- Slot starts_at is derived by the established slot trigger from the
    -- current business setting.  Never regenerate an existing period under a
    -- different setting and silently shift its UTC inventory.
    if configured_timezone is distinct from period.timezone then
      raise exception 'Availability period timezone does not match the configured business timezone.';
    end if;
    local_start := period.starts_at at time zone period.timezone;
    local_end := period.ends_at at time zone period.timezone;
    anchor := period.anchor_local_date + period.anchor_local_time;
    hour_offset := floor(extract(epoch from (local_start - anchor)) / 3600)::bigint;
    candidate := anchor + hour_offset * interval '1 hour';
    while candidate < local_start loop candidate := candidate + interval '1 hour'; end loop;

    while candidate < local_end loop
      begin
        -- Avoid repeatedly querying pg_timezone_names through the Phase 2
        -- input validator for every candidate and every reconciliation scan.
        -- This is the identical gap/fold policy, using the period's stored
        -- timezone after the configuration check above.
        resolved := candidate at time zone period.timezone;
        if resolved at time zone period.timezone <> candidate
          or (resolved - interval '1 hour') at time zone period.timezone = candidate
          or (resolved + interval '1 hour') at time zone period.timezone = candidate
        then
          raise exception 'Invalid availability cadence occurrence';
        end if;
      exception when raise_exception then
        slot_date := candidate::date;
        slot_time := to_char(candidate, 'HH24:MI');
        starts_at := null;
        skipped_dst := true;
        return next;
        candidate := candidate + interval '1 hour';
        continue;
      end;
      if resolved >= period.starts_at
        and resolved + interval '60 minutes' <= period.ends_at
        and resolved >= clock_timestamp()
      then
        slot_date := candidate::date;
        slot_time := to_char(candidate, 'HH24:MI');
        starts_at := resolved;
        skipped_dst := false;
        return next;
      end if;
      candidate := candidate + interval '1 hour';
    end loop;
  end loop;
end;
$$;

alter function private.desired_availability_period_slots() owner to postgres;
revoke all on function private.desired_availability_period_slots()
  from public, anon, authenticated, service_role;

create function private.slot_is_desired_by_period(
  p_slot_date date,
  p_slot_time text,
  p_starts_at timestamptz
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.desired_availability_period_slots() as desired
    where desired.skipped_dst is false
      and desired.slot_date = p_slot_date
      and desired.slot_time = p_slot_time
      and desired.starts_at = p_starts_at
  );
$$;

alter function private.slot_is_desired_by_period(date, text, timestamptz) owner to postgres;
revoke all on function private.slot_is_desired_by_period(date, text, timestamptz)
  from public, anon, authenticated, service_role;

-- Existing cancellation/expiry functions set is_available=true directly. Keep
-- those lifecycle contracts, but prevent a released period slot from being
-- reopened after the governing period has been edited or deleted.
create function private.guard_period_slot_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger availability_slots_guard_period_reopen
before update of is_available
on public.availability_slots
for each row execute function private.guard_period_slot_reopen();

create function private.reconcile_availability_slots_from_periods()
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
begin
  -- Coordinate with concurrent booking operations without locking booking
  -- rows. A booking that wins a slot lock is preserved by the FK/history test.
  lock table public.availability_slots in share row exclusive mode;

  select count(*) into desired_count from (
    select distinct slot_date, slot_time, starts_at
    from private.desired_availability_period_slots() where skipped_dst is false
  ) desired;
  select count(*) into skipped_dst_count
  from private.desired_availability_period_slots() where skipped_dst is true;

  with desired as (
    select distinct slot_date, slot_time, starts_at
    from private.desired_availability_period_slots() where skipped_dst is false
  ), inserted as (
    insert into public.availability_slots(slot_date, slot_time, is_available, availability_source)
    select slot_date, slot_time, true, 'period' from desired
    on conflict (slot_date, slot_time) do nothing
    returning id
  ) select count(*) into inserted_count from inserted;

  select count(*) into protected_count
  from public.availability_slots as slot
  where slot.availability_source = 'period'
    and not private.slot_is_desired_by_period(slot.slot_date, slot.slot_time, slot.starts_at)
    and exists (select 1 from public.bookings as booking where booking.slot_id = slot.id);

  -- A referenced stale slot is historical/reservation inventory, never newly
  -- available inventory.  Preserve its immutable ID and every booking link,
  -- while taking it out of the ordinary slot listing immediately.  The trigger
  -- above also keeps later cancellation/expiry code from reopening it.
  update public.availability_slots as slot
  set is_available = false
  where slot.availability_source = 'period'
    and slot.is_available is true
    and not private.slot_is_desired_by_period(slot.slot_date, slot.slot_time, slot.starts_at)
    and exists (select 1 from public.bookings as booking where booking.slot_id = slot.id);

  with removed as (
    delete from public.availability_slots as slot
    where slot.availability_source = 'period'
      and not private.slot_is_desired_by_period(slot.slot_date, slot.slot_time, slot.starts_at)
      and not exists (select 1 from public.bookings as booking where booking.slot_id = slot.id)
    returning id
  ) select count(*) into obsolete_deleted_count from removed;

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

create function public.reconcile_availability_slots_from_periods()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.reconcile_availability_slots_from_periods();
end;
$$;

alter function public.reconcile_availability_slots_from_periods() owner to postgres;
revoke all on function public.reconcile_availability_slots_from_periods() from public, anon, authenticated;
grant execute on function public.reconcile_availability_slots_from_periods() to authenticated, service_role;

-- A stale different-start slot must not reach customer selection simply
-- because it is marked available. Phase 1 remains the final booking guard.
create function public.slot_is_customer_bookable(slot public.availability_slots)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select case
    when slot.availability_source = 'period'
      and not private.slot_is_desired_by_period(slot.slot_date, slot.slot_time, slot.starts_at)
    then false
    else not exists (
      select 1 from public.bookings as booking
      where booking.status in ('pending', 'pending_payment', 'confirmed', 'completed', 'no_show')
        and booking.service_booking_mode_snapshot = 'timed'
        and booking.appointment_starts_at is not null
        and tstzrange(booking.appointment_starts_at, booking.appointment_ends_at, '[)')
          && tstzrange(slot.starts_at, slot.starts_at + interval '60 minutes', '[)')
    )
  end;
$$;

alter function public.slot_is_customer_bookable(public.availability_slots) owner to postgres;
revoke all on function public.slot_is_customer_bookable(public.availability_slots) from public;
grant execute on function public.slot_is_customer_bookable(public.availability_slots) to anon, authenticated, service_role;

drop policy "Public can view future available slots" on public.availability_slots;
create policy "Public can view future available slots" on public.availability_slots
for select to anon, authenticated
using (
  is_available is true
  and starts_at >= clock_timestamp() + interval '24 hours'
  and public.slot_is_customer_bookable(availability_slots)
);

-- Period mutations remain atomic with their inventory update. Their complete
-- replacement definitions preserve Phase 2 canonicalization semantics.
create or replace function public.create_availability_period(p_start_local timestamp without time zone, p_end_local timestamp without time zone)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare requested_start timestamptz; requested_end timestamptz;
  business_timezone text := private.availability_period_business_timezone();
  canonical public.availability_periods%rowtype; overlapping_ids uuid[]; incompatible_ids uuid[];
  resulting_start timestamptz; resulting_end timestamptz; reconciliation jsonb;
begin
  perform private.require_admin();
  requested_start := private.availability_period_local_instant(p_start_local);
  requested_end := private.availability_period_local_instant(p_end_local);
  if requested_end <= requested_start then raise exception 'Availability end must be after its start.'; end if;
  if requested_start <= clock_timestamp() then raise exception 'Availability cannot start in the past.'; end if;
  lock table public.availability_periods in share row exclusive mode;
  select array_agg(id order by created_at,id) into overlapping_ids from public.availability_periods
    where starts_at <= requested_end and ends_at >= requested_start;
  if overlapping_ids is null then
    insert into public.availability_periods(starts_at,ends_at,anchor_local_date,anchor_local_time,timezone)
    values(requested_start,requested_end,p_start_local::date,p_start_local::time,business_timezone) returning * into canonical;
    reconciliation := private.reconcile_availability_slots_from_periods();
    return jsonb_build_object('outcome','created','period',to_jsonb(canonical),'reconciliation',reconciliation);
  end if;
  select * into canonical from public.availability_periods where id=overlapping_ids[1] for update;
  select array_agg(period.id order by period.created_at,period.id) into incompatible_ids
  from public.availability_periods period where period.id=any(overlapping_ids)
    and not private.availability_period_anchors_compatible(canonical.anchor_local_time,period.anchor_local_time);
  if incompatible_ids is not null then return jsonb_build_object('outcome','anchor_conflict','period_ids',to_jsonb(overlapping_ids),'conflicting_period_ids',to_jsonb(incompatible_ids),'anchor_local_time',canonical.anchor_local_time); end if;
  if cardinality(overlapping_ids)=1 and requested_start >= canonical.starts_at and requested_end <= canonical.ends_at then
    reconciliation := private.reconcile_availability_slots_from_periods();
    return jsonb_build_object('outcome','unchanged','period',to_jsonb(canonical),'reconciliation',reconciliation);
  end if;
  select least(requested_start,min(starts_at)),greatest(requested_end,max(ends_at)) into resulting_start,resulting_end from public.availability_periods where id=any(overlapping_ids);
  update public.availability_periods set starts_at=resulting_start,ends_at=resulting_end where id=canonical.id returning * into canonical;
  delete from public.availability_periods where id=any(overlapping_ids) and id<>canonical.id;
  reconciliation := private.reconcile_availability_slots_from_periods();
  return jsonb_build_object('outcome','extended','period',to_jsonb(canonical),'merged_period_ids',to_jsonb(overlapping_ids),'reconciliation',reconciliation);
end; $$;

create or replace function public.update_availability_period(p_period_id uuid,p_start_local timestamp without time zone,p_end_local timestamp without time zone)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare requested_start timestamptz; requested_end timestamptz; target public.availability_periods%rowtype;
  other_ids uuid[]; incompatible_ids uuid[]; resulting_start timestamptz; resulting_end timestamptz; reconciliation jsonb;
begin
  perform private.require_admin(); if p_period_id is null then raise exception 'An availability period is required.'; end if;
  requested_start:=private.availability_period_local_instant(p_start_local); requested_end:=private.availability_period_local_instant(p_end_local);
  if requested_end<=requested_start then raise exception 'Availability end must be after its start.'; end if;
  if requested_start<=clock_timestamp() then raise exception 'Availability cannot start in the past.'; end if;
  lock table public.availability_periods in share row exclusive mode;
  select * into target from public.availability_periods where id=p_period_id for update; if not found then raise exception 'The availability period does not exist.'; end if;
  select array_agg(id order by created_at,id) into other_ids from public.availability_periods where id<>target.id and starts_at<=requested_end and ends_at>=requested_start;
  if other_ids is not null then
    select array_agg(id order by created_at,id) into incompatible_ids from public.availability_periods where id=any(other_ids) and not private.availability_period_anchors_compatible(target.anchor_local_time,anchor_local_time);
    if incompatible_ids is not null then return jsonb_build_object('outcome','anchor_conflict','period_ids',to_jsonb(array_prepend(target.id,other_ids)),'conflicting_period_ids',to_jsonb(incompatible_ids),'anchor_local_time',target.anchor_local_time); end if;
  end if;
  select least(requested_start,coalesce(min(starts_at),requested_start)),greatest(requested_end,coalesce(max(ends_at),requested_end)) into resulting_start,resulting_end from public.availability_periods where id=any(other_ids);
  update public.availability_periods set starts_at=resulting_start,ends_at=resulting_end where id=target.id returning * into target;
  if other_ids is not null then delete from public.availability_periods where id=any(other_ids); end if;
  reconciliation:=private.reconcile_availability_slots_from_periods();
  return jsonb_build_object('outcome','updated','period',to_jsonb(target),'merged_period_ids',coalesce(to_jsonb(other_ids),'[]'::jsonb),'reconciliation',reconciliation);
end; $$;

-- PostgreSQL cannot change a function's return type in place. Phase 2 exposed
-- this RPC as boolean; Phase 3 deliberately returns the reconciliation detail.
-- There are no schema dependencies on this public RPC, and its replacement is
-- performed in this same transactional migration.
drop function public.delete_availability_period(uuid);

create function public.delete_availability_period(p_period_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare deleted boolean; reconciliation jsonb;
begin
  perform private.require_admin(); if p_period_id is null then raise exception 'An availability period is required.'; end if;
  lock table public.availability_periods in share row exclusive mode;
  delete from public.availability_periods where id=p_period_id; deleted:=found;
  if not deleted then return jsonb_build_object('outcome','not_found'); end if;
  reconciliation:=private.reconcile_availability_slots_from_periods();
  return jsonb_build_object('outcome','deleted','reconciliation',reconciliation);
end; $$;

alter function public.create_availability_period(timestamp without time zone, timestamp without time zone) owner to postgres;
alter function public.update_availability_period(uuid, timestamp without time zone, timestamp without time zone) owner to postgres;
alter function public.delete_availability_period(uuid) owner to postgres;
revoke all on function public.create_availability_period(timestamp without time zone, timestamp without time zone) from public;
revoke all on function public.update_availability_period(uuid, timestamp without time zone, timestamp without time zone) from public;
revoke all on function public.delete_availability_period(uuid) from public;
grant execute on function public.create_availability_period(timestamp without time zone, timestamp without time zone) to authenticated, service_role;
grant execute on function public.update_availability_period(uuid, timestamp without time zone, timestamp without time zone) to authenticated, service_role;
grant execute on function public.delete_availability_period(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
