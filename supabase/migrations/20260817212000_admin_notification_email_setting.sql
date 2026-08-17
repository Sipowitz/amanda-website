-- Expose the existing database-authoritative admin booking recipient through
-- the protected email-settings RPCs. Sender and reply-to addresses remain
-- Edge Function secrets and are intentionally unrelated to this setting.

update public.booking_email_config
set
  admin_email = btrim(admin_email),
  updated_at = now()
where id = true;

alter table public.booking_email_config
  add constraint booking_email_config_admin_email_check
  check (
    length(admin_email) <= 254
    and admin_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

-- Return the protected reminder settings and admin recipient as one JSON
-- object. The existing field names remain unchanged for older admin clients.
drop function public.get_email_settings();

create function public.get_email_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_settings public.email_settings%rowtype;
  current_email_config public.booking_email_config%rowtype;
begin
  perform private.require_admin();

  current_settings := private.get_email_settings();

  select *
  into current_email_config
  from public.booking_email_config
  where id = true;

  if not found then
    raise exception 'Booking email configuration has not been created.';
  end if;

  return to_jsonb(current_settings)
    || jsonb_build_object(
      'admin_notification_email', current_email_config.admin_email
    );
end;
$$;

alter function public.get_email_settings() owner to postgres;
revoke all on function public.get_email_settings()
  from public, anon, authenticated, service_role;
grant execute on function public.get_email_settings()
  to authenticated, service_role;

-- Add an admin-email-aware settings overload that updates reminder settings and
-- the existing booking_email_config row atomically. The deployed ten-argument
-- overload remains available for stale admin assets and deliberately leaves
-- admin_email unchanged.
create function private.update_email_settings(
  p_booking_reminders_enabled boolean,
  p_booking_reminder_hours_list integer[],
  p_send_admin_reminders boolean,
  p_send_window_start time without time zone,
  p_send_window_end time without time zone,
  p_timezone text,
  p_confirmed_bookings_only boolean,
  p_send_for_unpaid boolean,
  p_send_for_part_paid boolean,
  p_send_for_paid boolean,
  p_admin_notification_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_settings public.email_settings%rowtype;
  cleaned_admin_notification_email text;
begin
  cleaned_admin_notification_email := nullif(
    btrim(p_admin_notification_email),
    ''
  );

  if cleaned_admin_notification_email is null then
    raise exception 'An admin notification email is required.';
  end if;

  if length(cleaned_admin_notification_email) > 254
    or cleaned_admin_notification_email
      !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Enter a valid admin notification email address.';
  end if;

  updated_settings := private.update_email_settings(
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

  update public.booking_email_config
  set
    admin_email = cleaned_admin_notification_email,
    updated_at = now()
  where id = true;

  if not found then
    raise exception 'Booking email configuration has not been created.';
  end if;

  return to_jsonb(updated_settings)
    || jsonb_build_object(
      'admin_notification_email', cleaned_admin_notification_email
    );
end;
$$;

alter function private.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean, text)
  owner to postgres;
revoke all on function private.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean, text)
  from public, anon, authenticated, service_role;

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
  p_send_for_paid boolean,
  p_admin_notification_email text
)
returns jsonb
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
    p_send_for_paid,
    p_admin_notification_email
  );
end;
$$;

alter function public.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean, text)
  owner to postgres;
revoke all on function public.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_email_settings(boolean, integer[], boolean, time without time zone, time without time zone, text, boolean, boolean, boolean, boolean, text)
  to authenticated, service_role;

comment on column public.booking_email_config.admin_email is
  'Database-authoritative recipient for admin booking notifications and admin reminders.';
