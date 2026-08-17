-- Booking backend baseline captured from the live project on 2026-08-17.
-- Schema only: no customer, booking, email-log, queue-message, auth-user,
-- or secret data is included.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "pgmq_public";


ALTER SCHEMA "pgmq_public" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgmq" VERSION '1.5.1';

-- Recreate only the durable, logged, non-partitioned queue metadata. Existing
-- queue/archive tables and messages are intentionally not copied.
DO $$
begin
  if not exists (
    select 1
    from pgmq.meta
    where queue_name = 'booking_emails'
  ) then
    perform pgmq.create('booking_emails');
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "pgmq_public"."archive"("queue_name" "text", "message_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
  begin
      return
      pgmq.archive(
          queue_name := queue_name,
          msg_id := message_id
      );
  end;
  $$;


ALTER FUNCTION "pgmq_public"."archive"("queue_name" "text", "message_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "pgmq_public"."archive"("queue_name" "text", "message_id" bigint) IS 'Archives a message by moving it from the queue to a permanent archive.';



CREATE OR REPLACE FUNCTION "pgmq_public"."delete"("queue_name" "text", "message_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
  begin
      return
      pgmq.delete(
          queue_name := queue_name,
          msg_id := message_id
      );
  end;
  $$;


ALTER FUNCTION "pgmq_public"."delete"("queue_name" "text", "message_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "pgmq_public"."delete"("queue_name" "text", "message_id" bigint) IS 'Permanently deletes a message from the specified queue.';



CREATE OR REPLACE FUNCTION "pgmq_public"."pop"("queue_name" "text") RETURNS SETOF "pgmq"."message_record"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
  begin
      return query
      select *
      from pgmq.pop(
          queue_name := queue_name
      );
  end;
  $$;


ALTER FUNCTION "pgmq_public"."pop"("queue_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "pgmq_public"."pop"("queue_name" "text") IS 'Retrieves and locks the next message from the specified queue.';



CREATE OR REPLACE FUNCTION "pgmq_public"."read"("queue_name" "text", "sleep_seconds" integer, "n" integer) RETURNS SETOF "pgmq"."message_record"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
  begin
      return query
      select *
      from pgmq.read(
          queue_name := queue_name,
          vt := sleep_seconds,
          qty := n , conditional := '{}'::jsonb
      );
  end;
  $$;


ALTER FUNCTION "pgmq_public"."read"("queue_name" "text", "sleep_seconds" integer, "n" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "pgmq_public"."read"("queue_name" "text", "sleep_seconds" integer, "n" integer) IS 'Reads up to "n" messages from the specified queue with an optional "sleep_seconds" (visibility timeout).';



CREATE OR REPLACE FUNCTION "pgmq_public"."send"("queue_name" "text", "message" "jsonb", "sleep_seconds" integer DEFAULT 0) RETURNS SETOF bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
  begin
      return query
      select *
      from pgmq.send(
          queue_name := queue_name,
          msg := message,
          delay := sleep_seconds
      );
  end;
  $$;


ALTER FUNCTION "pgmq_public"."send"("queue_name" "text", "message" "jsonb", "sleep_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "pgmq_public"."send"("queue_name" "text", "message" "jsonb", "sleep_seconds" integer) IS 'Sends a message to the specified queue, optionally delaying its availability by a number of seconds.';



CREATE OR REPLACE FUNCTION "pgmq_public"."send_batch"("queue_name" "text", "messages" "jsonb"[], "sleep_seconds" integer DEFAULT 0) RETURNS SETOF bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
  begin
      return query
      select *
      from pgmq.send_batch(
          queue_name := queue_name,
          msgs := messages,
          delay := sleep_seconds
      );
  end;
  $$;


ALTER FUNCTION "pgmq_public"."send_batch"("queue_name" "text", "messages" "jsonb"[], "sleep_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "pgmq_public"."send_batch"("queue_name" "text", "messages" "jsonb"[], "sleep_seconds" integer) IS 'Sends a batch of messages to the specified queue, optionally delaying their availability by a number of seconds.';



CREATE OR REPLACE FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  selected_booking public.bookings%rowtype;
  selected_slot public.availability_slots%rowtype;
begin
  if p_booking_id is null then
    raise exception 'A booking ID is required.';
  end if;

  select *
  into selected_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  if selected_booking.status = 'cancelled' then
    raise exception 'The booking has already been cancelled.';
  end if;

  select *
  into selected_slot
  from public.availability_slots
  where id = selected_booking.slot_id;

  if not found then
    raise exception 'The booking slot does not exist.';
  end if;

  update public.bookings
  set
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  where id = p_booking_id;

  update public.availability_slots
  set is_available = true
  where id = selected_booking.slot_id;

  perform public.queue_booking_email(
    selected_booking.id,
    'booking_cancelled',
    selected_booking.customer_email,
    selected_booking.customer_name,
    jsonb_build_object(
      'customer_name',
      selected_booking.customer_name,
      'slot_date',
      selected_slot.slot_date,
      'slot_time',
      selected_slot.slot_time
    )
  );

  return true;
end;
$$;


ALTER FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_booking_request"("p_slot_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text" DEFAULT NULL::"text", "p_customer_message" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  selected_slot public.availability_slots%rowtype;
  email_config public.booking_email_config%rowtype;
  new_booking_id uuid;
  cleaned_customer_name text;
  cleaned_customer_email text;
  cleaned_customer_phone text;
  cleaned_customer_message text;
begin
  if p_slot_id is null then
    raise exception 'A booking slot is required.';
  end if;

  cleaned_customer_name := nullif(btrim(p_customer_name), '');
  cleaned_customer_email := lower(nullif(btrim(p_customer_email), ''));
  cleaned_customer_phone := nullif(btrim(p_customer_phone), '');
  cleaned_customer_message := nullif(btrim(p_customer_message), '');

  if cleaned_customer_name is null then
    raise exception 'Customer name is required.';
  end if;

  if cleaned_customer_email is null then
    raise exception 'Customer email is required.';
  end if;

  select *
  into selected_slot
  from public.availability_slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'The selected booking slot does not exist.';
  end if;

  if selected_slot.slot_date < current_date then
    raise exception 'Past booking slots cannot be booked.';
  end if;

  if selected_slot.is_available is not true then
    raise exception 'The selected booking slot is no longer available.';
  end if;

  if exists (
    select 1
    from public.bookings
    where slot_id = p_slot_id
      and status <> 'cancelled'
  ) then
    raise exception 'The selected booking slot has already been booked.';
  end if;

  select *
  into email_config
  from public.booking_email_config
  where id = true;

  if not found then
    raise exception 'Booking email configuration has not been created.';
  end if;

  insert into public.bookings (
    slot_id,
    customer_name,
    customer_email,
    customer_phone,
    customer_message,
    status,
    payment_status,
    amount_due,
    amount_paid,
    updated_at
  )
  values (
    p_slot_id,
    cleaned_customer_name,
    cleaned_customer_email,
    cleaned_customer_phone,
    cleaned_customer_message,
    'pending',
    'unpaid',
    0,
    0,
    now()
  )
  returning id
  into new_booking_id;

  update public.availability_slots
  set is_available = false
  where id = p_slot_id;

  perform public.queue_booking_email(
    new_booking_id,
    'booking_request_customer',
    cleaned_customer_email,
    cleaned_customer_name,
    jsonb_build_object(
      'customer_name',
      cleaned_customer_name,
      'slot_date',
      selected_slot.slot_date,
      'slot_time',
      selected_slot.slot_time,
      'customer_message',
      cleaned_customer_message
    )
  );

  perform public.queue_booking_email(
    new_booking_id,
    'booking_request_admin',
    email_config.admin_email,
    email_config.admin_name,
    jsonb_build_object(
      'customer_name',
      cleaned_customer_name,
      'customer_email',
      cleaned_customer_email,
      'customer_phone',
      cleaned_customer_phone,
      'customer_message',
      cleaned_customer_message,
      'slot_date',
      selected_slot.slot_date,
      'slot_time',
      selected_slot.slot_time
    )
  );

  return new_booking_id;
end;
$$;


ALTER FUNCTION "public"."create_booking_request"("p_slot_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_customer_message" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."email_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "booking_reminders_enabled" boolean DEFAULT false NOT NULL,
    "send_window_start" time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    "send_window_end" time without time zone DEFAULT '20:00:00'::time without time zone NOT NULL,
    "timezone" "text" DEFAULT 'America/Chicago'::"text" NOT NULL,
    "confirmed_bookings_only" boolean DEFAULT true NOT NULL,
    "send_for_unpaid" boolean DEFAULT true NOT NULL,
    "send_for_part_paid" boolean DEFAULT true NOT NULL,
    "send_for_paid" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booking_reminder_hours_list" integer[] DEFAULT ARRAY[24] NOT NULL,
    "send_admin_reminders" boolean DEFAULT false NOT NULL,
    CONSTRAINT "email_settings_id_check" CHECK (("id" = true)),
    CONSTRAINT "email_settings_reminder_hours_list_check" CHECK ((("cardinality"("booking_reminder_hours_list") > 0) AND ("booking_reminder_hours_list" <@ ARRAY[12, 24, 48, 72, 168]))),
    CONSTRAINT "email_settings_send_window_check" CHECK (("send_window_end" > "send_window_start"))
);


ALTER TABLE "public"."email_settings" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_email_settings"() RETURNS "public"."email_settings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  current_settings public.email_settings%rowtype;
begin
  select *
  into current_settings
  from public.email_settings
  where id = true;

  if not found then
    raise exception 'Email settings have not been configured.';
  end if;

  return current_settings;
end;
$$;


ALTER FUNCTION "public"."get_email_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text" DEFAULT NULL::"text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return public.queue_booking_email(
    p_booking_id,
    p_email_type,
    p_recipient_email,
    p_recipient_name,
    p_payload,
    null
  );
end;
$$;


ALTER FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb", "p_reminder_key" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  new_log_id uuid;
  new_queue_message_id bigint;
  cleaned_recipient_email text;
  cleaned_recipient_name text;
  cleaned_reminder_key text;
  is_reminder_email boolean;
begin
  if p_booking_id is null then
    raise exception 'A booking ID is required.';
  end if;

  if p_email_type not in (
    'booking_request_customer',
    'booking_request_admin',
    'booking_confirmed',
    'booking_cancelled',
    'part_payment_received',
    'payment_received',
    'booking_reminder_24h',
    'booking_reminder_customer',
    'booking_reminder_admin'
  ) then
    raise exception 'Invalid booking email type.';
  end if;

  cleaned_recipient_email := lower(
    nullif(btrim(p_recipient_email), '')
  );

  cleaned_recipient_name := nullif(
    btrim(p_recipient_name),
    ''
  );

  cleaned_reminder_key := nullif(
    btrim(p_reminder_key),
    ''
  );

  is_reminder_email := p_email_type in (
    'booking_reminder_24h',
    'booking_reminder_customer',
    'booking_reminder_admin'
  );

  if cleaned_recipient_email is null then
    raise exception 'A recipient email address is required.';
  end if;

  if is_reminder_email and cleaned_reminder_key is null then
    raise exception 'A reminder key is required for reminder emails.';
  end if;

  if not is_reminder_email and cleaned_reminder_key is not null then
    raise exception 'A reminder key may only be used for reminder emails.';
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = p_booking_id
  ) then
    raise exception 'The booking does not exist.';
  end if;

  insert into public.booking_email_log (
    booking_id,
    email_type,
    recipient_email,
    recipient_name,
    reminder_key,
    status,
    created_at,
    updated_at
  )
  values (
    p_booking_id,
    p_email_type,
    cleaned_recipient_email,
    cleaned_recipient_name,
    cleaned_reminder_key,
    'queued',
    now(),
    now()
  )
  on conflict do nothing
  returning id
  into new_log_id;

  if new_log_id is null then
    select id
    into new_log_id
    from public.booking_email_log
    where booking_id = p_booking_id
      and email_type = p_email_type
      and recipient_email = cleaned_recipient_email
      and reminder_key is not distinct from cleaned_reminder_key
    order by created_at desc
    limit 1;

    return new_log_id;
  end if;

  select pgmq_public.send(
    queue_name => 'booking_emails',
    message => jsonb_build_object(
      'email_log_id',
      new_log_id,
      'booking_id',
      p_booking_id,
      'email_type',
      p_email_type,
      'recipient_email',
      cleaned_recipient_email,
      'recipient_name',
      cleaned_recipient_name,
      'reminder_key',
      cleaned_reminder_key,
      'payload',
      coalesce(p_payload, '{}'::jsonb)
    )
  )
  into new_queue_message_id;

  update public.booking_email_log
  set
    queue_message_id = new_queue_message_id,
    updated_at = now()
  where id = new_log_id;

  return new_log_id;
end;
$$;


ALTER FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb", "p_reminder_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_due_booking_reminders"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  reminder_settings public.email_settings%rowtype;
  email_config public.booking_email_config%rowtype;

  booking_record record;

  reminder_hours integer;
  reminder_key text;

  current_local_time timestamp without time zone;
  appointment_local timestamp without time zone;
  reminder_due_local timestamp without time zone;
  reminder_send_local timestamp without time zone;

  appointment_at timestamptz;
  reminder_send_at timestamptz;

  amount_remaining numeric;

  customer_reminders_queued integer := 0;
  admin_reminders_queued integer := 0;
begin
  select *
  into reminder_settings
  from public.email_settings
  where id = true;

  if not found then
    raise exception 'Email settings have not been configured.';
  end if;

  if not reminder_settings.booking_reminders_enabled then
    return jsonb_build_object(
      'enabled',
      false,
      'customer_reminders_queued',
      0,
      'admin_reminders_queued',
      0
    );
  end if;

  select *
  into email_config
  from public.booking_email_config
  where id = true;

  if not found then
    raise exception 'Booking email configuration has not been created.';
  end if;

  current_local_time :=
    now() at time zone reminder_settings.timezone;

  /*
   * Do not queue anything outside the permitted sending window.
   *
   * A reminder that became due outside the window will be picked up when
   * this function next runs during permitted hours.
   */
  if current_local_time::time < reminder_settings.send_window_start
    or current_local_time::time > reminder_settings.send_window_end
  then
    return jsonb_build_object(
      'enabled',
      true,
      'within_sending_window',
      false,
      'timezone',
      reminder_settings.timezone,
      'customer_reminders_queued',
      0,
      'admin_reminders_queued',
      0
    );
  end if;

  for booking_record in
    select
      booking.id,
      booking.customer_name,
      booking.customer_email,
      booking.customer_phone,
      booking.customer_message,
      booking.status,
      booking.payment_status,
      booking.amount_due,
      booking.amount_paid,
      slot.slot_date,
      slot.slot_time
    from public.bookings as booking
    inner join public.availability_slots as slot
      on slot.id = booking.slot_id
    where booking.status not in (
      'cancelled',
      'completed',
      'no_show'
    )
      and (
        not reminder_settings.confirmed_bookings_only
        or booking.status = 'confirmed'
      )
      and (
        (
          booking.payment_status = 'unpaid'
          and reminder_settings.send_for_unpaid
        )
        or (
          booking.payment_status = 'part_paid'
          and reminder_settings.send_for_part_paid
        )
        or (
          booking.payment_status in (
            'paid',
            'waived'
          )
          and reminder_settings.send_for_paid
        )
      )
  loop
    appointment_local :=
      booking_record.slot_date::date
      + booking_record.slot_time::time;

    appointment_at :=
      appointment_local
      at time zone reminder_settings.timezone;

    /*
     * Ignore appointments that have already started or passed.
     */
    if appointment_at <= now() then
      continue;
    end if;

    amount_remaining := greatest(
      coalesce(booking_record.amount_due, 0)
      - coalesce(booking_record.amount_paid, 0),
      0
    );

    foreach reminder_hours in array
      reminder_settings.booking_reminder_hours_list
    loop
      reminder_key := format(
        '%s-hours',
        reminder_hours
      );

      reminder_due_local :=
        appointment_local
        - make_interval(hours => reminder_hours);

      /*
       * Move reminders that fall outside normal hours into the next
       * permitted sending period.
       */
      if reminder_due_local::time
        < reminder_settings.send_window_start
      then
        reminder_send_local :=
          reminder_due_local::date
          + reminder_settings.send_window_start;

      elsif reminder_due_local::time
        > reminder_settings.send_window_end
      then
        reminder_send_local :=
          (
            reminder_due_local::date
            + 1
          )
          + reminder_settings.send_window_start;

      else
        reminder_send_local := reminder_due_local;
      end if;

      reminder_send_at :=
        reminder_send_local
        at time zone reminder_settings.timezone;

      /*
       * The reminder is not due yet.
       */
      if reminder_send_at > now() then
        continue;
      end if;

      /*
       * Do not send a delayed reminder after the appointment begins.
       */
      if reminder_send_at >= appointment_at then
        continue;
      end if;

      /*
       * Queue the customer reminder unless this exact reminder has
       * already been recorded.
       */
      if not exists (
        select 1
        from public.booking_email_log
        where booking_id = booking_record.id
          and email_type = 'booking_reminder_customer'
          and recipient_email = lower(
            btrim(booking_record.customer_email)
          )
          and booking_email_log.reminder_key = reminder_key
      )
      then
        perform public.queue_booking_email(
          booking_record.id,
          'booking_reminder_customer',
          booking_record.customer_email,
          booking_record.customer_name,
          jsonb_build_object(
            'customer_name',
            booking_record.customer_name,
            'slot_date',
            booking_record.slot_date,
            'slot_time',
            booking_record.slot_time,
            'reminder_hours',
            reminder_hours,
            'reminder_key',
            reminder_key,
            'timezone',
            reminder_settings.timezone,
            'payment_status',
            booking_record.payment_status,
            'amount_due',
            coalesce(booking_record.amount_due, 0),
            'amount_paid',
            coalesce(booking_record.amount_paid, 0),
            'amount_remaining',
            amount_remaining
          ),
          reminder_key
        );

        customer_reminders_queued :=
          customer_reminders_queued + 1;
      end if;

      /*
       * Optionally queue a matching operational reminder for Amanda.
       */
      if reminder_settings.send_admin_reminders
        and not exists (
          select 1
          from public.booking_email_log
          where booking_id = booking_record.id
            and email_type = 'booking_reminder_admin'
            and recipient_email = lower(
              btrim(email_config.admin_email)
            )
            and booking_email_log.reminder_key = reminder_key
        )
      then
        perform public.queue_booking_email(
          booking_record.id,
          'booking_reminder_admin',
          email_config.admin_email,
          email_config.admin_name,
          jsonb_build_object(
            'customer_name',
            booking_record.customer_name,
            'customer_email',
            booking_record.customer_email,
            'customer_phone',
            booking_record.customer_phone,
            'customer_message',
            booking_record.customer_message,
            'slot_date',
            booking_record.slot_date,
            'slot_time',
            booking_record.slot_time,
            'reminder_hours',
            reminder_hours,
            'reminder_key',
            reminder_key,
            'timezone',
            reminder_settings.timezone,
            'booking_status',
            booking_record.status,
            'payment_status',
            booking_record.payment_status,
            'amount_due',
            coalesce(booking_record.amount_due, 0),
            'amount_paid',
            coalesce(booking_record.amount_paid, 0),
            'amount_remaining',
            amount_remaining
          ),
          reminder_key
        );

        admin_reminders_queued :=
          admin_reminders_queued + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'enabled',
    true,
    'within_sending_window',
    true,
    'timezone',
    reminder_settings.timezone,
    'customer_reminders_queued',
    customer_reminders_queued,
    'admin_reminders_queued',
    admin_reminders_queued
  );
end;
$$;


ALTER FUNCTION "public"."queue_due_booking_reminders"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slot_id" "uuid",
    "customer_name" "text" NOT NULL,
    "customer_email" "text" NOT NULL,
    "customer_phone" "text" NOT NULL,
    "customer_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "amount_due" numeric(10,2) DEFAULT 0 NOT NULL,
    "amount_paid" numeric(10,2) DEFAULT 0 NOT NULL,
    "paid_at" timestamp with time zone,
    "payment_method" "text",
    "payment_reference" "text",
    "confirmed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "request_email_sent_at" timestamp with time zone,
    "admin_notification_sent_at" timestamp with time zone,
    "confirmation_email_sent_at" timestamp with time zone,
    "cancellation_email_sent_at" timestamp with time zone,
    "payment_email_sent_at" timestamp with time zone,
    "reminder_24h_sent_at" timestamp with time zone,
    CONSTRAINT "bookings_amount_due_check" CHECK (("amount_due" >= (0)::numeric)),
    CONSTRAINT "bookings_amount_paid_check" CHECK (("amount_paid" >= (0)::numeric)),
    CONSTRAINT "bookings_payment_method_check" CHECK ((("payment_method" IS NULL) OR ("payment_method" = ANY (ARRAY['cash'::"text", 'bank_transfer'::"text", 'card'::"text", 'payment_link'::"text", 'stripe'::"text", 'complimentary'::"text", 'other'::"text"])))),
    CONSTRAINT "bookings_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['unpaid'::"text", 'part_paid'::"text", 'paid'::"text", 'refunded'::"text", 'part_refunded'::"text", 'waived'::"text"]))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text", 'completed'::"text", 'no_show'::"text"])))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_booking_payment"("p_booking_id" "uuid", "p_payment_status" "text", "p_amount_due" numeric, "p_amount_paid" numeric, "p_payment_method" "text" DEFAULT NULL::"text", "p_payment_reference" "text" DEFAULT NULL::"text") RETURNS "public"."bookings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  selected_booking public.bookings%rowtype;
  selected_slot public.availability_slots%rowtype;
  updated_booking public.bookings%rowtype;
  cleaned_payment_method text;
  cleaned_payment_reference text;
  previous_amount_paid numeric;
  payment_increased boolean;
begin
  if p_booking_id is null then
    raise exception 'A booking ID is required.';
  end if;

  if p_payment_status not in (
    'unpaid',
    'part_paid',
    'paid',
    'waived'
  ) then
    raise exception 'Invalid payment status.';
  end if;

  if p_amount_due is null or p_amount_due < 0 then
    raise exception 'Amount due must be zero or greater.';
  end if;

  if p_amount_paid is null or p_amount_paid < 0 then
    raise exception 'Amount paid must be zero or greater.';
  end if;

  cleaned_payment_method := nullif(btrim(p_payment_method), '');
  cleaned_payment_reference := nullif(btrim(p_payment_reference), '');

  if cleaned_payment_method is not null
    and cleaned_payment_method not in (
      'cash',
      'bank_transfer',
      'card',
      'payment_link',
      'stripe',
      'complimentary',
      'other'
    )
  then
    raise exception 'Invalid payment method.';
  end if;

  select *
  into selected_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  select *
  into selected_slot
  from public.availability_slots
  where id = selected_booking.slot_id;

  if not found then
    raise exception 'The booking slot does not exist.';
  end if;

  previous_amount_paid := coalesce(selected_booking.amount_paid, 0);
  payment_increased := p_amount_paid > previous_amount_paid;

  if p_payment_status = 'unpaid' and p_amount_paid <> 0 then
    raise exception 'An unpaid booking must have an amount paid of zero.';
  end if;

  if p_payment_status = 'part_paid' then
    if p_amount_due <= 0 then
      raise exception 'A part-paid booking must have an amount due greater than zero.';
    end if;

    if p_amount_paid <= 0 or p_amount_paid >= p_amount_due then
      raise exception 'A part payment must be greater than zero and less than the amount due.';
    end if;

    if cleaned_payment_method is null then
      raise exception 'A payment method is required when recording a part payment.';
    end if;
  end if;

  if p_payment_status = 'paid' then
    if p_amount_due <= 0 then
      raise exception 'A paid booking must have an amount due greater than zero.';
    end if;

    if p_amount_paid < p_amount_due then
      raise exception 'The amount paid must cover the full amount due.';
    end if;

    if cleaned_payment_method is null then
      raise exception 'A payment method is required when marking a booking as paid.';
    end if;
  end if;

  if p_payment_status = 'waived' then
    if p_amount_paid <> 0 then
      raise exception 'A waived booking must have an amount paid of zero.';
    end if;

    cleaned_payment_method := 'complimentary';
  end if;

  update public.bookings
  set
    payment_status = p_payment_status,
    amount_due = p_amount_due,
    amount_paid = p_amount_paid,
    payment_method = cleaned_payment_method,
    payment_reference = cleaned_payment_reference,

    paid_at = case
      when p_payment_status = 'paid'
        then coalesce(paid_at, now())
      else null
    end,

    updated_at = now()

  where id = p_booking_id

  returning *
  into updated_booking;

  if
    payment_increased
    and p_payment_status = 'part_paid'
  then
    perform public.queue_booking_email(
      updated_booking.id,
      'part_payment_received',
      updated_booking.customer_email,
      updated_booking.customer_name,
      jsonb_build_object(
        'customer_name',
        updated_booking.customer_name,
        'slot_date',
        selected_slot.slot_date,
        'slot_time',
        selected_slot.slot_time,
        'amount_due',
        updated_booking.amount_due,
        'amount_paid',
        updated_booking.amount_paid,
        'amount_received',
        updated_booking.amount_paid - previous_amount_paid,
        'amount_remaining',
        greatest(
          updated_booking.amount_due - updated_booking.amount_paid,
          0
        ),
        'payment_method',
        updated_booking.payment_method,
        'payment_reference',
        updated_booking.payment_reference
      )
    );
  end if;

  if
    payment_increased
    and p_payment_status = 'paid'
    and selected_booking.payment_status <> 'paid'
  then
    perform public.queue_booking_email(
      updated_booking.id,
      'payment_received',
      updated_booking.customer_email,
      updated_booking.customer_name,
      jsonb_build_object(
        'customer_name',
        updated_booking.customer_name,
        'slot_date',
        selected_slot.slot_date,
        'slot_time',
        selected_slot.slot_time,
        'amount_due',
        updated_booking.amount_due,
        'amount_paid',
        updated_booking.amount_paid,
        'amount_received',
        updated_booking.amount_paid - previous_amount_paid,
        'amount_remaining',
        0,
        'payment_method',
        updated_booking.payment_method,
        'payment_reference',
        updated_booking.payment_reference
      )
    );
  end if;

  return updated_booking;
end;
$$;


ALTER FUNCTION "public"."update_booking_payment"("p_booking_id" "uuid", "p_payment_status" "text", "p_amount_due" numeric, "p_amount_paid" numeric, "p_payment_method" "text", "p_payment_reference" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_booking_status"("p_booking_id" "uuid", "p_status" "text") RETURNS "public"."bookings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  selected_booking public.bookings%rowtype;
  selected_slot public.availability_slots%rowtype;
  updated_booking public.bookings%rowtype;
begin
  if p_booking_id is null then
    raise exception 'A booking ID is required.';
  end if;

  if p_status not in (
    'pending',
    'confirmed',
    'completed',
    'no_show'
  ) then
    raise exception 'Invalid booking status.';
  end if;

  select *
  into selected_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'The booking does not exist.';
  end if;

  if selected_booking.status = 'cancelled' then
    raise exception 'A cancelled booking cannot be changed.';
  end if;

  select *
  into selected_slot
  from public.availability_slots
  where id = selected_booking.slot_id;

  if not found then
    raise exception 'The booking slot does not exist.';
  end if;

  update public.bookings
  set
    status = p_status,

    confirmed_at = case
      when p_status = 'confirmed'
        then coalesce(confirmed_at, now())
      when p_status = 'pending'
        then null
      else confirmed_at
    end,

    completed_at = case
      when p_status = 'completed'
        then coalesce(completed_at, now())
      when p_status in ('pending', 'confirmed')
        then null
      else completed_at
    end,

    updated_at = now()

  where id = p_booking_id

  returning *
  into updated_booking;

  if
    p_status = 'confirmed'
    and selected_booking.status <> 'confirmed'
  then
    perform public.queue_booking_email(
      updated_booking.id,
      'booking_confirmed',
      updated_booking.customer_email,
      updated_booking.customer_name,
      jsonb_build_object(
        'customer_name',
        updated_booking.customer_name,
        'slot_date',
        selected_slot.slot_date,
        'slot_time',
        selected_slot.slot_time
      )
    );
  end if;

  return updated_booking;
end;
$$;


ALTER FUNCTION "public"."update_booking_status"("p_booking_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_email_settings"("p_booking_reminders_enabled" boolean, "p_booking_reminder_hours_list" integer[], "p_send_admin_reminders" boolean, "p_send_window_start" time without time zone, "p_send_window_end" time without time zone, "p_timezone" "text", "p_confirmed_bookings_only" boolean, "p_send_for_unpaid" boolean, "p_send_for_part_paid" boolean, "p_send_for_paid" boolean) RETURNS "public"."email_settings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  updated_settings public.email_settings%rowtype;
  cleaned_timezone text;
  cleaned_reminder_hours integer[];
begin
  if p_booking_reminders_enabled is null then
    raise exception 'Reminder enabled status is required.';
  end if;

  if p_send_admin_reminders is null then
    raise exception 'Admin reminder setting is required.';
  end if;

  if p_booking_reminder_hours_list is null
    or cardinality(p_booking_reminder_hours_list) = 0
  then
    raise exception 'At least one reminder timing is required.';
  end if;

  if not (
    p_booking_reminder_hours_list
    <@ array[12, 24, 48, 72, 168]::integer[]
  ) then
    raise exception 'One or more reminder timings are invalid.';
  end if;

  -- Remove duplicates and store reminder timings from earliest
  -- notification to latest notification.
  select array_agg(
    reminder_hours
    order by reminder_hours desc
  )
  into cleaned_reminder_hours
  from (
    select distinct
      unnest(p_booking_reminder_hours_list) as reminder_hours
  ) as reminder_values;

  if p_send_window_start is null
    or p_send_window_end is null
  then
    raise exception 'A reminder sending window is required.';
  end if;

  if p_send_window_end <= p_send_window_start then
    raise exception 'The end of the sending window must be later than the start.';
  end if;

  cleaned_timezone := nullif(
    btrim(p_timezone),
    ''
  );

  if cleaned_timezone is null then
    raise exception 'A business time zone is required.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = cleaned_timezone
  ) then
    raise exception 'Invalid time zone.';
  end if;

  update public.email_settings
  set
    booking_reminders_enabled = p_booking_reminders_enabled,
    booking_reminder_hours_list = cleaned_reminder_hours,
    send_admin_reminders = p_send_admin_reminders,
    send_window_start = p_send_window_start,
    send_window_end = p_send_window_end,
    timezone = cleaned_timezone,
    confirmed_bookings_only = p_confirmed_bookings_only,
    send_for_unpaid = p_send_for_unpaid,
    send_for_part_paid = p_send_for_part_paid,
    send_for_paid = p_send_for_paid,
    updated_at = now()
  where id = true
  returning *
  into updated_settings;

  if not found then
    raise exception 'Email settings have not been configured.';
  end if;

  return updated_settings;
end;
$$;


ALTER FUNCTION "public"."update_email_settings"("p_booking_reminders_enabled" boolean, "p_booking_reminder_hours_list" integer[], "p_send_admin_reminders" boolean, "p_send_window_start" time without time zone, "p_send_window_end" time without time zone, "p_timezone" "text", "p_confirmed_bookings_only" boolean, "p_send_for_unpaid" boolean, "p_send_for_part_paid" boolean, "p_send_for_paid" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."availability_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slot_date" "date" NOT NULL,
    "slot_time" "text" NOT NULL,
    "is_available" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."availability_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_email_config" (
    "id" boolean DEFAULT true NOT NULL,
    "admin_email" "text" NOT NULL,
    "admin_name" "text" DEFAULT 'Amanda Beach'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_email_config_id_check" CHECK (("id" = true))
);


ALTER TABLE "public"."booking_email_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_email_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "email_type" "text" NOT NULL,
    "recipient_email" "text" NOT NULL,
    "recipient_name" "text",
    "queue_message_id" bigint,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "resend_email_id" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reminder_key" "text",
    CONSTRAINT "booking_email_log_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "booking_email_log_email_type_check" CHECK (("email_type" = ANY (ARRAY['booking_request_customer'::"text", 'booking_request_admin'::"text", 'booking_confirmed'::"text", 'booking_cancelled'::"text", 'part_payment_received'::"text", 'payment_received'::"text", 'booking_reminder_24h'::"text", 'booking_reminder_customer'::"text", 'booking_reminder_admin'::"text"]))),
    CONSTRAINT "booking_email_log_reminder_key_check" CHECK ((("reminder_key" IS NULL) OR ("btrim"("reminder_key") <> ''::"text"))),
    CONSTRAINT "booking_email_log_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."booking_email_log" OWNER TO "postgres";


ALTER TABLE ONLY "public"."availability_slots"
    ADD CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_email_config"
    ADD CONSTRAINT "booking_email_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_email_log"
    ADD CONSTRAINT "booking_email_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_settings"
    ADD CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."availability_slots"
    ADD CONSTRAINT "unique_slot_datetime" UNIQUE ("slot_date", "slot_time");



CREATE INDEX "booking_email_log_booking_id_index" ON "public"."booking_email_log" USING "btree" ("booking_id");



CREATE INDEX "booking_email_log_created_at_index" ON "public"."booking_email_log" USING "btree" ("created_at");



CREATE UNIQUE INDEX "booking_email_log_reminder_email_unique" ON "public"."booking_email_log" USING "btree" ("booking_id", "email_type", "recipient_email", "reminder_key") WHERE ("reminder_key" IS NOT NULL);



CREATE UNIQUE INDEX "booking_email_log_standard_email_unique" ON "public"."booking_email_log" USING "btree" ("booking_id", "email_type", "recipient_email") WHERE ("reminder_key" IS NULL);



CREATE INDEX "booking_email_log_status_index" ON "public"."booking_email_log" USING "btree" ("status");



CREATE INDEX "bookings_created_at_index" ON "public"."bookings" USING "btree" ("created_at");



CREATE UNIQUE INDEX "bookings_one_active_booking_per_slot" ON "public"."bookings" USING "btree" ("slot_id") WHERE ("status" <> 'cancelled'::"text");



CREATE INDEX "bookings_payment_status_index" ON "public"."bookings" USING "btree" ("payment_status");



CREATE INDEX "bookings_slot_id_index" ON "public"."bookings" USING "btree" ("slot_id");



CREATE INDEX "bookings_status_index" ON "public"."bookings" USING "btree" ("status");



ALTER TABLE ONLY "public"."booking_email_log"
    ADD CONSTRAINT "booking_email_log_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."availability_slots"("id") ON DELETE CASCADE;



CREATE POLICY "Authenticated users can manage bookings" ON "public"."bookings" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can manage slots" ON "public"."availability_slots" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Public can create bookings" ON "public"."bookings" FOR INSERT WITH CHECK (true);



CREATE POLICY "Public can view slots" ON "public"."availability_slots" FOR SELECT USING (true);



ALTER TABLE "public"."availability_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_email_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_email_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_settings" ENABLE ROW LEVEL SECURITY;




GRANT USAGE ON SCHEMA "pgmq_public" TO "anon";
GRANT USAGE ON SCHEMA "pgmq_public" TO "authenticated";
GRANT USAGE ON SCHEMA "pgmq_public" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";





























































































































































































GRANT ALL ON FUNCTION "pgmq_public"."archive"("queue_name" "text", "message_id" bigint) TO "service_role";
GRANT ALL ON FUNCTION "pgmq_public"."archive"("queue_name" "text", "message_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "pgmq_public"."archive"("queue_name" "text", "message_id" bigint) TO "authenticated";



GRANT ALL ON FUNCTION "pgmq_public"."delete"("queue_name" "text", "message_id" bigint) TO "service_role";
GRANT ALL ON FUNCTION "pgmq_public"."delete"("queue_name" "text", "message_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "pgmq_public"."delete"("queue_name" "text", "message_id" bigint) TO "authenticated";



GRANT ALL ON FUNCTION "pgmq_public"."pop"("queue_name" "text") TO "service_role";
GRANT ALL ON FUNCTION "pgmq_public"."pop"("queue_name" "text") TO "anon";
GRANT ALL ON FUNCTION "pgmq_public"."pop"("queue_name" "text") TO "authenticated";



GRANT ALL ON FUNCTION "pgmq_public"."read"("queue_name" "text", "sleep_seconds" integer, "n" integer) TO "service_role";
GRANT ALL ON FUNCTION "pgmq_public"."read"("queue_name" "text", "sleep_seconds" integer, "n" integer) TO "anon";
GRANT ALL ON FUNCTION "pgmq_public"."read"("queue_name" "text", "sleep_seconds" integer, "n" integer) TO "authenticated";



GRANT ALL ON FUNCTION "pgmq_public"."send"("queue_name" "text", "message" "jsonb", "sleep_seconds" integer) TO "service_role";
GRANT ALL ON FUNCTION "pgmq_public"."send"("queue_name" "text", "message" "jsonb", "sleep_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "pgmq_public"."send"("queue_name" "text", "message" "jsonb", "sleep_seconds" integer) TO "authenticated";



GRANT ALL ON FUNCTION "pgmq_public"."send_batch"("queue_name" "text", "messages" "jsonb"[], "sleep_seconds" integer) TO "service_role";
GRANT ALL ON FUNCTION "pgmq_public"."send_batch"("queue_name" "text", "messages" "jsonb"[], "sleep_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "pgmq_public"."send_batch"("queue_name" "text", "messages" "jsonb"[], "sleep_seconds" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_booking_request"("p_slot_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_customer_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_booking_request"("p_slot_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_customer_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_booking_request"("p_slot_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_customer_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_booking_request"("p_slot_id" "uuid", "p_customer_name" "text", "p_customer_email" "text", "p_customer_phone" "text", "p_customer_message" "text") TO "service_role";



GRANT ALL ON TABLE "public"."email_settings" TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_email_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_email_settings"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_email_settings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_email_settings"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb", "p_reminder_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb", "p_reminder_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb", "p_reminder_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_booking_email"("p_booking_id" "uuid", "p_email_type" "text", "p_recipient_email" "text", "p_recipient_name" "text", "p_payload" "jsonb", "p_reminder_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."queue_due_booking_reminders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_due_booking_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."queue_due_booking_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_due_booking_reminders"() TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_booking_payment"("p_booking_id" "uuid", "p_payment_status" "text", "p_amount_due" numeric, "p_amount_paid" numeric, "p_payment_method" "text", "p_payment_reference" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_booking_payment"("p_booking_id" "uuid", "p_payment_status" "text", "p_amount_due" numeric, "p_amount_paid" numeric, "p_payment_method" "text", "p_payment_reference" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_booking_payment"("p_booking_id" "uuid", "p_payment_status" "text", "p_amount_due" numeric, "p_amount_paid" numeric, "p_payment_method" "text", "p_payment_reference" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_booking_payment"("p_booking_id" "uuid", "p_payment_status" "text", "p_amount_due" numeric, "p_amount_paid" numeric, "p_payment_method" "text", "p_payment_reference" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_booking_status"("p_booking_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_booking_status"("p_booking_id" "uuid", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_booking_status"("p_booking_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_booking_status"("p_booking_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_email_settings"("p_booking_reminders_enabled" boolean, "p_booking_reminder_hours_list" integer[], "p_send_admin_reminders" boolean, "p_send_window_start" time without time zone, "p_send_window_end" time without time zone, "p_timezone" "text", "p_confirmed_bookings_only" boolean, "p_send_for_unpaid" boolean, "p_send_for_part_paid" boolean, "p_send_for_paid" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_email_settings"("p_booking_reminders_enabled" boolean, "p_booking_reminder_hours_list" integer[], "p_send_admin_reminders" boolean, "p_send_window_start" time without time zone, "p_send_window_end" time without time zone, "p_timezone" "text", "p_confirmed_bookings_only" boolean, "p_send_for_unpaid" boolean, "p_send_for_part_paid" boolean, "p_send_for_paid" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."update_email_settings"("p_booking_reminders_enabled" boolean, "p_booking_reminder_hours_list" integer[], "p_send_admin_reminders" boolean, "p_send_window_start" time without time zone, "p_send_window_end" time without time zone, "p_timezone" "text", "p_confirmed_bookings_only" boolean, "p_send_for_unpaid" boolean, "p_send_for_part_paid" boolean, "p_send_for_paid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_email_settings"("p_booking_reminders_enabled" boolean, "p_booking_reminder_hours_list" integer[], "p_send_admin_reminders" boolean, "p_send_window_start" time without time zone, "p_send_window_end" time without time zone, "p_timezone" "text", "p_confirmed_bookings_only" boolean, "p_send_for_unpaid" boolean, "p_send_for_part_paid" boolean, "p_send_for_paid" boolean) TO "service_role";



























GRANT ALL ON TABLE "public"."availability_slots" TO "anon";
GRANT ALL ON TABLE "public"."availability_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."availability_slots" TO "service_role";



GRANT ALL ON TABLE "public"."booking_email_config" TO "service_role";



GRANT ALL ON TABLE "public"."booking_email_log" TO "anon";
GRANT ALL ON TABLE "public"."booking_email_log" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_email_log" TO "service_role";

-- The live "Booking Reminder Scheduler" job has no secret material. Calling
-- cron.schedule with its existing name updates that named job when present.
select cron.schedule(
  'Booking Reminder Scheduler',
  '*/10 * * * *',
  $cron$select public.queue_due_booking_reminders();$cron$
);

-- The live "process-booking-emails" job runs every minute and invokes the
-- process-booking-emails Edge Function through pg_net. It is deliberately not
-- reproduced because its current command embeds an authorization credential.
-- Redesign that scheduler without embedded credentials before source control.
