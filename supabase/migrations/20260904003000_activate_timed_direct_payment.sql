-- Activate timed Square direct payment only for these two catalogue services.
-- Lock and validate both rows before changing either; exceptions roll back the block.
do $$
declare
  expected_service record;
  selected_service public.services%rowtype;
  updated_count integer;
begin
  for expected_service in
    select * from (values
      ('private-readings', 8500),
      ('wheel-of-the-year', 6000)
    ) as expected(slug, price_amount)
    order by slug
  loop
    select * into selected_service
    from public.services
    where slug = expected_service.slug
    for update;

    if not found then
      raise exception 'Expected service % was not found.', expected_service.slug;
    end if;

    if selected_service.booking_mode is distinct from 'timed'
      or selected_service.payment_required is distinct from true
      or selected_service.price_amount is distinct from expected_service.price_amount
      or selected_service.currency is distinct from 'USD'
      or selected_service.payment_flow is distinct from 'payment_link'
    then
      raise exception
        'Service % must be timed, require payment, cost % USD cents, and use payment_link.',
        expected_service.slug, expected_service.price_amount;
    end if;
  end loop;

  update public.services
  set payment_flow = 'direct_payment'
  where slug in ('private-readings', 'wheel-of-the-year');

  get diagnostics updated_count = row_count;
  if updated_count <> 2 then
    raise exception 'Expected exactly 2 updated services, got %.', updated_count;
  end if;
end;
$$;
