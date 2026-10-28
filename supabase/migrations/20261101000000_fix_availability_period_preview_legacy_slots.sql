-- Preview must include desired starts that are currently represented by legacy
-- inventory.  Before cutover, reconciliation deliberately preserves a legacy
-- row on an exact timestamp conflict; filtering the preview to period-source
-- rows therefore hid every such appointment.

create or replace function public.preview_availability_period_batch(p_periods jsonb, p_exclude_period_id uuid)
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
        'slot_date', desired.slot_date,
        'slot_time', desired.slot_time,
        'starts_at', desired.starts_at,
        'is_available', coalesce(slot.is_available, false),
        'already_existed', slot.id is not null and slot.id = any(initial_slot_ids),
        'has_booking', slot.id is not null and exists(
          select 1 from public.bookings booking where booking.slot_id = slot.id
        )
      ) order by desired.starts_at), '[]'::jsonb)
    ) into preview
    from (
      select distinct slot_date, slot_time, starts_at
      from private.desired_availability_period_slots()
      where skipped_dst is false
    ) desired
    left join public.availability_slots slot
      on slot.slot_date = desired.slot_date
      and slot.slot_time = desired.slot_time
      and slot.starts_at = desired.starts_at;
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

alter function public.preview_availability_period_batch(jsonb, uuid) owner to postgres;
revoke all on function public.preview_availability_period_batch(jsonb, uuid) from public, anon;
grant execute on function public.preview_availability_period_batch(jsonb, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
