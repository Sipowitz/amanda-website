-- Batch previews used the real period mutation and inventory reconciliation
-- functions inside an exception subtransaction, then deliberately rolled the
-- work back.  On the authenticated production role that still performs every
-- trigger, slot write, and rollback for the whole batch.  Build the same
-- canonical period projection in a transaction-local table instead; preview
-- never changes public.availability_periods or public.availability_slots.

create function private.desired_availability_period_slots_for_periods(
  p_periods public.availability_periods[]
)
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
  foreach period in array coalesce(p_periods, '{}'::public.availability_periods[])
  loop
    if configured_timezone is distinct from period.timezone then
      raise exception 'Availability period timezone does not match the configured business timezone.';
    end if;
    local_start := period.starts_at at time zone period.timezone;
    local_end := period.ends_at at time zone period.timezone;
    anchor := period.anchor_local_date + period.anchor_local_time;
    hour_offset := floor(extract(epoch from (local_start - anchor)) / 3600)::bigint;
    candidate := anchor + hour_offset * interval '1 hour';
    while candidate < local_start loop
      candidate := candidate + interval '1 hour';
    end loop;

    while candidate < local_end loop
      begin
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

alter function private.desired_availability_period_slots_for_periods(public.availability_periods[]) owner to postgres;
revoke all on function private.desired_availability_period_slots_for_periods(public.availability_periods[])
  from public, anon, authenticated, service_role;

create or replace function private.desired_availability_period_slots()
returns table (
  slot_date date,
  slot_time text,
  starts_at timestamptz,
  skipped_dst boolean
)
language sql
volatile
security definer
set search_path = ''
as $$
  select desired.slot_date, desired.slot_time, desired.starts_at, desired.skipped_dst
  from private.desired_availability_period_slots_for_periods(
    (
      select coalesce(
        array_agg(
          row(period.id, period.starts_at, period.ends_at, period.anchor_local_date,
              period.anchor_local_time, period.timezone, period.created_at, period.updated_at)
          ::public.availability_periods
          order by period.starts_at, period.id
        ),
        '{}'::public.availability_periods[]
      )
      from public.availability_periods period
    )
  ) desired;
$$;

alter function private.desired_availability_period_slots() owner to postgres;
revoke all on function private.desired_availability_period_slots()
  from public, anon, authenticated, service_role;

-- Adoption is part of real creation, not preview.  Calculate desired starts
-- once rather than invoking the cadence generator for every retired slot.
create or replace function private.adopt_retired_legacy_slots_for_periods_impl()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
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
  requested_start timestamptz;
  requested_end timestamptz;
  business_timezone text := private.availability_period_business_timezone();
  canonical public.availability_periods%rowtype;
  overlapping_ids uuid[];
  incompatible_ids uuid[];
  resulting_start timestamptz;
  resulting_end timestamptz;
  projected_periods public.availability_periods[];
  desired_count integer;
  inserted_count integer;
  obsolete_deleted_count integer;
  protected_count integer;
  skipped_dst_count integer;
  preview jsonb;
begin
  perform private.require_admin();
  perform private.validate_availability_period_batch(p_periods);

  drop table if exists pg_temp.availability_period_preview_projection;
  create temporary table availability_period_preview_projection
    on commit drop
  as
    select *
    from public.availability_periods
    where p_exclude_period_id is null or id <> p_exclude_period_id;
  create unique index on availability_period_preview_projection(id);

  for entry in select value from jsonb_array_elements(p_periods)
  loop
    requested_start := private.availability_period_local_instant((entry->>'start_local')::timestamp without time zone);
    requested_end := private.availability_period_local_instant((entry->>'end_local')::timestamp without time zone);
    if requested_end <= requested_start then
      raise exception 'Availability end must be after its start.';
    end if;
    if requested_start <= clock_timestamp() then
      raise exception 'Availability cannot start in the past.';
    end if;

    select array_agg(id order by created_at, id) into overlapping_ids
    from pg_temp.availability_period_preview_projection
    where starts_at <= requested_end and ends_at >= requested_start;

    if overlapping_ids is null then
      insert into pg_temp.availability_period_preview_projection(
        id, starts_at, ends_at, anchor_local_date, anchor_local_time, timezone, created_at, updated_at
      ) values (
        gen_random_uuid(), requested_start, requested_end,
        (entry->>'start_local')::timestamp::date,
        (entry->>'start_local')::timestamp::time,
        business_timezone, clock_timestamp(), clock_timestamp()
      )
      returning id, starts_at, ends_at, anchor_local_date, anchor_local_time, timezone, created_at, updated_at
      into canonical;
      result := jsonb_build_object('outcome', 'created', 'period', to_jsonb(canonical));
    else
      select id, starts_at, ends_at, anchor_local_date, anchor_local_time, timezone, created_at, updated_at
      into canonical
      from pg_temp.availability_period_preview_projection
      where id = overlapping_ids[1];

      select array_agg(period.id order by period.created_at, period.id)
      into incompatible_ids
      from pg_temp.availability_period_preview_projection period
      where period.id = any(overlapping_ids)
        and not private.availability_period_anchors_compatible(
          canonical.anchor_local_time, period.anchor_local_time
        );
      if incompatible_ids is not null then
        return jsonb_build_object(
          'outcome', 'anchor_conflict',
          'results', outcomes || jsonb_build_array(jsonb_build_object(
            'outcome', 'anchor_conflict',
            'period_ids', to_jsonb(overlapping_ids),
            'conflicting_period_ids', to_jsonb(incompatible_ids),
            'anchor_local_time', canonical.anchor_local_time
          ))
        );
      end if;

      if cardinality(overlapping_ids) = 1
        and requested_start >= canonical.starts_at
        and requested_end <= canonical.ends_at
      then
        result := jsonb_build_object('outcome', 'unchanged', 'period', to_jsonb(canonical));
      else
        select least(requested_start, min(starts_at)), greatest(requested_end, max(ends_at))
        into resulting_start, resulting_end
        from pg_temp.availability_period_preview_projection
        where id = any(overlapping_ids);
        update pg_temp.availability_period_preview_projection
        set starts_at = resulting_start, ends_at = resulting_end, updated_at = clock_timestamp()
        where id = canonical.id
        returning id, starts_at, ends_at, anchor_local_date, anchor_local_time, timezone, created_at, updated_at
        into canonical;
        delete from pg_temp.availability_period_preview_projection
        where id = any(overlapping_ids) and id <> canonical.id;
        result := jsonb_build_object(
          'outcome', 'extended', 'period', to_jsonb(canonical),
          'merged_period_ids', to_jsonb(overlapping_ids)
        );
      end if;
    end if;
    outcomes := outcomes || jsonb_build_array(result);
  end loop;

  select coalesce(array_agg(
    row(id, starts_at, ends_at, anchor_local_date, anchor_local_time, timezone, created_at, updated_at)
    ::public.availability_periods
    order by starts_at, id
  ), '{}'::public.availability_periods[])
  into projected_periods
  from pg_temp.availability_period_preview_projection;

  drop table if exists pg_temp.availability_period_preview_desired_slots;
  create temporary table availability_period_preview_desired_slots
    on commit drop
  as
    select distinct slot_date, slot_time, starts_at, skipped_dst
    from private.desired_availability_period_slots_for_periods(projected_periods);
  create unique index on availability_period_preview_desired_slots(slot_date, slot_time, starts_at)
    where skipped_dst is false;

  select count(*) into desired_count
  from pg_temp.availability_period_preview_desired_slots
  where skipped_dst is false;
  select count(*) into skipped_dst_count
  from pg_temp.availability_period_preview_desired_slots
  where skipped_dst is true;
  select count(*) into inserted_count
  from pg_temp.availability_period_preview_desired_slots desired
  where desired.skipped_dst is false
    and not exists (
      select 1 from public.availability_slots slot
      where slot.slot_date = desired.slot_date
        and slot.slot_time = desired.slot_time
    );
  select count(*) into protected_count
  from public.availability_slots slot
  where slot.availability_source = 'period'
    and not exists (
      select 1 from pg_temp.availability_period_preview_desired_slots desired
      where desired.skipped_dst is false
        and desired.slot_date = slot.slot_date
        and desired.slot_time = slot.slot_time
        and desired.starts_at = slot.starts_at
    )
    and exists (select 1 from public.bookings booking where booking.slot_id = slot.id);
  select count(*) into obsolete_deleted_count
  from public.availability_slots slot
  where slot.availability_source = 'period'
    and not exists (
      select 1 from pg_temp.availability_period_preview_desired_slots desired
      where desired.skipped_dst is false
        and desired.slot_date = slot.slot_date
        and desired.slot_time = slot.slot_time
        and desired.starts_at = slot.starts_at
    )
    and not exists (select 1 from public.bookings booking where booking.slot_id = slot.id);

  select jsonb_build_object(
    'outcome', 'preview',
    'results', outcomes,
    'reconciliation', jsonb_build_object(
      'desired_slots', desired_count,
      'slots_created', inserted_count,
      'slots_existing', desired_count - inserted_count,
      'obsolete_slots_deleted', obsolete_deleted_count,
      'protected_slots_preserved', protected_count,
      'dst_occurrences_skipped', skipped_dst_count
    ),
    'appointments', coalesce(jsonb_agg(jsonb_build_object(
      'slot_date', desired.slot_date,
      'slot_time', desired.slot_time,
      'starts_at', desired.starts_at,
      'is_available', case
        when slot.id is null then true
        when slot.availability_source = 'legacy'
          and slot.legacy_retired_at is not null
          and not exists (select 1 from public.bookings booking where booking.slot_id = slot.id)
        then true
        else slot.is_available
      end,
      'already_existed', slot.id is not null,
      'has_booking', slot.id is not null and exists(
        select 1 from public.bookings booking where booking.slot_id = slot.id
      )
    ) order by desired.starts_at), '[]'::jsonb)
  ) into preview
  from pg_temp.availability_period_preview_desired_slots desired
  left join public.availability_slots slot
    on slot.slot_date = desired.slot_date
    and slot.slot_time = desired.slot_time
    and slot.starts_at = desired.starts_at
  where desired.skipped_dst is false;

  drop table pg_temp.availability_period_preview_desired_slots;
  drop table pg_temp.availability_period_preview_projection;
  return preview;
end;
$$;

alter function public.preview_availability_period_batch(jsonb, uuid) owner to postgres;
revoke all on function public.preview_availability_period_batch(jsonb, uuid) from public, anon;
grant execute on function public.preview_availability_period_batch(jsonb, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
