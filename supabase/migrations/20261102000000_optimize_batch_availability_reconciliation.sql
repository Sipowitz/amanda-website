-- Batch availability mutations previously invoked the public single-period
-- RPC for every selected date.  That RPC reconciles the complete inventory,
-- so a 23-date weekday submission regenerated the whole schedule 23 times.
-- Keep canonical-period rules identical, but defer adoption/reconciliation
-- until all dates have been validated and mutated in one transaction.

create or replace function private.adopt_retired_legacy_slots_for_periods_impl()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with adopted as (
    update public.availability_slots slot
    set availability_source = 'period', legacy_retired_at = null,
        legacy_cutover_id = null, is_available = true
    where slot.availability_source = 'legacy'
      and slot.legacy_retired_at is not null
      and not exists (
        select 1 from public.bookings booking where booking.slot_id = slot.id
      )
      and private.slot_is_desired_by_period(slot.slot_date, slot.slot_time, slot.starts_at)
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

create or replace function private.adopt_retired_legacy_slots_for_periods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.defer_availability_period_adoption', true) is distinct from 'on' then
    perform private.adopt_retired_legacy_slots_for_periods_impl();
  end if;
  return null;
end;
$$;

alter function private.adopt_retired_legacy_slots_for_periods() owner to postgres;
revoke all on function private.adopt_retired_legacy_slots_for_periods()
  from public, anon, authenticated, service_role;

-- Materialize desired starts once per reconciliation.  The old implementation
-- called private.desired_availability_period_slots repeatedly, including once
-- per existing period slot through private.slot_is_desired_by_period().
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
begin
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
    insert into public.availability_slots(slot_date, slot_time, is_available, availability_source)
    select slot_date, slot_time, true, 'period'
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
      select 1
      from pg_temp.availability_period_reconcile_desired_slots desired
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
      select 1
      from pg_temp.availability_period_reconcile_desired_slots desired
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
        select 1
        from pg_temp.availability_period_reconcile_desired_slots desired
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

-- The internal mutation is the exact Phase 3 canonicalization logic without
-- inventory work.  It is private so public callers cannot leave slots stale.
create function private.mutate_availability_period_without_reconciliation(
  p_start_local timestamp without time zone,
  p_end_local timestamp without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_start timestamptz;
  requested_end timestamptz;
  business_timezone text := private.availability_period_business_timezone();
  canonical public.availability_periods%rowtype;
  overlapping_ids uuid[];
  incompatible_ids uuid[];
  resulting_start timestamptz;
  resulting_end timestamptz;
begin
  requested_start := private.availability_period_local_instant(p_start_local);
  requested_end := private.availability_period_local_instant(p_end_local);
  if requested_end <= requested_start then
    raise exception 'Availability end must be after its start.';
  end if;
  if requested_start <= clock_timestamp() then
    raise exception 'Availability cannot start in the past.';
  end if;

  lock table public.availability_periods in share row exclusive mode;
  select array_agg(id order by created_at, id) into overlapping_ids
  from public.availability_periods
  where starts_at <= requested_end and ends_at >= requested_start;

  if overlapping_ids is null then
    insert into public.availability_periods(
      starts_at, ends_at, anchor_local_date, anchor_local_time, timezone
    ) values (
      requested_start, requested_end, p_start_local::date, p_start_local::time, business_timezone
    ) returning * into canonical;
    return jsonb_build_object('outcome', 'created', 'period', to_jsonb(canonical));
  end if;

  select * into canonical
  from public.availability_periods
  where id = overlapping_ids[1]
  for update;

  select array_agg(period.id order by period.created_at, period.id)
  into incompatible_ids
  from public.availability_periods period
  where period.id = any(overlapping_ids)
    and not private.availability_period_anchors_compatible(
      canonical.anchor_local_time, period.anchor_local_time
    );
  if incompatible_ids is not null then
    return jsonb_build_object(
      'outcome', 'anchor_conflict',
      'period_ids', to_jsonb(overlapping_ids),
      'conflicting_period_ids', to_jsonb(incompatible_ids),
      'anchor_local_time', canonical.anchor_local_time
    );
  end if;

  if cardinality(overlapping_ids) = 1
    and requested_start >= canonical.starts_at
    and requested_end <= canonical.ends_at
  then
    return jsonb_build_object('outcome', 'unchanged', 'period', to_jsonb(canonical));
  end if;

  select least(requested_start, min(starts_at)), greatest(requested_end, max(ends_at))
  into resulting_start, resulting_end
  from public.availability_periods
  where id = any(overlapping_ids);

  update public.availability_periods
  set starts_at = resulting_start, ends_at = resulting_end
  where id = canonical.id
  returning * into canonical;
  delete from public.availability_periods
  where id = any(overlapping_ids) and id <> canonical.id;

  return jsonb_build_object(
    'outcome', 'extended',
    'period', to_jsonb(canonical),
    'merged_period_ids', to_jsonb(overlapping_ids)
  );
end;
$$;

alter function private.mutate_availability_period_without_reconciliation(timestamp without time zone, timestamp without time zone) owner to postgres;
revoke all on function private.mutate_availability_period_without_reconciliation(timestamp without time zone, timestamp without time zone)
  from public, anon, authenticated, service_role;

create or replace function public.create_availability_period(
  p_start_local timestamp without time zone,
  p_end_local timestamp without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  reconciliation jsonb;
begin
  perform private.require_admin();
  result := private.mutate_availability_period_without_reconciliation(p_start_local, p_end_local);
  if result->>'outcome' = 'anchor_conflict' then
    return result;
  end if;
  reconciliation := private.reconcile_availability_slots_from_periods();
  return result || jsonb_build_object('reconciliation', reconciliation);
end;
$$;

alter function public.create_availability_period(timestamp without time zone, timestamp without time zone) owner to postgres;
revoke all on function public.create_availability_period(timestamp without time zone, timestamp without time zone) from public;
grant execute on function public.create_availability_period(timestamp without time zone, timestamp without time zone) to authenticated, service_role;

create or replace function public.create_availability_period_batch(p_periods jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry jsonb;
  result jsonb;
  outcomes jsonb := '[]'::jsonb;
  reconciliation jsonb;
begin
  perform private.require_admin();
  perform private.validate_availability_period_batch(p_periods);
  perform set_config('app.defer_availability_period_adoption', 'on', true);

  for entry in select value from jsonb_array_elements(p_periods)
  loop
    result := private.mutate_availability_period_without_reconciliation(
      (entry->>'start_local')::timestamp without time zone,
      (entry->>'end_local')::timestamp without time zone
    );
    outcomes := outcomes || jsonb_build_array(result);
    if result->>'outcome' = 'anchor_conflict' then
      raise exception using
        errcode = 'P0001',
        message = 'Availability dates have incompatible appointment start times.',
        detail = result::text,
        hint = 'Edit the conflicting availability periods instead of merging them.';
    end if;
  end loop;

  perform private.adopt_retired_legacy_slots_for_periods_impl();
  reconciliation := private.reconcile_availability_slots_from_periods();
  return jsonb_build_object(
    'outcome', 'created',
    'periods_requested', jsonb_array_length(p_periods),
    'results', outcomes,
    'reconciliation', reconciliation
  );
end;
$$;

create or replace function public.preview_availability_period_batch(
  p_periods jsonb,
  p_exclude_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry jsonb;
  result jsonb;
  outcomes jsonb := '[]'::jsonb;
  reconciliation jsonb;
  preview jsonb;
  exception_message text;
  exception_detail text;
  initial_slot_ids uuid[];
begin
  perform private.require_admin();
  perform private.validate_availability_period_batch(p_periods);
  select coalesce(array_agg(id), '{}'::uuid[]) into initial_slot_ids
  from public.availability_slots;

  begin
    perform set_config('app.defer_availability_period_adoption', 'on', true);
    if p_exclude_period_id is not null then
      delete from public.availability_periods where id = p_exclude_period_id;
    end if;
    for entry in select value from jsonb_array_elements(p_periods)
    loop
      result := private.mutate_availability_period_without_reconciliation(
        (entry->>'start_local')::timestamp without time zone,
        (entry->>'end_local')::timestamp without time zone
      );
      outcomes := outcomes || jsonb_build_array(result);
      if result->>'outcome' = 'anchor_conflict' then
        preview := jsonb_build_object('outcome', 'anchor_conflict', 'results', outcomes);
        raise exception using errcode = 'P0001', message = 'availability preview complete', detail = preview::text;
      end if;
    end loop;

    perform private.adopt_retired_legacy_slots_for_periods_impl();
    reconciliation := private.reconcile_availability_slots_from_periods();
    select jsonb_build_object(
      'outcome', 'preview',
      'results', outcomes,
      'reconciliation', reconciliation,
      'appointments', coalesce(jsonb_agg(jsonb_build_object(
        'slot_date', desired.slot_date,
        'slot_time', desired.slot_time,
        'starts_at', desired.starts_at,
        'is_available', coalesce(slot.is_available, false),
        'already_existed', slot.id is not null and slot.id = any(initial_slot_ids),
        'has_booking', slot.id is not null and exists(
          select 1 from public.bookings booking where booking.slot_id = slot.id
        )
      ) order by desired.starts_at), '[]'::jsonb)
    ) into preview
    from (
      select distinct slot_date, slot_time, starts_at
      from private.desired_availability_period_slots()
      where skipped_dst is false
    ) desired
    left join public.availability_slots slot
      on slot.slot_date = desired.slot_date
      and slot.slot_time = desired.slot_time
      and slot.starts_at = desired.starts_at;
    raise exception using errcode = 'P0001', message = 'availability preview complete', detail = preview::text;
  exception when sqlstate 'P0001' then
    get stacked diagnostics exception_message = message_text, exception_detail = pg_exception_detail;
    if exception_message = 'availability preview complete' then
      return exception_detail::jsonb;
    end if;
    raise;
  end;
end;
$$;

alter function public.create_availability_period_batch(jsonb) owner to postgres;
alter function public.preview_availability_period_batch(jsonb, uuid) owner to postgres;
revoke all on function public.create_availability_period_batch(jsonb) from public, anon;
revoke all on function public.preview_availability_period_batch(jsonb, uuid) from public, anon;
grant execute on function public.create_availability_period_batch(jsonb) to authenticated, service_role;
grant execute on function public.preview_availability_period_batch(jsonb, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
