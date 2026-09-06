-- Cleanup authority is distinct from payment recovery authority. No raw token
-- is retained server-side and no client has direct access to these tables.
create table private.timed_checkout_cleanup_policy (
  id boolean primary key default true check (id),
  grace_seconds integer not null default 180 check (grace_seconds between 120 and 300)
);
insert into private.timed_checkout_cleanup_policy(id) values (true);
create table private.timed_checkout_cleanup (
  attempt_id uuid primary key references private.payment_attempts(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  capability_hash bytea not null,
  lease_until timestamptz not null,
  expires_at timestamptz not null,
  invalidated_at timestamptz,
  cleaned_at timestamptz
);
alter table private.timed_checkout_cleanup_policy owner to postgres;
alter table private.timed_checkout_cleanup owner to postgres;
revoke all on table private.timed_checkout_cleanup_policy, private.timed_checkout_cleanup
  from public, anon, authenticated, service_role;

-- Existing creation/retry paths already own this booking lock. Taking it here
-- also makes invalidation atomic with insertion of the exact new generation.
create function private.invalidate_timed_checkout_cleanup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.bookings where id = new.booking_id for update;
  update private.timed_checkout_cleanup set invalidated_at = clock_timestamp()
  where booking_id = new.booking_id and attempt_id <> new.id and invalidated_at is null;
  return new;
end;
$$;
create trigger invalidate_timed_checkout_cleanup before insert on private.payment_attempts
  for each row execute function private.invalidate_timed_checkout_cleanup();

-- Only the existing session-scoped recovery credential may issue/renew.
create function public.renew_timed_checkout_lease(
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
  if not found or not exists (
    select 1 from private.booking_payment_access a where a.booking_id = p_booking_id
      and a.token_hash = extensions.digest(p_payment_access_token, 'sha256')
  ) then raise exception 'Payment access is invalid.'; end if;
  select * into attempt from private.payment_attempts
    where id = p_attempt_id and booking_id = p_booking_id for update;
  if not found or booking.service_booking_mode_snapshot is distinct from 'timed'
    or booking.service_payment_flow_snapshot is distinct from 'direct_payment'
    or booking.status is distinct from 'pending_payment'
    or booking.payment_status is distinct from 'unpaid' or booking.amount_paid is distinct from 0
    or booking.paid_at is not null or attempt.status is distinct from 'reserved'
    or attempt.submitted_at is not null or attempt.provider_payment_id is not null
    or attempt.provider_status is not null or attempt.completed_at is not null
    or exists (select 1 from private.payment_attempts a where a.booking_id = p_booking_id
      and a.id <> p_attempt_id and (a.status in ('reserved','processing','unknown','completed')
        or a.completed_at is not null or a.provider_status = 'COMPLETED'
        or (a.created_at,a.id) > (attempt.created_at,attempt.id)))
  then raise exception 'Checkout lease cannot be renewed.'; end if;
  deadline := attempt.created_at + interval '1 hour';
  if deadline <= clock_timestamp() then raise exception 'Checkout lease cannot be renewed.'; end if;
  select grace_seconds into strict grace from private.timed_checkout_cleanup_policy where id;
  select * into capability from private.timed_checkout_cleanup where attempt_id = p_attempt_id;
  if found and capability.invalidated_at is not null then raise exception 'Checkout lease cannot be renewed.'; end if;
  if capability.capability_hash = extensions.digest(p_cleanup_capability, 'sha256') then
    secret := p_cleanup_capability;
  else
    secret := encode(extensions.gen_random_bytes(32), 'hex');
  end if;
  insert into private.timed_checkout_cleanup(attempt_id, booking_id, capability_hash, lease_until, expires_at)
    values (p_attempt_id, p_booking_id, extensions.digest(secret, 'sha256'),
      least(deadline, clock_timestamp() + make_interval(secs => grace)), deadline)
  on conflict (attempt_id) do update set capability_hash = excluded.capability_hash,
    lease_until = excluded.lease_until, expires_at = excluded.expires_at;
  return jsonb_build_object('cleanupCapability', secret, 'expiresAt', deadline,
    'renewAfterSeconds', greatest(15, grace / 3));
end;
$$;

-- The only capability-authorized operation: safe terminal abandonment. All
-- refusals have the same response at the Edge; no status or PII is returned.
create function public.cleanup_timed_checkout(
  p_booking_id uuid, p_attempt_id uuid, p_cleanup_capability text
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  attempt private.payment_attempts%rowtype;
  capability private.timed_checkout_cleanup%rowtype;
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

  -- Receipts authorize no further mutation, even after capability expiry.
  -- A sweep or authenticated/manual cancellation may already have released it.
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
  return true;
end;
$$;

alter function private.invalidate_timed_checkout_cleanup() owner to postgres;
revoke all on function private.invalidate_timed_checkout_cleanup() from public, anon, authenticated, service_role;
alter function public.renew_timed_checkout_lease(uuid,text,uuid,text) owner to postgres;
revoke all on function public.renew_timed_checkout_lease(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.renew_timed_checkout_lease(uuid,text,uuid,text) to service_role;
alter function public.cleanup_timed_checkout(uuid,uuid,text) owner to postgres;
revoke all on function public.cleanup_timed_checkout(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.cleanup_timed_checkout(uuid,uuid,text) to service_role;
