-- Update the live catalogue price for new Wheel of the Year bookings only.
-- Existing booking snapshot values are intentionally left unchanged.
do $$
begin
  update public.services
  set
    price_amount = 6000,
    updated_at = now()
  where slug = 'wheel-of-the-year';

  if not found then
    raise exception
      'Expected service with slug wheel-of-the-year was not found.';
  end if;
end;
$$;
