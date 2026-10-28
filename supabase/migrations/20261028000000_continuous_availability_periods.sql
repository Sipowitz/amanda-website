-- Phase 2: canonical continuous availability periods. This migration does not
-- create, alter, or delete availability_slots; Phase 3 will synchronize the
-- inventory from these period rules.

create table public.availability_periods (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Preserve the original local wall-time cadence even if a later merge
  -- extends the period earlier or later.
  anchor_local_date date not null,
  anchor_local_time time without time zone not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_periods_valid_range check (starts_at < ends_at),
  constraint availability_periods_anchor_minute_precision check (
    extract(second from anchor_local_time) = 0
  )
);

alter table public.availability_periods owner to postgres;
alter table public.availability_periods enable row level security;
revoke all on table public.availability_periods from public, anon, authenticated;
create index availability_periods_starts_at_idx on public.availability_periods(starts_at);
create index availability_periods_ends_at_idx on public.availability_periods(ends_at);

-- Existing customer/slot reads deliberately fall back to Chicago when the
-- legacy setting is unavailable. Period administration must instead fail
-- closed: a new canonical schedule must never be created under an inferred
-- timezone.
create function private.availability_period_business_timezone()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  configured_timezone text;
begin
  select nullif(btrim(timezone), '') into configured_timezone
  from public.email_settings where id = true;
  if configured_timezone is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names
      where name = configured_timezone
        and (name like '%/%' or name = 'UTC')
        and name not like 'posix/%'
        and name not like 'right/%'
    )
  then
    raise exception 'The business timezone is invalid.';
  end if;
  return configured_timezone;
end;
$$;

alter function private.availability_period_business_timezone() owner to postgres;
revoke all on function private.availability_period_business_timezone()
  from public, anon, authenticated, service_role;

create function private.availability_period_local_instant(p_local timestamp without time zone)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  business_timezone text := private.availability_period_business_timezone();
  resolved timestamptz;
begin
  if p_local is null then
    raise exception 'Availability start and end are required.';
  end if;
  if date_trunc('minute', p_local) <> p_local then
    raise exception 'Availability times must be precise to the minute.';
  end if;
  resolved := p_local at time zone business_timezone;
  if resolved at time zone business_timezone <> p_local then
    raise exception 'This local time does not exist because of daylight-saving time.';
  end if;
  -- America/Chicago's fall transition is one hour. Reject either possible
  -- duplicate resolution rather than silently selecting a fold.
  if (resolved - interval '1 hour') at time zone business_timezone = p_local
    or (resolved + interval '1 hour') at time zone business_timezone = p_local
  then
    raise exception 'This local time is ambiguous because of daylight-saving time.';
  end if;
  return resolved;
end;
$$;

alter function private.availability_period_local_instant(timestamp without time zone) owner to postgres;
revoke all on function private.availability_period_local_instant(timestamp without time zone)
  from public, anon, authenticated, service_role;

create function private.availability_period_anchors_compatible(
  p_left time without time zone,
  p_right time without time zone
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select (extract(epoch from p_left)::integer % 3600)
       = (extract(epoch from p_right)::integer % 3600);
$$;

alter function private.availability_period_anchors_compatible(time without time zone, time without time zone) owner to postgres;
revoke all on function private.availability_period_anchors_compatible(time without time zone, time without time zone)
  from public, anon, authenticated, service_role;

create function private.touch_availability_period_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function private.touch_availability_period_updated_at() owner to postgres;
revoke all on function private.touch_availability_period_updated_at()
  from public, anon, authenticated, service_role;

create trigger availability_periods_touch_updated_at
before update on public.availability_periods
for each row execute function private.touch_availability_period_updated_at();

-- Add a canonical period. The table lock serializes period merges: row locks
-- alone cannot protect the empty-gap case where concurrent inserts overlap.
create function public.create_availability_period(
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
  existing public.availability_periods%rowtype;
  canonical public.availability_periods%rowtype;
  overlapping_ids uuid[];
  incompatible_ids uuid[];
  resulting_start timestamptz;
  resulting_end timestamptz;
begin
  perform private.require_admin();
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

  select * into canonical from public.availability_periods
  where id = overlapping_ids[1] for update;

  -- A new submission is absorbed into a pre-existing canonical cadence. Only
  -- bridging two existing canonical periods can discard an established anchor.
  select array_agg(period.id order by period.created_at, period.id)
  into incompatible_ids
  from public.availability_periods as period
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

  select least(requested_start, min(starts_at)), greatest(requested_end, max(ends_at))
  into resulting_start, resulting_end
  from public.availability_periods where id = any(overlapping_ids);

  if cardinality(overlapping_ids) = 1
    and requested_start >= canonical.starts_at
    and requested_end <= canonical.ends_at
  then
    return jsonb_build_object('outcome', 'unchanged', 'period', to_jsonb(canonical));
  end if;

  update public.availability_periods
  set starts_at = resulting_start, ends_at = resulting_end
  where id = canonical.id
  returning * into canonical;
  delete from public.availability_periods
  where id = any(overlapping_ids) and id <> canonical.id;
  return jsonb_build_object(
    'outcome', 'extended', 'period', to_jsonb(canonical),
    'merged_period_ids', to_jsonb(overlapping_ids)
  );
end;
$$;

-- Editing retains the selected canonical period's anchor. Other canonical
-- periods are merged only where their established cadences are compatible.
create function public.update_availability_period(
  p_period_id uuid,
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
  target public.availability_periods%rowtype;
  other_ids uuid[];
  incompatible_ids uuid[];
  resulting_start timestamptz;
  resulting_end timestamptz;
begin
  perform private.require_admin();
  if p_period_id is null then raise exception 'An availability period is required.'; end if;
  requested_start := private.availability_period_local_instant(p_start_local);
  requested_end := private.availability_period_local_instant(p_end_local);
  if requested_end <= requested_start then raise exception 'Availability end must be after its start.'; end if;
  if requested_start <= clock_timestamp() then raise exception 'Availability cannot start in the past.'; end if;

  lock table public.availability_periods in share row exclusive mode;
  select * into target from public.availability_periods where id = p_period_id for update;
  if not found then raise exception 'The availability period does not exist.'; end if;

  select array_agg(id order by created_at, id) into other_ids
  from public.availability_periods
  where id <> target.id and starts_at <= requested_end and ends_at >= requested_start;
  if other_ids is not null then
    select array_agg(id order by created_at, id) into incompatible_ids
    from public.availability_periods
    where id = any(other_ids)
      and not private.availability_period_anchors_compatible(target.anchor_local_time, anchor_local_time);
    if incompatible_ids is not null then
      return jsonb_build_object('outcome','anchor_conflict','period_ids',to_jsonb(array_prepend(target.id, other_ids)),
        'conflicting_period_ids',to_jsonb(incompatible_ids),'anchor_local_time',target.anchor_local_time);
    end if;
  end if;

  select least(requested_start, coalesce(min(starts_at), requested_start)),
         greatest(requested_end, coalesce(max(ends_at), requested_end))
  into resulting_start, resulting_end
  from public.availability_periods where id = any(other_ids);
  update public.availability_periods set starts_at=resulting_start, ends_at=resulting_end
  where id=target.id returning * into target;
  if other_ids is not null then delete from public.availability_periods where id=any(other_ids); end if;
  return jsonb_build_object('outcome','updated','period',to_jsonb(target),
    'merged_period_ids',coalesce(to_jsonb(other_ids),'[]'::jsonb));
end;
$$;

create function public.delete_availability_period(p_period_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_period_id is null then raise exception 'An availability period is required.'; end if;
  delete from public.availability_periods where id = p_period_id;
  return found;
end;
$$;

create function public.get_admin_availability_periods()
returns table (
  id uuid, starts_at timestamptz, ends_at timestamptz,
  anchor_local_date date, anchor_local_time time without time zone,
  timezone text, created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query select period.id, period.starts_at, period.ends_at,
    period.anchor_local_date, period.anchor_local_time, period.timezone,
    period.created_at, period.updated_at
  from public.availability_periods as period
  order by period.starts_at, period.ends_at, period.id;
end;
$$;

alter function public.create_availability_period(timestamp without time zone, timestamp without time zone) owner to postgres;
alter function public.update_availability_period(uuid, timestamp without time zone, timestamp without time zone) owner to postgres;
alter function public.delete_availability_period(uuid) owner to postgres;
alter function public.get_admin_availability_periods() owner to postgres;
revoke all on function public.create_availability_period(timestamp without time zone, timestamp without time zone) from public, anon, authenticated;
revoke all on function public.update_availability_period(uuid, timestamp without time zone, timestamp without time zone) from public, anon, authenticated;
revoke all on function public.delete_availability_period(uuid) from public, anon, authenticated;
revoke all on function public.get_admin_availability_periods() from public, anon, authenticated;
grant execute on function public.create_availability_period(timestamp without time zone, timestamp without time zone) to authenticated, service_role;
grant execute on function public.update_availability_period(uuid, timestamp without time zone, timestamp without time zone) to authenticated, service_role;
grant execute on function public.delete_availability_period(uuid) to authenticated, service_role;
grant execute on function public.get_admin_availability_periods() to authenticated, service_role;

comment on table public.availability_periods is
  'Canonical business-local availability ranges. Periods merge at overlap/adjacency; slots remain unchanged until Phase 3.';

notify pgrst, 'reload schema';
