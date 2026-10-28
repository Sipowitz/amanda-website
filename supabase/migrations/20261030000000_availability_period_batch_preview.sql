-- Phase 4: a read-only preview and all-or-nothing batch entry point for the
-- period administration UI. Both intentionally call the Phase 3 period RPC,
-- rather than reproduce canonical merge/anchor/reconciliation rules here.

create function private.validate_availability_period_batch(p_periods jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare entry jsonb;
begin
  if p_periods is null or jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) = 0 then
    raise exception 'Add at least one availability date.';
  end if;
  if jsonb_array_length(p_periods) > 90 then
    raise exception 'Availability can be added for at most 90 dates at once.';
  end if;
  for entry in select value from jsonb_array_elements(p_periods)
  loop
    if jsonb_typeof(entry) <> 'object'
      or nullif(entry->>'start_local', '') is null
      or nullif(entry->>'end_local', '') is null
    then
      raise exception 'Each availability date needs a start and end time.';
    end if;
    -- Force parsing before any mutation, so malformed input cannot create a
    -- partially applied batch.
    perform (entry->>'start_local')::timestamp without time zone,
            (entry->>'end_local')::timestamp without time zone;
  end loop;
end;
$$;

alter function private.validate_availability_period_batch(jsonb) owner to postgres;
revoke all on function private.validate_availability_period_batch(jsonb) from public, anon, authenticated, service_role;

create function public.create_availability_period_batch(p_periods jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare entry jsonb; result jsonb; outcomes jsonb := '[]'::jsonb;
begin
  perform private.require_admin();
  perform private.validate_availability_period_batch(p_periods);
  for entry in select value from jsonb_array_elements(p_periods)
  loop
    result := public.create_availability_period(
      (entry->>'start_local')::timestamp without time zone,
      (entry->>'end_local')::timestamp without time zone
    );
    outcomes := outcomes || jsonb_build_array(result);
    -- Raise so PostgreSQL rolls back every earlier call in this function.
    if result->>'outcome' = 'anchor_conflict' then
      raise exception using
        errcode = 'P0001',
        message = 'Availability dates have incompatible appointment start times.',
        detail = result::text,
        hint = 'Edit the conflicting availability periods instead of merging them.';
    end if;
  end loop;
  return jsonb_build_object('outcome', 'created', 'periods_requested', jsonb_array_length(p_periods), 'results', outcomes);
end;
$$;

-- Execute real create/reconcile code inside an exception subtransaction and
-- deliberately roll it back after collecting the exact resulting inventory.
-- This makes previews authoritative without exposing temporary records.
create function public.preview_availability_period_batch(p_periods jsonb, p_exclude_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare entry jsonb; result jsonb; outcomes jsonb := '[]'::jsonb;
  preview jsonb; exception_message text; exception_detail text; initial_slot_ids uuid[];
begin
  perform private.require_admin();
  perform private.validate_availability_period_batch(p_periods);
  select coalesce(array_agg(id), '{}'::uuid[]) into initial_slot_ids
  from public.availability_slots;
  begin
    if p_exclude_period_id is not null then
      delete from public.availability_periods where id = p_exclude_period_id;
    end if;
    for entry in select value from jsonb_array_elements(p_periods)
    loop
      result := public.create_availability_period(
        (entry->>'start_local')::timestamp without time zone,
        (entry->>'end_local')::timestamp without time zone
      );
      outcomes := outcomes || jsonb_build_array(result);
      if result->>'outcome' = 'anchor_conflict' then
        preview := jsonb_build_object('outcome', 'anchor_conflict', 'results', outcomes);
        raise exception using errcode = 'P0001', message = 'availability preview complete', detail = preview::text;
      end if;
    end loop;
    select jsonb_build_object(
      'outcome', 'preview',
      'results', outcomes,
      'appointments', coalesce(jsonb_agg(jsonb_build_object(
        'slot_date', slot.slot_date,
        'slot_time', slot.slot_time,
        'starts_at', slot.starts_at,
        'is_available', slot.is_available,
        'already_existed', slot.id = any(initial_slot_ids),
        'has_booking', exists(select 1 from public.bookings booking where booking.slot_id = slot.id)
      ) order by slot.starts_at), '[]'::jsonb)
    ) into preview
    from public.availability_slots slot
    where slot.availability_source = 'period'
      and slot.starts_at >= clock_timestamp();
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

create function public.preview_availability_period_batch(p_periods jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select public.preview_availability_period_batch(p_periods, null::uuid); $$;
alter function public.preview_availability_period_batch(jsonb) owner to postgres;
revoke all on function public.preview_availability_period_batch(jsonb) from public, anon;
grant execute on function public.preview_availability_period_batch(jsonb) to authenticated, service_role;

create function public.get_admin_availability_period_overview()
returns table (
  id uuid, starts_at timestamptz, ends_at timestamptz,
  anchor_local_date date, anchor_local_time time without time zone,
  timezone text, appointment_count integer, booked_appointment_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select period.id, period.starts_at, period.ends_at, period.anchor_local_date,
         period.anchor_local_time, period.timezone,
         count(desired.starts_at) filter (where desired.skipped_dst is false)::integer,
         count(desired.starts_at) filter (where desired.skipped_dst is false and exists (
           select 1 from public.availability_slots slot join public.bookings booking on booking.slot_id = slot.id
           where slot.slot_date = desired.slot_date and slot.slot_time = desired.slot_time
         ))::integer
  from public.availability_periods period
  left join lateral private.desired_availability_period_slots() desired
    on desired.starts_at >= period.starts_at and desired.starts_at < period.ends_at
  group by period.id, period.starts_at, period.ends_at, period.anchor_local_date, period.anchor_local_time, period.timezone
  order by period.starts_at, period.ends_at, period.id;
end;
$$;

alter function public.get_admin_availability_period_overview() owner to postgres;
revoke all on function public.get_admin_availability_period_overview() from public, anon;
grant execute on function public.get_admin_availability_period_overview() to authenticated, service_role;

notify pgrst, 'reload schema';
