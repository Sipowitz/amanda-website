-- A browser may retain a cleanup marker after its server-side cleanup
-- authority has been retired.  Return a narrowly scoped terminal code for
-- already-terminal/missing records; active or payment-protected checkouts
-- continue to return the existing retry response.

-- Retain only the hash of issued cleanup authority long enough for a browser
-- marker to self-heal after the live lease row is retired.  This table has no
-- browser grants and deliberately has no cascading foreign keys: its purpose
-- is to survive removal of the live booking/attempt authority.
create table if not exists private.timed_checkout_cleanup_tombstone (
  booking_id uuid not null,
  attempt_id uuid not null,
  capability_hash bytea not null,
  issued_at timestamptz not null default clock_timestamp(),
  retained_until timestamptz not null,
  invalidated_at timestamptz,
  cleaned_at timestamptz,
  primary key (booking_id, attempt_id)
);
alter table private.timed_checkout_cleanup_tombstone owner to postgres;
revoke all on table private.timed_checkout_cleanup_tombstone from public, anon, authenticated, service_role;

-- Extend the existing issuance path so every legitimate marker has a bounded
-- retained hash, without changing the raw capability contract.
create or replace function public.renew_timed_checkout_lease(
  p_booking_id uuid, p_payment_access_token text, p_attempt_id uuid,
  p_cleanup_capability text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  attempt private.payment_attempts%rowtype;
  capability private.timed_checkout_cleanup%rowtype;
  secret text;
  grace integer;
  deadline timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if not found or not exists (select 1 from private.booking_payment_access a where a.booking_id = p_booking_id
    and a.token_hash = extensions.digest(p_payment_access_token, 'sha256')) then raise exception 'Payment access is invalid.'; end if;
  select * into attempt from private.payment_attempts where id = p_attempt_id and booking_id = p_booking_id for update;
  if not found or booking.service_booking_mode_snapshot is distinct from 'timed'
    or booking.service_payment_flow_snapshot is distinct from 'direct_payment'
    or booking.status is distinct from 'pending_payment' or booking.payment_status is distinct from 'unpaid'
    or booking.amount_paid is distinct from 0 or booking.paid_at is not null or attempt.status is distinct from 'reserved'
    or attempt.submitted_at is not null or attempt.provider_payment_id is not null or attempt.provider_status is not null
    or attempt.completed_at is not null or exists (select 1 from private.payment_attempts a where a.booking_id = p_booking_id
      and a.id <> p_attempt_id and (a.status in ('reserved','processing','unknown','completed') or a.completed_at is not null
        or a.provider_status = 'COMPLETED' or (a.created_at,a.id) > (attempt.created_at,attempt.id)))
  then raise exception 'Checkout lease cannot be renewed.'; end if;
  deadline := attempt.created_at + interval '1 hour';
  if deadline <= clock_timestamp() then raise exception 'Checkout lease cannot be renewed.'; end if;
  select grace_seconds into strict grace from private.timed_checkout_cleanup_policy where id;
  select * into capability from private.timed_checkout_cleanup where attempt_id = p_attempt_id;
  if found and capability.invalidated_at is not null then raise exception 'Checkout lease cannot be renewed.'; end if;
  if capability.capability_hash = extensions.digest(p_cleanup_capability, 'sha256') then secret := p_cleanup_capability;
  else secret := encode(extensions.gen_random_bytes(32), 'hex'); end if;
  insert into private.timed_checkout_cleanup(attempt_id, booking_id, capability_hash, lease_until, expires_at)
    values (p_attempt_id, p_booking_id, extensions.digest(secret, 'sha256'),
      least(deadline, clock_timestamp() + make_interval(secs => grace)), deadline)
  on conflict (attempt_id) do update set capability_hash = excluded.capability_hash,
    lease_until = excluded.lease_until, expires_at = excluded.expires_at;
  insert into private.timed_checkout_cleanup_tombstone(booking_id, attempt_id, capability_hash, retained_until)
    values (p_booking_id, p_attempt_id, extensions.digest(secret, 'sha256'), deadline + interval '14 days')
  on conflict (booking_id, attempt_id) do update set capability_hash = excluded.capability_hash,
    retained_until = excluded.retained_until, invalidated_at = null, cleaned_at = null;
  return jsonb_build_object('cleanupCapability', secret, 'expiresAt', deadline,
    'renewAfterSeconds', greatest(15, grace / 3));
end;
$$;
alter function public.renew_timed_checkout_lease(uuid, text, uuid, text) owner to postgres;
revoke all on function public.renew_timed_checkout_lease(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.renew_timed_checkout_lease(uuid, text, uuid, text) to service_role;

create or replace function public.cleanup_timed_checkout(
  p_booking_id uuid,
  p_attempt_id uuid,
  p_cleanup_capability text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  attempt private.payment_attempts%rowtype;
  capability private.timed_checkout_cleanup%rowtype;
  tombstone private.timed_checkout_cleanup_tombstone%rowtype;
  slot public.availability_slots%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service-role access is required.';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  select * into attempt from private.payment_attempts
    where id = p_attempt_id and booking_id = p_booking_id for update;
  select * into capability from private.timed_checkout_cleanup
    where attempt_id = p_attempt_id and booking_id = p_booking_id;
  select * into tombstone from private.timed_checkout_cleanup_tombstone
    where attempt_id = p_attempt_id and booking_id = p_booking_id
      and capability_hash = extensions.digest(p_cleanup_capability, 'sha256')
      and retained_until > clock_timestamp();

  -- There is no active cleanup authority to exercise.  This terminal error is
  -- intentionally emitted only for records that cannot represent a live
  -- unsubmitted checkout.  The Edge Function exposes only { stale: true }.
  -- An active reserved attempt with a missing/incorrect capability remains a
  -- generic false response, preserving cross-checkout isolation.
  if capability.attempt_id is null and tombstone.attempt_id is not null
    and (booking.id is null or attempt.id is null
      or booking.status in ('cancelled', 'payment_expired', 'completed', 'no_show', 'confirmed')
      or attempt.status in ('failed', 'cancelled', 'expired'))
    and not exists (select 1 from private.payment_attempts a where a.booking_id = p_booking_id
      and a.id <> p_attempt_id and a.status in ('reserved','processing','unknown','completed'))
    and (attempt.id is null or (attempt.submitted_at is null and attempt.provider_payment_id is null
      and attempt.provider_location_id is null and attempt.provider_status is null and attempt.completed_at is null)) then
    raise exception using
      errcode = 'P0002',
      message = 'Checkout cleanup authority is unavailable.';
  end if;

  if booking.id is null or attempt.id is null or capability.attempt_id is null
    or capability.capability_hash is distinct from extensions.digest(p_cleanup_capability, 'sha256')
    or capability.invalidated_at is not null
    or booking.service_booking_mode_snapshot is distinct from 'timed'
    or booking.service_payment_flow_snapshot is distinct from 'direct_payment'
    or booking.payment_status is distinct from 'unpaid' or booking.amount_paid is distinct from 0
    or booking.paid_at is not null or booking.payment_reference is not null
    or attempt.submitted_at is not null or attempt.provider_payment_id is not null
    or attempt.provider_location_id is not null or attempt.provider_status is not null
    or attempt.completed_at is not null
    or exists (select 1 from private.payment_attempts a where a.booking_id = p_booking_id
      and a.id <> p_attempt_id and (a.status in ('reserved','processing','unknown','completed')
        or a.completed_at is not null or a.provider_status = 'COMPLETED'
        or (a.created_at,a.id) > (attempt.created_at,attempt.id)
        or (a.submitted_at is not null and
          (a.status = 'failed' and a.provider_status in ('FAILED','CANCELED')) is not true)))
  then return false; end if;

  if (booking.status = 'cancelled' and attempt.status = 'cancelled'
        and (capability.cleaned_at is not null or booking.cancelled_at is not null))
    or (booking.status = 'payment_expired' and attempt.status = 'expired'
        and attempt.expired_at is not null)
  then return true; end if;
  if booking.status is distinct from 'pending_payment' or attempt.status is distinct from 'reserved'
    or capability.expires_at <= clock_timestamp() or capability.lease_until > clock_timestamp()
  then return false; end if;

  select * into slot from public.availability_slots where id = booking.slot_id for update;
  if not found or slot.is_available is distinct from false or exists (
    select 1 from public.bookings b where b.slot_id = booking.slot_id and b.id <> booking.id
      and b.status in ('pending','pending_payment','confirmed','completed','no_show')
  ) then return false; end if;
  update private.payment_attempts set status = 'cancelled', checkout_abandoned_at = clock_timestamp(),
    updated_at = clock_timestamp() where id = p_attempt_id;
  update public.bookings set status = 'cancelled', cancelled_at = clock_timestamp(),
    updated_at = clock_timestamp() where id = p_booking_id;
  update public.availability_slots set is_available = true where id = slot.id;
  update private.timed_checkout_cleanup set cleaned_at = clock_timestamp() where attempt_id = p_attempt_id;
  update private.timed_checkout_cleanup_tombstone set cleaned_at = clock_timestamp()
    where booking_id = p_booking_id and attempt_id = p_attempt_id;
  return true;
end;
$$;

alter function public.cleanup_timed_checkout(uuid, uuid, text) owner to postgres;
revoke all on function public.cleanup_timed_checkout(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cleanup_timed_checkout(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
