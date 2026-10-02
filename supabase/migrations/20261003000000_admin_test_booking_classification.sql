-- An operational/reporting classification only. Financial and audit history
-- stays attached to every booking, including bookings classified as tests.

alter table public.bookings
  add column is_test boolean not null default false;

create function public.set_booking_test_classification(
  p_booking_id uuid,
  p_is_test boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();

  if p_booking_id is null or p_is_test is null then
    raise exception 'Booking and test classification are required.';
  end if;

  perform 1
  from public.bookings as booking
  where booking.id = p_booking_id
  for update;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  update public.bookings
  set is_test = p_is_test
  where id = p_booking_id;

  return true;
end;
$$;

alter function public.set_booking_test_classification(uuid, boolean) owner to postgres;
revoke all on function public.set_booking_test_classification(uuid, boolean) from public, anon;
grant execute on function public.set_booking_test_classification(uuid, boolean)
  to authenticated, service_role;

create or replace function public.get_admin_discount_codes()
returns table (
  id uuid,
  code text,
  percentage_off integer,
  scope text,
  enabled boolean,
  expires_at timestamptz,
  revision integer,
  selected_service_ids uuid[],
  uses bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select discount.id, discount.code, discount.percentage_off, discount.scope,
    discount.enabled, discount.expires_at, discount.revision,
    coalesce(array_agg(distinct mapping.service_id) filter (where mapping.service_id is not null), '{}'::uuid[]),
    count(distinct redemption.id) filter (where booking.is_test is false)
  from private.discount_codes as discount
  left join private.discount_code_services as mapping on mapping.discount_code_id = discount.id
  left join private.discount_redemptions as redemption on redemption.discount_code_id = discount.id
  left join public.bookings as booking on booking.id = redemption.booking_id
  group by discount.id
  order by discount.created_at desc, discount.code;
end;
$$;

create or replace function public.get_admin_stats(
  p_as_of timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result jsonb;
  business_timezone text;
begin
  perform private.require_admin();
  business_timezone := public.get_business_timezone();

  with report_clock as (
    select coalesce(p_as_of, clock_timestamp()) as as_of,
      timezone(business_timezone, coalesce(p_as_of, clock_timestamp())) as business_now
  ), paid_rows as (
    select booking.id, booking.service_id, booking.service_name_snapshot, booking.paid_at,
      pricing.service_id as pricing_service_id, pricing.final_amount_minor, pricing.currency,
      timezone(business_timezone, booking.paid_at) as paid_business_time
    from public.bookings as booking
    left join private.booking_pricing as pricing on pricing.booking_id = booking.id
    where booking.payment_status = 'paid'
      and booking.is_test is false
  ), integrity_exceptions as (
    select paid.id, exception.reason
    from paid_rows as paid cross join report_clock as clock
    cross join lateral (values
      ('missing_paid_at', paid.paid_at is null),
      ('missing_immutable_pricing', paid.pricing_service_id is null),
      ('pricing_service_mismatch', paid.pricing_service_id is not null and paid.pricing_service_id <> paid.service_id),
      ('invalid_immutable_pricing', paid.pricing_service_id is not null and (paid.final_amount_minor is null or paid.final_amount_minor < 0 or paid.currency is null or paid.currency !~ '^[A-Z]{3}$')),
      ('future_paid_at', paid.paid_at is not null and paid.paid_at > clock.as_of)
    ) as exception(reason, applies) where exception.applies
  ), eligible_paid_rows as (
    select paid.* from paid_rows as paid cross join report_clock as clock
    where paid.paid_at is not null and paid.paid_at <= clock.as_of
      and paid.pricing_service_id = paid.service_id and paid.final_amount_minor >= 0
      and paid.currency ~ '^[A-Z]{3}$'
  ), period_definitions as (
    select 'today'::text as period, clock.business_now::date::timestamp as starts_at, clock.business_now as ends_at from report_clock as clock
    union all select 'week', date_trunc('week', clock.business_now), clock.business_now from report_clock as clock
    union all select 'month', date_trunc('month', clock.business_now), clock.business_now from report_clock as clock
    union all select 'year', date_trunc('year', clock.business_now), clock.business_now from report_clock as clock
    union all select 'all_time', null, clock.business_now from report_clock as clock
  ), period_rows as (
    select definition.period, count(paid.id) as paid_booking_count, coalesce((
      select jsonb_agg(jsonb_build_object('currency', values.currency, 'value_minor', values.value_minor) order by values.currency)
      from (select row.currency, sum(row.final_amount_minor)::bigint as value_minor
        from eligible_paid_rows as row
        where (definition.starts_at is null or row.paid_business_time >= definition.starts_at) and row.paid_business_time <= definition.ends_at
        group by row.currency) as values
    ), '[]'::jsonb) as value_by_currency
    from period_definitions as definition left join eligible_paid_rows as paid
      on (definition.starts_at is null or paid.paid_business_time >= definition.starts_at) and paid.paid_business_time <= definition.ends_at
    group by definition.period, definition.starts_at, definition.ends_at
  ), period_totals as (
    select jsonb_object_agg(period, jsonb_build_object('paid_booking_count', paid_booking_count, 'value_by_currency', value_by_currency)) as data from period_rows
  ), monthly_rows as (
    select months.month_start, count(paid.id) as paid_booking_count, coalesce((
      select jsonb_agg(jsonb_build_object('currency', values.currency, 'value_minor', values.value_minor) order by values.currency)
      from (select row.currency, sum(row.final_amount_minor)::bigint as value_minor from eligible_paid_rows as row
        where date_trunc('month', row.paid_business_time) = months.month_start group by row.currency) as values
    ), '[]'::jsonb) as value_by_currency
    from report_clock as clock cross join lateral generate_series(date_trunc('month', clock.business_now) - interval '11 months', date_trunc('month', clock.business_now), interval '1 month') as months(month_start)
    left join eligible_paid_rows as paid on date_trunc('month', paid.paid_business_time) = months.month_start
    group by months.month_start
  ), monthly_history as (
    select coalesce(jsonb_agg(jsonb_build_object('month', to_char(month_start, 'YYYY-MM'), 'paid_booking_count', paid_booking_count, 'value_by_currency', value_by_currency) order by month_start), '[]'::jsonb) as data from monthly_rows
  ), service_breakdown as (
    select coalesce(jsonb_agg(jsonb_build_object('service_id', services.service_id, 'service_name', services.service_name, 'paid_booking_count', services.paid_booking_count, 'value_by_currency', services.value_by_currency) order by services.service_name, services.service_id), '[]'::jsonb) as data
    from (select paid.service_id, paid.service_name_snapshot as service_name, count(*) as paid_booking_count, coalesce((
      select jsonb_agg(jsonb_build_object('currency', values.currency, 'value_minor', values.value_minor) order by values.currency)
      from (select row.currency, sum(row.final_amount_minor)::bigint as value_minor from eligible_paid_rows as row
        where row.service_id = paid.service_id and row.service_name_snapshot = paid.service_name_snapshot group by row.currency) as values
    ), '[]'::jsonb) as value_by_currency from eligible_paid_rows as paid group by paid.service_id, paid.service_name_snapshot) as services
  ), integrity_summary as (
    select coalesce(jsonb_agg(jsonb_build_object('reason', exceptions.reason, 'paid_booking_count', exceptions.paid_booking_count) order by exceptions.reason), '[]'::jsonb) as data
    from (select reason, count(distinct id) as paid_booking_count from integrity_exceptions group by reason) as exceptions
  ) select jsonb_build_object('reporting_timezone', business_timezone, 'week_starts_on', 'monday',
    'period_totals', period_totals.data, 'monthly_history', monthly_history.data,
    'service_breakdown', service_breakdown.data, 'data_integrity_exceptions', integrity_summary.data)
  into result from period_totals, monthly_history, service_breakdown, integrity_summary;
  return result;
end;
$$;

alter function public.get_admin_discount_codes() owner to postgres;
alter function public.get_admin_stats(timestamptz) owner to postgres;
revoke all on function public.get_admin_discount_codes() from public, anon;
revoke all on function public.get_admin_stats(timestamptz) from public, anon;
grant execute on function public.get_admin_discount_codes() to authenticated, service_role;
grant execute on function public.get_admin_stats(timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
