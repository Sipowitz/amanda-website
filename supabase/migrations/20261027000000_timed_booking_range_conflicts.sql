-- Phase 1: retain the existing slot inventory, but make the appointment
-- interval an immutable booking snapshot and protect active timed bookings
-- from temporal overlap.  Slot IDs, payment state, and historical rows are
-- deliberately preserved.

alter table public.bookings
  add column if not exists appointment_starts_at timestamptz,
  add column if not exists appointment_ends_at timestamptz;

alter table public.bookings
  add constraint bookings_appointment_interval_check
  check (
    (appointment_starts_at is null and appointment_ends_at is null)
    or (
      appointment_starts_at is not null
      and appointment_ends_at is not null
      and appointment_starts_at < appointment_ends_at
    )
  ) not valid;

-- Backfill only timed bookings for which both components are already
-- authoritative: the retained slot instant and immutable duration snapshot.
-- Untimed or incomplete historical records deliberately remain NULL.
update public.bookings as booking
set appointment_starts_at = slot.starts_at,
    appointment_ends_at = slot.starts_at
      + make_interval(mins => booking.service_duration_minutes_snapshot)
from public.availability_slots as slot
where slot.id = booking.slot_id
  and booking.service_booking_mode_snapshot = 'timed'
  and booking.service_duration_minutes_snapshot > 0
  and booking.appointment_starts_at is null
  and booking.appointment_ends_at is null;

-- Do not add a constraint that could silently leave an active timed booking
-- outside its range protection.  Deployment must stop for manual review if a
-- live booking cannot be reconstructed from authoritative snapshots.
do $$
declare
  incomplete_count integer;
  conflict_pairs text;
begin
  select count(*) into incomplete_count
  from public.bookings as booking
  where booking.status in ('pending', 'pending_payment', 'confirmed', 'completed', 'no_show')
    and booking.service_booking_mode_snapshot = 'timed'
    and (
      booking.slot_id is null
      or booking.service_duration_minutes_snapshot is null
      or booking.service_duration_minutes_snapshot <= 0
      or booking.appointment_starts_at is null
      or booking.appointment_ends_at is null
    );

  if incomplete_count > 0 then
    raise exception using
      message = 'Timed booking interval backfill is incomplete.',
      detail = format('%s active timed booking(s) lack an authoritative slot instant or duration snapshot.', incomplete_count),
      hint = 'Repair or classify those bookings before deploying temporal overlap protection.';
  end if;

  select string_agg(format('%s/%s', left(first_booking::text, 8), left(second_booking::text, 8)), ', ')
  into conflict_pairs
  from (
    select first_booking.id, second_booking.id
    from public.bookings as first_booking
    join public.bookings as second_booking
      on first_booking.id < second_booking.id
     and tstzrange(first_booking.appointment_starts_at, first_booking.appointment_ends_at, '[)')
         && tstzrange(second_booking.appointment_starts_at, second_booking.appointment_ends_at, '[)')
    where first_booking.status in ('pending', 'pending_payment', 'confirmed', 'completed', 'no_show')
      and second_booking.status in ('pending', 'pending_payment', 'confirmed', 'completed', 'no_show')
      and first_booking.service_booking_mode_snapshot = 'timed'
      and second_booking.service_booking_mode_snapshot = 'timed'
  ) as conflicts(first_booking, second_booking);

  if conflict_pairs is not null then
    raise exception using
      message = 'Existing active timed bookings overlap.',
      detail = format('Conflicting booking ID pairs: %s', conflict_pairs),
      hint = 'Review these bookings manually; this migration will not alter appointments or payment state.';
  end if;
end;
$$;

alter table public.bookings
  validate constraint bookings_appointment_interval_check;

-- Every insert path (legacy, direct payment, discounted direct payment, and
-- future admin paths) receives the same server-derived immutable interval.
-- Once created, neither the source snapshot nor the derived interval can be
-- changed by a later lifecycle update.
create function private.maintain_booking_appointment_interval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  slot_start timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.slot_id is distinct from old.slot_id
      or new.service_booking_mode_snapshot is distinct from old.service_booking_mode_snapshot
      or new.service_duration_minutes_snapshot is distinct from old.service_duration_minutes_snapshot
      or new.appointment_starts_at is distinct from old.appointment_starts_at
      or new.appointment_ends_at is distinct from old.appointment_ends_at
    then
      raise exception 'Booking appointment snapshots are immutable.';
    end if;
    return new;
  end if;

  if new.service_booking_mode_snapshot = 'timed' then
    if new.slot_id is null then
      raise exception 'Timed bookings must reference an appointment slot.';
    end if;
    if new.service_duration_minutes_snapshot is null
      or new.service_duration_minutes_snapshot <= 0
    then
      raise exception 'Timed bookings must include a positive duration snapshot.';
    end if;

    select slot.starts_at into slot_start
    from public.availability_slots as slot
    where slot.id = new.slot_id
    for update;

    if not found or slot_start is null then
      raise exception 'The appointment slot no longer has an authoritative start time.';
    end if;

    new.appointment_starts_at := slot_start;
    new.appointment_ends_at := slot_start
      + make_interval(mins => new.service_duration_minutes_snapshot);
  else
    new.appointment_starts_at := null;
    new.appointment_ends_at := null;
  end if;
  return new;
end;
$$;

alter function private.maintain_booking_appointment_interval() owner to postgres;
revoke all on function private.maintain_booking_appointment_interval()
  from public, anon, authenticated, service_role;

drop trigger if exists bookings_maintain_appointment_interval on public.bookings;
create trigger bookings_maintain_appointment_interval
before insert or update
on public.bookings
for each row
execute function private.maintain_booking_appointment_interval();

alter table public.bookings
  add constraint bookings_no_overlapping_active_timed_appointments
  exclude using gist (
    tstzrange(appointment_starts_at, appointment_ends_at, '[)') with &&
  )
  where (
    service_booking_mode_snapshot = 'timed'
    and status in ('pending', 'pending_payment', 'confirmed', 'completed', 'no_show')
  );

comment on column public.bookings.appointment_starts_at is
  'Immutable, server-derived appointment start for timed bookings; NULL for untimed/incomplete historical rows.';
comment on column public.bookings.appointment_ends_at is
  'Immutable, server-derived appointment end from the booking duration snapshot; NULL for untimed/incomplete historical rows.';
comment on constraint bookings_no_overlapping_active_timed_appointments on public.bookings is
  'Prevents overlapping active timed appointment intervals using inclusive-start/exclusive-end semantics.';

notify pgrst, 'reload schema';
