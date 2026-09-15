-- Admin-only immutable commercial history for booking management. This narrow
-- projection deliberately exposes no payment attempts, credentials, customer
-- data, discount definitions, or review-guard material.

create function public.get_admin_booking_pricing()
returns table (
  booking_id uuid,
  original_amount_minor integer,
  discount_code_snapshot text,
  discount_percentage_snapshot integer,
  discount_amount_minor integer,
  final_amount_minor integer,
  currency text
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
    pricing.booking_id,
    pricing.original_amount_minor,
    pricing.discount_code_snapshot,
    pricing.discount_percentage_snapshot,
    pricing.discount_amount_minor,
    pricing.final_amount_minor,
    pricing.currency
  from private.booking_pricing as pricing;
end;
$$;

alter function public.get_admin_booking_pricing() owner to postgres;
revoke all on function public.get_admin_booking_pricing() from public, anon;
grant execute on function public.get_admin_booking_pricing()
  to authenticated, service_role;

comment on function public.get_admin_booking_pricing() is
  'Admin-only immutable booking pricing projection; excludes payment, customer, provider, recovery, and guard data.';

notify pgrst, 'reload schema';
