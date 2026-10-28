-- Phase 5: dormant, audited retirement of legacy inventory. Installing this
-- migration never retires a slot; an administrator must explicitly invoke the
-- activation RPC after the production preflight has been reviewed.

alter table public.availability_slots
  add column legacy_retired_at timestamptz,
  add column legacy_cutover_id uuid;

create table private.legacy_availability_cutovers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  status text not null check (status in ('completed', 'restored')),
  inspected_count integer not null,
  retired_count integer not null,
  already_unavailable_count integer not null,
  referenced_count integer not null,
  active_booking_count integer not null,
  manual_review_count integer not null,
  details jsonb not null default '{}'::jsonb
);
create table private.legacy_availability_cutover_slots (
  cutover_id uuid not null references private.legacy_availability_cutovers(id) on delete restrict,
  slot_id uuid not null references public.availability_slots(id) on delete restrict,
  original_is_available boolean not null,
  retired_at timestamptz not null default clock_timestamp(),
  restored_at timestamptz,
  primary key (cutover_id, slot_id)
);
alter table private.legacy_availability_cutovers owner to postgres;
alter table private.legacy_availability_cutover_slots owner to postgres;
revoke all on table private.legacy_availability_cutovers, private.legacy_availability_cutover_slots from public, anon, authenticated;

create function private.guard_retired_legacy_slot_reopen()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.legacy_retired_at is not null and new.is_available is true then
    -- Cancellation, expiry, and webhook flows legitimately complete their
    -- booking/payment state and historically reopen the slot in the same
    -- transaction. Preserve those lifecycle updates while refusing only the
    -- reopen portion; raising here would roll the whole operation back.
    new.is_available := false;
  end if;
  return new;
end; $$;
alter function private.guard_retired_legacy_slot_reopen() owner to postgres;
revoke all on function private.guard_retired_legacy_slot_reopen() from public, anon, authenticated, service_role;
create trigger availability_slots_guard_retired_legacy_reopen
before update of is_available on public.availability_slots
for each row execute function private.guard_retired_legacy_slot_reopen();

-- Customer visibility is authoritative even if an older lifecycle function
-- leaves an obsolete slot marked available.
create or replace function public.slot_is_customer_bookable(slot public.availability_slots)
returns boolean language sql volatile security definer set search_path='' as $$
  select slot.legacy_retired_at is null and case
    when slot.availability_source = 'period' and not private.slot_is_desired_by_period(slot.slot_date, slot.slot_time, slot.starts_at) then false
    else not exists (select 1 from public.bookings booking
      where booking.status in ('pending','pending_payment','confirmed','completed','no_show')
        and booking.service_booking_mode_snapshot='timed'
        and tstzrange(booking.appointment_starts_at, booking.appointment_ends_at, '[)')
            && tstzrange(slot.starts_at, slot.starts_at + interval '60 minutes', '[)'))
  end;
$$;

-- A period may be added after cutover at a timestamp occupied by an
-- unreferenced retired legacy row.  The legacy table has one row per local
-- timestamp, so reconciliation cannot insert a second period row.  Adopt the
-- safe row as period inventory before reconciliation instead.  This is an
-- explicit admin availability action, not a lifecycle reopen.
create function private.adopt_retired_legacy_slots_for_periods()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  with adopted as (
    update public.availability_slots slot
    set availability_source='period', legacy_retired_at=null,
        legacy_cutover_id=null, is_available=true
    where slot.availability_source='legacy'
      and slot.legacy_retired_at is not null
      and not exists (select 1 from public.bookings booking where booking.slot_id=slot.id)
      and private.slot_is_desired_by_period(slot.slot_date, slot.slot_time, slot.starts_at)
    returning slot.id
  )
  update private.legacy_availability_cutover_slots audit
  set restored_at=coalesce(audit.restored_at, clock_timestamp())
  from adopted
  where audit.slot_id=adopted.id;
  return null;
end; $$;
alter function private.adopt_retired_legacy_slots_for_periods() owner to postgres;
revoke all on function private.adopt_retired_legacy_slots_for_periods() from public, anon, authenticated, service_role;
create trigger availability_periods_adopt_retired_legacy_slots
after insert or update of starts_at, ends_at, anchor_local_date, anchor_local_time
on public.availability_periods
for each statement execute function private.adopt_retired_legacy_slots_for_periods();

create function private.legacy_cutover_preflight()
returns void language plpgsql security definer set search_path='' as $$
begin
  if to_regclass('public.availability_periods') is null
    or to_regprocedure('private.desired_availability_period_slots()') is null
    or to_regprocedure('public.slot_is_customer_bookable(public.availability_slots)') is null
  then raise exception 'Phase 2-4 availability prerequisites are missing.'; end if;
  if private.availability_period_business_timezone() <> 'America/Chicago' then raise exception 'Legacy cutover requires America/Chicago business timezone.'; end if;
  if not exists (select 1 from pg_constraint where conname='bookings_no_overlapping_active_timed_appointments') then raise exception 'Temporal booking protection is missing.'; end if;
  if exists (select 1 from public.bookings where status in ('pending','pending_payment','confirmed','completed','no_show') and service_booking_mode_snapshot='timed' and (appointment_starts_at is null or appointment_ends_at is null)) then raise exception 'Active timed booking snapshots are incomplete.'; end if;
  if exists (select 1 from private.payment_attempts where status in ('reserved','processing','unknown')) then raise exception 'Unresolved payment attempts block legacy cutover.'; end if;
end; $$;

create function public.preview_legacy_availability_cutover()
returns jsonb language plpgsql security definer set search_path='' as $$
declare blockers text[] := '{}'::text[];
begin
  perform private.require_admin();
  begin perform private.legacy_cutover_preflight(); exception when others then blockers := array[sqlerrm]; end;
  return jsonb_build_object('blockers', blockers, 'total_legacy', (select count(*) from public.availability_slots where availability_source='legacy'),
    'future_legacy', (select count(*) from public.availability_slots where availability_source='legacy' and starts_at>=clock_timestamp()),
    'proposed_retirement', (select count(*) from public.availability_slots s where availability_source='legacy' and starts_at>=clock_timestamp() and legacy_retired_at is null),
    'referenced', (select count(*) from public.availability_slots s where availability_source='legacy' and starts_at>=clock_timestamp() and exists(select 1 from public.bookings b where b.slot_id=s.id)),
    'active_booking_protected', (select count(*) from public.availability_slots s where availability_source='legacy' and starts_at>=clock_timestamp() and exists(select 1 from public.bookings b where b.slot_id=s.id and b.status in ('pending','pending_payment','confirmed','completed','no_show'))),
    'historical_left_untouched', (select count(*) from public.availability_slots where availability_source='legacy' and starts_at<clock_timestamp()));
end; $$;

create function public.activate_legacy_availability_cutover()
returns jsonb language plpgsql security definer set search_path='' as $$
declare cutover uuid := gen_random_uuid(); inspected integer; retired integer; unavailable integer; referenced integer; active integer;
begin
  perform private.require_admin();
  perform private.legacy_cutover_preflight();
  lock table public.availability_slots in share row exclusive mode;
  lock table public.bookings in share row exclusive mode;
  -- Existing periods are the authoritative replacement inventory.  An
  -- unreferenced legacy row at a desired period start is converted before
  -- classification, so cutover cannot make that current availability vanish.
  update public.availability_slots slot
  set availability_source='period'
  where slot.availability_source='legacy' and slot.legacy_retired_at is null
    and not exists (select 1 from public.bookings booking where booking.slot_id=slot.id)
    and private.slot_is_desired_by_period(slot.slot_date, slot.slot_time, slot.starts_at);
  select count(*) into inspected from public.availability_slots where availability_source='legacy' and starts_at>=clock_timestamp() and legacy_retired_at is null;
  select count(*) into unavailable from public.availability_slots where availability_source='legacy' and starts_at>=clock_timestamp() and legacy_retired_at is null and not is_available;
  select count(*) into referenced from public.availability_slots s where availability_source='legacy' and starts_at>=clock_timestamp() and legacy_retired_at is null and exists(select 1 from public.bookings b where b.slot_id=s.id);
  select count(*) into active from public.availability_slots s where availability_source='legacy' and starts_at>=clock_timestamp() and legacy_retired_at is null and exists(select 1 from public.bookings b where b.slot_id=s.id and b.status in ('pending','pending_payment','confirmed','completed','no_show'));
  insert into private.legacy_availability_cutovers(id,actor_id,status,inspected_count,retired_count,already_unavailable_count,referenced_count,active_booking_count,manual_review_count)
  values(cutover, nullif(current_setting('request.jwt.claim.sub',true),'')::uuid, 'completed', inspected, inspected, unavailable, referenced, active, 0);
  insert into private.legacy_availability_cutover_slots(cutover_id,slot_id,original_is_available)
    select cutover,id,is_available from public.availability_slots where availability_source='legacy' and starts_at>=clock_timestamp() and legacy_retired_at is null;
  update public.availability_slots set is_available=false, legacy_retired_at=clock_timestamp(), legacy_cutover_id=cutover
    where availability_source='legacy' and starts_at>=clock_timestamp() and legacy_retired_at is null;
  return jsonb_build_object('outcome','completed','cutover_id',cutover,'retired',inspected,'referenced_preserved',referenced,'active_bookings_preserved',active);
end; $$;

create function public.restore_legacy_availability_cutover(p_cutover_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare restored integer;
begin
  perform private.require_admin();
  if not exists (select 1 from private.legacy_availability_cutovers where id=p_cutover_id) then
    return jsonb_build_object('outcome','not_found','slots_restored',0);
  end if;
  lock table public.availability_slots in share row exclusive mode;
  with restored_slots as (
    -- A restored slot is eligible only when a current period owns precisely
    -- this start.  Transfer that reusable inventory to period provenance so a
    -- later cutover cannot retire it again as legacy stock.
    update public.availability_slots s set availability_source='period', legacy_retired_at=null, legacy_cutover_id=null, is_available=true
    from private.legacy_availability_cutover_slots audit
    where audit.cutover_id=p_cutover_id and audit.slot_id=s.id and audit.original_is_available
      and audit.restored_at is null and s.starts_at>=clock_timestamp()+interval '24 hours'
      and private.slot_is_desired_by_period(s.slot_date, s.slot_time, s.starts_at)
      and not exists(select 1 from public.bookings b where b.slot_id=s.id and b.status in ('pending','pending_payment','confirmed','completed','no_show'))
      and not exists(select 1 from public.bookings b where b.status in ('pending','pending_payment','confirmed','completed','no_show')
        and b.service_booking_mode_snapshot='timed'
        and tstzrange(b.appointment_starts_at,b.appointment_ends_at,'[)') && tstzrange(s.starts_at,s.starts_at+interval '60 minutes','[)'))
    returning s.id
  ), audited as (
    update private.legacy_availability_cutover_slots audit set restored_at=clock_timestamp()
    from restored_slots where audit.cutover_id=p_cutover_id and audit.slot_id=restored_slots.id
    returning audit.slot_id
  ) select count(*) into restored from audited;
  update private.legacy_availability_cutovers set status='restored' where id=p_cutover_id;
  return jsonb_build_object('outcome','restored','slots_restored',restored);
end; $$;

alter function public.preview_legacy_availability_cutover() owner to postgres;
alter function public.activate_legacy_availability_cutover() owner to postgres;
alter function public.restore_legacy_availability_cutover(uuid) owner to postgres;
revoke all on function public.preview_legacy_availability_cutover(), public.activate_legacy_availability_cutover(), public.restore_legacy_availability_cutover(uuid) from public, anon;
grant execute on function public.preview_legacy_availability_cutover(), public.activate_legacy_availability_cutover(), public.restore_legacy_availability_cutover(uuid) to authenticated, service_role;
notify pgrst, 'reload schema';
