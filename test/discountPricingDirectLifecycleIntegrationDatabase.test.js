import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const functionSql = (sql, name) => {
  const escaped = name.replaceAll(".", "\\.");
  const result = sql.match(new RegExp(`create(?: or replace)? function ${escaped}\\([^]*?\\n\\$\\$;`))?.[0];
  assert.ok(result, `Missing effective function ${name}`);
  return result;
};

// This executes the current direct-payment RPC bodies, rather than a
// reimplementation, in an isolated PostgreSQL fixture with their required
// schema dependencies. It never contacts Supabase or Square.
test("discount pricing coexists with effective direct-payment lifecycle", { timeout: 240000 }, async (t) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status !== 0) {
    t.skip("Requires Docker with local postgres:17 image.");
    return;
  }
  const container = `amanda-discount-lifecycle-${randomUUID()}`;
  const exec = (args, input) => new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
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
  for (let attempt = 0; ; attempt += 1) {
    try { await query("select 1;"); break; } catch (error) {
      if (attempt === 50) throw error;
      await delay(100);
    }
  }

  const [security, phaseOne, current, supersession, discount] = await Promise.all([
    read("20260817185300_booking_security_admin_foundation.sql"),
    read("20260818001000_direct_payment_phase_one.sql"),
    read("20260908000000_business_timezone_slot_expiry.sql"),
    read("20260906000000_payment_failure_supersession.sql"),
    read("20260914000000_discount_pricing_foundation.sql"),
  ]);
  const attempts = phaseOne.match(/create table private\.payment_attempts \([^]*?\n\);/)?.[0];
  const access = phaseOne.match(/create table private\.booking_payment_access \([^]*?\n\);/)?.[0];
  const events = phaseOne.match(/create table private\.payment_webhook_events \([^]*?\n\);/)?.[0];
  assert.ok(attempts && access && events);
  await query(`
    create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
    create function auth.uid() returns uuid language sql as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    ${security}
    create table public.services (
      id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null,
      booking_mode text not null, duration_minutes integer, price_amount integer not null,
      currency text not null default 'USD', payment_required boolean not null default true,
      is_active boolean not null default true, payment_flow text not null default 'direct_payment'
    );
    create table public.availability_slots (
      id uuid primary key default gen_random_uuid(), slot_date date not null,
      slot_time text not null, is_available boolean not null default true
    );
    create table public.bookings (
      id uuid primary key default gen_random_uuid(), service_id uuid not null references public.services(id),
      slot_id uuid references public.availability_slots(id), service_name_snapshot text not null,
      service_booking_mode_snapshot text not null, service_duration_minutes_snapshot integer,
      service_price_amount_snapshot integer not null, service_currency_snapshot text not null,
      service_payment_flow_snapshot text, status text not null, payment_status text not null,
      amount_due numeric not null, amount_paid numeric not null default 0, customer_name text not null,
      customer_email text not null, customer_phone text, customer_message text, paid_at timestamptz,
      payment_method text, payment_reference text, confirmed_at timestamptz, updated_at timestamptz default now()
    );
    create unique index bookings_one_active_booking_per_slot on public.bookings(slot_id)
      where status in ('pending','pending_payment','confirmed','completed','no_show');
    create table public.booking_email_config (id boolean primary key, admin_email text, admin_name text);
    insert into public.booking_email_config values (true, 'admin@example.test', 'Admin');
    create function public.queue_booking_email(uuid,text,text,text,jsonb) returns boolean language sql as $$ select true $$;
    create function private.slot_is_future(date,text,timestamptz default clock_timestamp()) returns boolean
      language sql as $$ select $1 >= current_date $$;
    ${access}
    ${attempts}
    ${events}
    create unique index payment_attempts_provider_payment_unique on private.payment_attempts(provider, provider_payment_id)
      where provider_payment_id is not null;
    create unique index payment_attempts_one_active_per_booking on private.payment_attempts(booking_id)
      where status in ('reserved','processing','unknown');
    ${functionSql(current, "public.create_pending_payment_booking")}
    ${functionSql(current, "public.begin_payment_attempt")}
    ${functionSql(current, "public.mark_payment_attempt_processing")}
    ${functionSql(supersession, "private.expire_payment_booking_if_current")}
    ${functionSql(supersession, "public.fail_payment_attempt")}
    ${functionSql(supersession, "public.record_provider_payment_result")}
    insert into public.services(slug,name,booking_mode,duration_minutes,price_amount)
      values ('voice','Voice Memo Reading','untimed',null,2000),
        ('private','Private Readings','timed',60,8500),
        ('wheel','Wheel of the Year','timed',60,6000);
    ${discount}
  `);

  const ids = Object.fromEntries((await query("select slug || '=' || id from public.services order by slug;")).split("\n").map((row) => row.split("=")));
  const slot = async () => query("insert into public.availability_slots(slot_date,slot_time) values (current_date + 1,'12:00') returning id;");
  const create = async (service, slotId = null) => {
    const result = await query(`select public.create_pending_payment_booking('${ids[service]}','Customer','customer@example.test',null,'Question'${slotId ? `,'${slotId}'` : ',null'});`);
    return JSON.parse(result);
  };

  await t.test("current creation creates one immutable pricing row and linked attempt for every direct service", async () => {
    const voice = await create("voice");
    const privateReading = await create("private", await slot());
    const wheel = await create("wheel", await slot());
    for (const [booking, amount] of [[voice.booking_id, 2000], [privateReading.booking_id, 8500], [wheel.booking_id, 6000]]) {
      assert.equal(await query(`select count(*) || '|' || min(final_amount_minor) from private.booking_pricing where booking_id='${booking}';`), `1|${amount}`);
      assert.equal(await query(`select count(*) || '|' || bool_and(pricing_id is not null) from private.payment_attempts where booking_id='${booking}';`), "1|true");
    }
  });

  await t.test("retry, processing, failure, completion, and linkage checks retain the same pricing", async () => {
    const voice = await create("voice");
    const first = await query(`select id from private.payment_attempts where booking_id='${voice.booking_id}';`);
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.mark_payment_attempt_processing('${voice.booking_id}','${first}','sandbox');`);
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.fail_payment_attempt('${voice.booking_id}','${first}','FAILED');`);
    const retry = JSON.parse(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.begin_payment_attempt('${voice.booking_id}','${voice.payment_access_token}','square');`));
    assert.equal(await query(`select count(distinct pricing_id) || '|' || min(amount_minor) || '|' || min(currency) from private.payment_attempts where booking_id='${voice.booking_id}';`), "1|2000|USD");
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.mark_payment_attempt_processing('${voice.booking_id}','${retry.attempt_id}','sandbox');`);
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','event-${randomUUID()}','payment.updated','${voice.booking_id}','${retry.attempt_id}','payment-${randomUUID()}','sandbox','COMPLETED',2000,'USD');`);
    assert.equal(await query(`select status || '|' || payment_status from public.bookings where id='${voice.booking_id}';`), "confirmed|paid");

    const other = await create("private", await slot());
    const otherAttempt = await query(`select id from private.payment_attempts where booking_id='${other.booking_id}';`);
    const voicePricing = await query(`select pricing_id from private.payment_attempts where booking_id='${voice.booking_id}' limit 1;`);
    await assert.rejects(query(`update private.payment_attempts set pricing_id='${voicePricing}' where id='${otherAttempt}';`), /does not match immutable/);
    await assert.rejects(query(`update private.payment_attempts set amount_minor=1 where id='${otherAttempt}';`), /does not match immutable/);
    await assert.rejects(query(`update private.payment_attempts set currency='EUR' where id='${otherAttempt}';`), /does not match immutable/);
  });
});
