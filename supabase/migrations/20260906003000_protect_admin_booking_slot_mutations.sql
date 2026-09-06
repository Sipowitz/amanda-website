-- Browser roles may read through RLS, but all booking/slot mutations must use
-- the guarded RPCs. Preserve service_role privileges and postgres-owned writers.
revoke all on table public.bookings, public.availability_slots
  from public, anon, authenticated;
grant select on table public.bookings to authenticated;
grant select on table public.availability_slots to anon, authenticated;

drop policy "Admins can manage bookings" on public.bookings;
create policy "Admins can view bookings" on public.bookings
  for select to authenticated using (public.is_admin());

drop policy "Admins can manage slots" on public.availability_slots;
create policy "Admins can view slots" on public.availability_slots
  for select to authenticated using (public.is_admin());
-- The existing public future/available-slot SELECT policy remains in place.

-- SlotGenerator supplies date/time pairs only. IDs and availability are owned
-- by the server; generating an existing date/time never reopens or edits it.
create function public.create_availability_slots(p_slots jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
  inserted_count integer;
begin
  perform private.require_admin();
  if jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'Slot date/time pairs are required.';
  end if;
  for item in select value from jsonb_array_elements(p_slots)
  loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'Each slot must contain only a date and time.';
    end if;
    if (item - 'slot_date' - 'slot_time') <> '{}'::jsonb
      or jsonb_typeof(item -> 'slot_date') is distinct from 'string'
      or jsonb_typeof(item -> 'slot_time') is distinct from 'string'
      or (item ->> 'slot_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (item ->> 'slot_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    then raise exception 'Each slot must contain only a valid date and HH:MM time.';
    end if;
    if (item ->> 'slot_date')::date < current_date then
      raise exception 'New availability cannot be in the past.';
    end if;
  end loop;

  insert into public.availability_slots (slot_date, slot_time, is_available)
  select distinct (value ->> 'slot_date')::date, value ->> 'slot_time', true
  from jsonb_array_elements(p_slots)
  order by 1, 2
  on conflict (slot_date, slot_time) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Preserve all booking history, including cancelled/expired checkouts. Lock
-- the slot against reservation first; never acquire a booking lock in reverse
-- lifecycle order. The existing RESTRICT foreign key is a final concurrency
-- backstop if a referencing insertion is not visible to the ownership query.
create function public.delete_availability_slot(p_slot_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_slot_id is null then raise exception 'A slot is required.'; end if;
  perform 1 from public.availability_slots where id = p_slot_id for update;
  if not found then return false; end if;
  if exists (select 1 from public.bookings where slot_id = p_slot_id) then
    raise exception 'Slots with booking history cannot be deleted.';
  end if;
  delete from public.availability_slots where id = p_slot_id;
  return true;
end;
$$;

alter function public.create_availability_slots(jsonb) owner to postgres;
revoke all on function public.create_availability_slots(jsonb) from public, anon, authenticated;
grant execute on function public.create_availability_slots(jsonb) to authenticated, service_role;
alter function public.delete_availability_slot(uuid) owner to postgres;
revoke all on function public.delete_availability_slot(uuid) from public, anon, authenticated;
grant execute on function public.delete_availability_slot(uuid) to authenticated, service_role;
