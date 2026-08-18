-- Remove expired, unbooked availability without deleting booking history.
-- bookings.slot_id currently uses ON DELETE CASCADE, so referenced slots must
-- remain in place unless that relationship is redesigned in a separate change.

create function private.delete_past_availability_slots()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.availability_slots as slot
  where slot.slot_date < current_date
    and not exists (
      select 1
      from public.bookings as booking
      where booking.slot_id = slot.id
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter function private.delete_past_availability_slots() owner to postgres;
revoke all on function private.delete_past_availability_slots()
  from public, anon, authenticated, service_role;

create function public.delete_past_availability_slots()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.delete_past_availability_slots();
end;
$$;

alter function public.delete_past_availability_slots() owner to postgres;
revoke all on function public.delete_past_availability_slots()
  from public, anon, authenticated;
grant execute on function public.delete_past_availability_slots()
  to authenticated, service_role;

comment on function private.delete_past_availability_slots() is
  'Deletes past availability slots only when no booking references them.';
comment on function public.delete_past_availability_slots() is
  'Admin-guarded cleanup of unreferenced availability slots before the current database date.';

-- pg_cron is already installed by the booking backend baseline migration.
-- Scheduling by name replaces the existing named job if this migration is
-- replayed, and the cleanup itself is idempotent.
select cron.schedule(
  'delete-past-availability-slots-daily',
  '15 3 * * *',
  $cron$select private.delete_past_availability_slots();$cron$
);
