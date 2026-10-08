-- Keep catalogue ordering independent for the two immutable booking modes.
-- The existing table lock continues to serialize all catalogue moves.

create or replace function public.move_admin_service(p_service_id uuid, p_direction text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  selected_mode text;
  service_ids uuid[];
  current_index integer;
  target_index integer;
  index integer;
begin
  perform private.require_admin();
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception 'Direction must be up or down.';
  end if;

  lock table public.services in share row exclusive mode;
  select booking_mode into selected_mode
  from public.services
  where id = p_service_id;
  if not found then raise exception 'The service does not exist.'; end if;

  select array_agg(id order by display_order, name, id) into service_ids
  from public.services
  where booking_mode = selected_mode;
  current_index := array_position(service_ids, p_service_id);
  target_index := current_index + case when p_direction = 'up' then -1 else 1 end;
  if target_index < 1 or target_index > cardinality(service_ids) then return false; end if;

  service_ids[current_index] := service_ids[target_index];
  service_ids[target_index] := p_service_id;
  for index in 1..cardinality(service_ids) loop
    update public.services set display_order = index * 10, updated_at = now()
    where id = service_ids[index];
  end loop;
  return true;
end;
$$;

alter function public.move_admin_service(uuid,text) owner to postgres;
revoke all on function public.move_admin_service(uuid,text) from public, anon;
grant execute on function public.move_admin_service(uuid,text) to authenticated, service_role;

notify pgrst, 'reload schema';
