import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const functionSql = (sql, name) => {
  const result = sql.match(new RegExp(`create(?: or replace)? function ${name.replaceAll(".", "\\.")}\\([^]*?\\n\\$\\$;`))?.[0];
  assert.ok(result, `Missing migration function ${name}`);
  return result;
};

// Execute the forward migration and effective legacy/admin implementations in
// isolated PostgreSQL with fixture tables, auth and email transport. Calls use
// SET ROLE as well as JWT claims, not just a postgres impersonation.
// No Supabase project, Square API, host port or persistent volume is used.
test("business-time availability boundary in PostgreSQL", { timeout: 240000 }, async (t) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status !== 0) {
    t.skip("Requires Docker with local postgres:17 image.");
    return;
  }
  const container = `amanda-slot-time-test-${randomUUID()}`;
  const exec = (args, input) => new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let error = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { error += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(input);
  });
  await exec(["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]);
  t.after(() => exec(["rm", "-f", container]));
  const query = (sql) => exec(["exec", "-i", "-e", "PGOPTIONS=-c statement_timeout=10000", container,
    "psql", "-h", "127.0.0.1", "-U", "postgres", "-XqAt", "-v", "ON_ERROR_STOP=1"], sql);
  for (let i = 0; ; i++) {
    try { await query("select 1;"); break; } catch (error) {
      if (i === 50) throw error;
      await delay(100);
    }
  }
  const services = await read("20260817210000_add_booking_services.sql");
  const security = await read("20260817185300_booking_security_admin_foundation.sql");
  const enforcement = await read("20260817185400_booking_security_enforcement.sql");
  const stripe = await read("20260817213000_service_stripe_payment_links.sql");
  const phaseOne = await read("20260818001000_direct_payment_phase_one.sql");
  const admin = await read("20260904001000_direct_payment_admin_lifecycle.sql");
  const compatibility = await read("20260904002000_direct_payment_compatibility.sql");
  const migration = await read("20260906002000_guard_legacy_booking_payment_flow.sql");
  const timed = await read("20260904000000_timed_direct_payment_lifecycle.sql");
  const pastSlots = await read("20260818000000_delete_past_availability_slots.sql");
  const permissions = await read("20260906003000_protect_admin_booking_slot_mutations.sql");
  const materializedStarts = await read("20260908100000_materialize_availability_slot_starts_at.sql");
  const adminId = randomUUID();
  await query(`
    create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql as
      $$ select current_setting('request.jwt.claims', true)::jsonb $$;
    create function auth.uid() returns uuid language sql as
      $$ select (auth.jwt() ->> 'sub')::uuid $$;
    ${security}
    insert into auth.users values ('${adminId}');
    insert into public.admin_users(user_id) values ('${adminId}');
    ${services.match(/create table public.services \([^]*?\n\);/)[0]}
    alter table public.services add column payment_flow text not null default 'none';
    alter table public.services add constraint services_payment_flow_check check (
      (payment_required is not true and payment_flow = 'none') or
      (payment_required is true and payment_flow in ('payment_link', 'direct_payment')));
    create table public.availability_slots (
      id uuid primary key default gen_random_uuid(), slot_date date default current_date + 1,
      slot_time text not null default '12:00', is_available boolean default true, unique(slot_date,slot_time)
    );
    create table public.bookings (
      id uuid primary key default gen_random_uuid(), slot_id uuid references public.availability_slots on delete restrict,
      service_id uuid not null references public.services,
      service_name_snapshot text not null, service_booking_mode_snapshot text not null,
      service_duration_minutes_snapshot integer, service_price_amount_snapshot integer not null,
      service_currency_snapshot text not null, service_payment_flow_snapshot text,
      status text not null, payment_status text not null,
      amount_due numeric not null, amount_paid numeric not null,
      customer_name text not null, customer_email text not null,
      customer_phone text, customer_message text, paid_at timestamptz,
      payment_method text, payment_reference text, confirmed_at timestamptz,
      cancelled_at timestamptz, completed_at timestamptz, updated_at timestamptz default now()
    );
    alter table public.bookings enable row level security;
    alter table public.availability_slots enable row level security;
    ${enforcement.slice(enforcement.indexOf('drop policy if exists "Public can create bookings"'), enforcement.indexOf('revoke all on table public.booking_email_config'))}
    create unique index bookings_one_active_booking_per_slot on public.bookings(slot_id)
      where status in ('pending','pending_payment','confirmed','completed','no_show');
    create table public.booking_email_config (id boolean primary key, admin_email text, admin_name text);
    insert into public.booking_email_config values (true, 'admin@example.test', 'Admin');
    create table public.service_payment_settings (service_id uuid primary key, stripe_payment_link_url text);
    create table public.test_emails (booking_id uuid, template text, payload jsonb);
    create function public.queue_booking_email(uuid,text,text,text,jsonb) returns boolean
      language plpgsql as $$ begin insert into public.test_emails values ($1,$2,$5); return true; end; $$;
    ${phaseOne.match(/create table private.payment_attempts \([^]*?\n\);/)[0]}
    ${functionSql(services, "private.cancel_booking")}
    ${functionSql(services, "private.update_booking_payment")}
    ${functionSql(stripe, "private.update_booking_status")}
    ${functionSql(phaseOne, "public.update_booking_payment")}
    grant execute on function public.update_booking_payment(uuid,text,numeric,numeric,text,text) to authenticated, service_role;
    revoke all on function private.cancel_booking(uuid), private.update_booking_status(uuid,text),
      private.update_booking_payment(uuid,text,numeric,numeric,text,text) from public, anon, authenticated, service_role;
    ${admin}
    ${compatibility.slice(compatibility.indexOf('create or replace function public.create_booking_request('))}
    ${await read("20260817211000_remove_legacy_booking_request_rpc.sql")}
    ${migration}
    ${phaseOne.match(/create table private.booking_payment_access \([^]*?\n\);/)[0]}
    ${phaseOne.match(/create table private.payment_webhook_events \([^]*?\n\);/)[0]}
    ${phaseOne.slice(phaseOne.indexOf('create function public.begin_payment_attempt('), phaseOne.indexOf('-- Direct-payment fields remain'))}
    ${timed.slice(timed.indexOf('create function public.create_pending_payment_booking('), timed.indexOf('select cron.schedule('))}
    ${await read("20260905000000_abandon_timed_payment_checkout.sql")}
    ${await read("20260906000000_payment_failure_supersession.sql")}
    ${await read("20260906001000_timed_checkout_cleanup_lease.sql")}
    ${pastSlots.slice(0, pastSlots.indexOf('select cron.schedule('))}

  `);
  await query(`
    ${permissions}
    create table public.email_settings (id boolean primary key, timezone text, secret_setting text);
    insert into public.email_settings values (true, 'America/Chicago', 'must-not-be-public');
    ${await read("20260908000000_business_timezone_slot_expiry.sql")}
    ${materializedStarts}
  `);
  const asRole = (role, sql, user = null) => query(`set role ${role};
    set request.jwt.claims = '${JSON.stringify({ role, ...(user ? { sub: user } : {}) })}'; ${sql}`);
  const asAdmin = (sql) => asRole('authenticated', sql, adminId);
  const server = (sql) => asRole('service_role', sql);
  const directId = randomUUID(), legacyId = randomUUID();
  await query(`insert into public.services(id,slug,name,booking_mode,duration_minutes,price_amount,payment_required,payment_flow)
    values ('${directId}','direct','Direct','timed',60,8500,true,'direct_payment'),
           ('${legacyId}','legacy','Legacy','timed',60,8500,true,'payment_link');`);
  const makeSlot = async (offset) => query(`insert into public.availability_slots(slot_date,slot_time)
    select (wall)::date, to_char(wall, 'HH24:MI:SS') from
      (select (clock_timestamp() + interval '${offset}') at time zone public.get_business_timezone() as wall) q
    returning id;`);
  const reserveSql = (id) => `select public.create_pending_payment_booking('${directId}', 'Customer', 'customer@example.test', null, null, '${id}');`;

  await t.test('public endpoint exposes only validated timezone, not email settings', async () => {
    assert.equal(await asRole('anon', 'select public.get_business_timezone();'), 'America/Chicago');
    await assert.rejects(asRole('anon', 'select * from public.email_settings;'), /permission denied/);
    await assert.rejects(asRole('authenticated', 'select * from public.email_settings;'), /permission denied/);
    await assert.rejects(asRole('anon', "select private.slot_start_instant('2026-09-07','13:00');"), /permission denied/);
    assert.equal(await query("select pg_get_function_result('public.get_business_timezone()'::regprocedure);"), 'text');
    for (const value of ["null", "''", "'not/a-zone'", "'EST'", "'posix/America/Chicago'"]) {
      await assert.rejects(query(`update public.email_settings set timezone=${value};`), /Invalid business time zone/);
      assert.equal(await asRole('anon', 'select public.get_business_timezone();'), 'America/Chicago');
    }
    await query("delete from public.email_settings;");
    assert.equal(await asRole('anon', 'select public.get_business_timezone();'), 'America/Chicago');
    await query("insert into public.email_settings values(true,'America/Chicago','private');");
  });

  await t.test('standard/daylight time, exact boundary, dates and DST transitions', async () => {
    for (const [date,time,expected] of [
      ['2026-01-15','13:00','2026-01-15T19:00:00Z'],
      ['2026-07-15','13:00','2026-07-15T18:00:00Z'],
      ['2026-03-08','01:59','2026-03-08T07:59:00Z'],
      ['2026-03-08','03:00','2026-03-08T08:00:00Z'],
      ['2026-03-08','02:30','2026-03-08T08:30:00Z'],
      ['2026-11-01','01:30','2026-11-01T07:30:00Z'],
    ]) {
      assert.equal(await query(`select private.slot_start_instant('${date}','${time}') = '${expected}'::timestamptz;`), 't');
    }
    for (const [date,time,now,expected] of [
      ['2026-07-15','13:00','2026-07-15T17:30:00Z','t'],
      ['2026-07-15','13:00','2026-07-15T18:01:00Z','f'],
      ['2026-07-15','13:00','2026-07-15T18:00:00Z','t'],
      ['2026-07-15','13:00','2026-07-15T18:00:00.001Z','f'],
      ['2026-07-14','23:00','2026-07-15T18:00:00Z','f'],
      ['2026-07-16','09:00','2026-07-15T18:00:00Z','t'],
      ['2026-07-15','23:30','2026-07-16T04:00:00Z','t'],
      ['2026-07-16','00:00','2026-07-16T05:00:00Z','t'],
    ]) assert.equal(await query(`select private.slot_is_future('${date}','${time}','${now}');`), expected);
    assert.equal(await query("select private.slot_is_future('2026-07-15','invalid','2026-07-15T18:00:00Z');"), 'f');
  });

  await t.test('materialized instants are derived, maintained, and recomputed atomically', async () => {
    const id = randomUUID();
    await query(`insert into public.availability_slots(id,slot_date,slot_time,is_available,starts_at)
      values ('${id}','2026-07-15','13:00',true,'2000-01-01T00:00:00Z');`);
    assert.equal(await query(`select starts_at = '2026-07-15T18:00:00Z'::timestamptz
      from public.availability_slots where id='${id}';`), 't');

    const beforeAvailabilityUpdate = await query(`select starts_at from public.availability_slots where id='${id}';`);
    await query(`update public.availability_slots set is_available=false where id='${id}';`);
    assert.equal(await query(`select starts_at from public.availability_slots where id='${id}';`), beforeAvailabilityUpdate);

    await query(`update public.availability_slots
      set slot_date='2026-01-15', slot_time='13:00', starts_at='2000-01-01T00:00:00Z'
      where id='${id}';`);
    assert.equal(await query(`select starts_at = '2026-01-15T19:00:00Z'::timestamptz
      from public.availability_slots where id='${id}';`), 't');

    await query("update public.email_settings set timezone='America/New_York';");
    assert.equal(await query(`select starts_at = '2026-01-15T18:00:00Z'::timestamptz
      from public.availability_slots where id='${id}';`), 't');
    const beforeFailure = await query(`select starts_at from public.availability_slots where id='${id}';`);
    await assert.rejects(query("update public.email_settings set timezone='not/a-zone';"), /Invalid business time zone/);
    assert.equal(await query(`select starts_at from public.availability_slots where id='${id}';`), beforeFailure);
    await query("update public.email_settings set timezone='America/Chicago';");
  });

  await t.test('physical RLS path scales to a production-sized availability set', async () => {
    // Trigger behavior is covered above. Seed a large, already-derived fixture
    // directly so this test measures the public read path, not 1,000 serial
    // timezone-setting lookups during test setup.
    await query(`alter table public.availability_slots
        disable trigger availability_slots_maintain_starts_at;
      insert into public.availability_slots(slot_date,slot_time,is_available,starts_at)
      select date '2030-01-01' + (value / 8)::integer,
        lpad((8 + (value % 8))::text, 2, '0') || ':00', true,
        ((date '2030-01-01' + (value / 8)::integer)
          + (lpad((8 + (value % 8))::text, 2, '0') || ':00')::time)
          at time zone 'America/Chicago'
      from generate_series(0, 999) as value
      on conflict (slot_date,slot_time) do nothing;
      alter table public.availability_slots
        enable trigger availability_slots_maintain_starts_at;`);
    const returned = Number(await asRole('anon', `select count(*)
      from (select * from public.availability_slots
        where is_available is true order by slot_date,slot_time) slots;`));
    assert.ok(returned >= 1000);
    assert.equal(await query(`select count(*)
      from public.availability_slots where starts_at is null;`), '0');
    assert.equal(await query(`select pg_get_functiondef(
      'public.slot_starts_at(public.availability_slots)'::regprocedure
    ) !~ 'pg_timezone_names';`), 't');
    assert.equal(await query(`select qual !~ 'slot_starts_at|slot_start_instant'
      from pg_policies where schemaname='public' and tablename='availability_slots'
        and policyname='Public can view future available slots';`), 't');
  });

  await t.test('RLS and both public creation paths reject elapsed starts and allow later starts', async () => {
    const past = await makeSlot('-2 hours');
    const future = await makeSlot('2 hours');
    assert.equal(await asRole('anon', `select count(*) from public.availability_slots where id='${past}';`), '0');
    assert.equal(await asRole('anon', `select count(*) from public.availability_slots where id='${future}';`), '1');
    assert.equal(await asRole('anon', `select public.slot_starts_at(s) is not null from public.availability_slots s where id='${future}';`), 't');
    await assert.rejects(asRole('anon', reserveSql(past)), /Past booking slots/);
    await assert.rejects(asRole('anon', `select public.create_booking_request('${legacyId}','${past}','Customer','customer@example.test');`), /Past booking slots/);
    const result = JSON.parse(await asRole('anon', reserveSql(future)));
    assert.ok(result.booking_id);
    assert.equal(await asRole('anon', `select count(*) from public.availability_slots where id='${future}';`), '0');
    assert.equal(await asAdmin(`select count(*) from public.availability_slots where id='${future}';`), '1');
    const legacyFuture = await makeSlot('3 hours');
    assert.ok(await asRole('anon', `select public.create_booking_request('${legacyId}','${legacyFuture}','Customer','customer@example.test');`));
  });

  await t.test('UTC/business-date disagreement does not prevent a future reservation', async () => {
    await query(`update public.email_settings set timezone = case
      when extract(hour from clock_timestamp() at time zone 'UTC') < 10 then 'Etc/GMT+12' else 'Pacific/Kiritimati' end;`);
    const id = await makeSlot('15 minutes');
    assert.equal(await query(`select slot_date <> (clock_timestamp() at time zone 'UTC')::date from public.availability_slots where id='${id}';`), 't');
    assert.equal(await asRole('anon', `select count(*) from public.availability_slots where id='${id}';`), '1');
    assert.ok(JSON.parse(await asRole('anon', reserveSql(id))).booking_id);
    await query("update public.email_settings set timezone='America/Chicago';");
  });

  await t.test('admin generation rejects elapsed times without changing available ownership', async () => {
    await assert.rejects(asAdmin(`select public.create_availability_slots(jsonb_build_array(jsonb_build_object(
      'slot_date', ((clock_timestamp()-interval '1 hour') at time zone public.get_business_timezone())::date,
      'slot_time', to_char((clock_timestamp()-interval '1 hour') at time zone public.get_business_timezone(),'HH24:MI'))));`), /past/);
    assert.equal(await asAdmin(`select public.create_availability_slots(jsonb_build_array(jsonb_build_object(
      'slot_date', ((clock_timestamp()+interval '4 hours') at time zone public.get_business_timezone())::date,
      'slot_time', to_char((clock_timestamp()+interval '4 hours') at time zone public.get_business_timezone(),'HH24:MI'))));`), '1');
  });

  await t.test('elapsed held slots cannot initiate charge, but remain recoverable and never cleaned as unreferenced', async () => {
    const id = await makeSlot('5 hours');
    const identity = JSON.parse(await asRole('anon', reserveSql(id)));
    const attempt = await query(`select id from private.payment_attempts where booking_id='${identity.booking_id}';`);
    await query(`update public.availability_slots set slot_date='2020-01-01',slot_time='11:00' where id='${id}';`);
    await assert.rejects(server(`select public.mark_payment_attempt_processing('${identity.booking_id}','${attempt}','location');`), /start time has passed/);
    assert.equal(await query(`select status from private.payment_attempts where id='${attempt}';`), 'reserved');
    assert.equal(JSON.parse(await server(`select public.get_payment_status('${identity.booking_id}','${identity.payment_access_token}');`)).paid, false);
    await query('select private.delete_past_availability_slots();');
    assert.equal(await asAdmin(`select count(*) from public.bookings where id='${identity.booking_id}';`), '1');
    assert.equal(await asAdmin(`select is_available from public.availability_slots where id='${id}';`), 'f');
    // Expire/release through the existing lifecycle, then prohibit reacquisition.
    await query(`update private.payment_attempts set created_at=now()-interval '2 hours' where id='${attempt}';`);
    await server('select public.expire_stale_reserved_payment_attempts();');
    await assert.rejects(server(`select public.begin_payment_attempt('${identity.booking_id}','${identity.payment_access_token}','square');`), /no longer available/);
    await query('select private.delete_past_availability_slots();');
    assert.equal(await query(`select count(*) from public.availability_slots where id='${id}';`), '1');
  });

  await t.test('submitted outcome may still settle after start; slot expiry never deletes payment history', async () => {
    const id = await makeSlot('6 hours');
    const identity = JSON.parse(await asRole('anon', reserveSql(id)));
    const attempt = await query(`select id from private.payment_attempts where booking_id='${identity.booking_id}';`);
    await server(`select public.mark_payment_attempt_processing('${identity.booking_id}','${attempt}','location');`);
    await query(`update public.availability_slots set slot_date='2020-01-02',slot_time='11:00' where id='${id}';`);
    assert.equal(JSON.parse(await server(`select public.begin_payment_attempt('${identity.booking_id}','${identity.payment_access_token}','square');`)).action, 'wait');
    await server(`select public.record_provider_payment_result('square','event-after-start','payment.updated','${identity.booking_id}','${attempt}','provider-id','location','COMPLETED',8500,'USD');`);
    await query('select private.delete_past_availability_slots();');
    assert.equal(await query(`select status from private.payment_attempts where id='${attempt}';`), 'completed');
    assert.equal(await query(`select count(*) from public.availability_slots where id='${id}';`), '1');
  });

  await t.test('cleanup deletes only elapsed unreferenced slots', async () => {
    const past = await makeSlot('-4 hours'), future = await makeSlot('7 hours');
    const count = Number(await query('select private.delete_past_availability_slots();'));
    assert.ok(count >= 1);
    assert.equal(await query(`select count(*) from public.availability_slots where id='${past}';`), '0');
    assert.equal(await query(`select count(*) from public.availability_slots where id='${future}';`), '1');
    assert.equal(await query(`select count(*) from public.bookings b left join public.availability_slots s on s.id=b.slot_id where b.slot_id is not null and s.id is null;`), '0');
  });

  await t.test('effective availability functions contain no current_date shortcuts', async () => {
    for (const name of ['public.create_booking_request','public.create_pending_payment_booking','public.begin_payment_attempt',
      'public.mark_payment_attempt_processing','public.create_availability_slots','private.delete_past_availability_slots']) {
      assert.doesNotMatch(await query(`select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname='${name}';`), /current_date/i);
    }
    assert.doesNotMatch(await query("select qual from pg_policies where tablename='availability_slots';"), /current_date/i);
  });
});
