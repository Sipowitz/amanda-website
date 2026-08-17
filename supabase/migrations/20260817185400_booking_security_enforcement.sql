-- Security hardening, phase 2: activate restrictive access.
--
-- This migration intentionally fails before changing permissions unless at
-- least one verified auth.users identity has been bootstrapped as an admin.
do $$
begin
  if not exists (
    select 1
    from public.admin_users as admin_user
    inner join auth.users as auth_user
      on auth_user.id = admin_user.user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'Bootstrap a verified auth.users UUID in public.admin_users before applying booking security enforcement.';
  end if;
end;
$$;

-- Preserve the live business logic as private implementations, then expose
-- guarded RPC wrappers under the original public names and signatures.
alter function public.cancel_booking(uuid) set schema private;
alter function public.update_booking_status(uuid, text) set schema private;
alter function public.update_booking_payment(uuid, text, numeric, numeric, text, text) set schema private;
alter function public.get_email_settings() set schema private;
alter function public.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean) set schema private;

revoke all on function private.cancel_booking(uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_booking_status(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.update_booking_payment(uuid, text, numeric, numeric, text, text) from public, anon, authenticated, service_role;
revoke all on function private.get_email_settings() from public, anon, authenticated, service_role;
revoke all on function private.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean) from public, anon, authenticated, service_role;

create function public.cancel_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.cancel_booking(p_booking_id);
end;
$$;

create function public.update_booking_status(p_booking_id uuid, p_status text)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.update_booking_status(p_booking_id, p_status);
end;
$$;

create function public.update_booking_payment(
  p_booking_id uuid,
  p_payment_status text,
  p_amount_due numeric,
  p_amount_paid numeric,
  p_payment_method text default null,
  p_payment_reference text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.update_booking_payment(
    p_booking_id,
    p_payment_status,
    p_amount_due,
    p_amount_paid,
    p_payment_method,
    p_payment_reference
  );
end;
$$;

create function public.get_email_settings()
returns public.email_settings
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.get_email_settings();
end;
$$;

create function public.update_email_settings(
  p_booking_reminders_enabled boolean,
  p_booking_reminder_hours_list integer[],
  p_send_admin_reminders boolean,
  p_send_window_start time without time zone,
  p_send_window_end time without time zone,
  p_timezone text,
  p_confirmed_bookings_only boolean,
  p_send_for_unpaid boolean,
  p_send_for_part_paid boolean,
  p_send_for_paid boolean
)
returns public.email_settings
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.update_email_settings(
    p_booking_reminders_enabled,
    p_booking_reminder_hours_list,
    p_send_admin_reminders,
    p_send_window_start,
    p_send_window_end,
    p_timezone,
    p_confirmed_bookings_only,
    p_send_for_unpaid,
    p_send_for_part_paid,
    p_send_for_paid
  );
end;
$$;

alter function public.cancel_booking(uuid) owner to postgres;
alter function public.update_booking_status(uuid, text) owner to postgres;
alter function public.update_booking_payment(uuid, text, numeric, numeric, text, text) owner to postgres;
alter function public.get_email_settings() owner to postgres;
alter function public.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean) owner to postgres;

revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.update_booking_status(uuid, text) from public, anon;
revoke all on function public.update_booking_payment(uuid, text, numeric, numeric, text, text) from public, anon;
revoke all on function public.get_email_settings() from public, anon;
revoke all on function public.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean) from public, anon;

grant execute on function public.cancel_booking(uuid) to authenticated, service_role;
grant execute on function public.update_booking_status(uuid, text) to authenticated, service_role;
grant execute on function public.update_booking_payment(uuid, text, numeric, numeric, text, text) to authenticated, service_role;
grant execute on function public.get_email_settings() to authenticated, service_role;
grant execute on function public.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean) to authenticated, service_role;

-- Public booking creation remains the sole customer booking write path.
revoke all on function public.create_booking_request(uuid, text, text, text, text) from public;
grant execute on function public.create_booking_request(uuid, text, text, text, text)
  to anon, authenticated, service_role;

-- Queue operations and reminder scheduling are backend-only. The functions
-- remain callable by their postgres owner, including nested RPC calls and cron.
revoke all on function public.queue_booking_email(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.queue_booking_email(uuid, text, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.queue_due_booking_reminders()
  from public, anon, authenticated;
grant execute on function public.queue_booking_email(uuid, text, text, text, jsonb)
  to service_role;
grant execute on function public.queue_booking_email(uuid, text, text, text, jsonb, text)
  to service_role;
grant execute on function public.queue_due_booking_reminders()
  to service_role;

-- Prevent direct browser access inherited either explicitly or through
-- PostgreSQL's PUBLIC pseudo-role. The email processor needs only read and
-- archive. Postgres remains the wrapper owner and can still call send from
-- postgres-owned booking functions without an explicit grant.
revoke usage on schema pgmq_public from anon, authenticated;

revoke all on function pgmq_public.archive(text, bigint) from public, anon, authenticated, service_role;
revoke all on function pgmq_public.delete(text, bigint) from public, anon, authenticated, service_role;
revoke all on function pgmq_public.pop(text) from public, anon, authenticated, service_role;
revoke all on function pgmq_public.read(text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function pgmq_public.send(text, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function pgmq_public.send_batch(text, jsonb[], integer) from public, anon, authenticated, service_role;

grant usage on schema pgmq_public to service_role;
grant execute on function pgmq_public.archive(text, bigint) to service_role;
grant execute on function pgmq_public.read(text, integer, integer) to service_role;
-- Replace permissive booking and availability policies with allowlist checks.
drop policy if exists "Public can create bookings" on public.bookings;
drop policy if exists "Authenticated users can manage bookings" on public.bookings;
create policy "Admins can manage bookings"
on public.bookings
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Public can view slots" on public.availability_slots;
drop policy if exists "Authenticated users can manage slots" on public.availability_slots;
create policy "Public can view future available slots"
on public.availability_slots
for select
to anon, authenticated
using (slot_date >= current_date and is_available is true);

-- TODO(service/booking redesign): slot_time is currently text, so this
-- date-only policy does not exclude elapsed times on the current date. Move to
-- typed date/time handling with an explicit business timezone separately.
create policy "Admins can manage slots"
on public.availability_slots
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Table grants work together with RLS: authenticated users have privileges,
-- but only allowlisted admins satisfy the management policies.
revoke all on table public.bookings from anon, authenticated;
grant all on table public.bookings to authenticated, service_role;

revoke all on table public.availability_slots from anon, authenticated;
grant select on table public.availability_slots to anon;
grant all on table public.availability_slots to authenticated, service_role;

revoke all on table public.booking_email_config from anon, authenticated;
revoke all on table public.booking_email_log from anon, authenticated;
revoke all on table public.email_settings from anon, authenticated;
grant all on table public.booking_email_config to service_role;
grant all on table public.booking_email_log to service_role;
grant all on table public.email_settings to service_role;
