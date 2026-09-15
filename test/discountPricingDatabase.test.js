import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

test("discount pricing foundation is authoritative, immutable, and admin-guarded", { timeout: 240000 }, async (t) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status !== 0) {
    t.skip("Requires Docker with local postgres:17 image.");
    return;
  }
  const container = `amanda-discounts-test-${randomUUID()}`;
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

  const [security, migration, adminPricingProjection] = await Promise.all([
    read("20260817185300_booking_security_admin_foundation.sql"),
    read("20260914000000_discount_pricing_foundation.sql"),
    read("20260915003000_admin_booking_pricing_projection.sql"),
  ]);
  const adminId = randomUUID();
  const userId = randomUUID();
  await query(`
    create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
    create function auth.uid() returns uuid language sql as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    ${security}
    insert into auth.users values ('${adminId}'), ('${userId}');
    insert into public.admin_users(user_id) values ('${adminId}');
    create table public.services (
      id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null,
      booking_mode text not null, duration_minutes integer, price_amount integer not null,
      currency text not null default 'USD', payment_required boolean not null default true,
      is_active boolean not null default true, display_order integer not null default 0,
      payment_flow text not null default 'direct_payment'
    );
    create table public.bookings (
      id uuid primary key default gen_random_uuid(), service_id uuid not null references public.services(id),
      service_name_snapshot text not null, service_booking_mode_snapshot text not null,
      service_duration_minutes_snapshot integer, service_price_amount_snapshot integer not null,
      service_currency_snapshot text not null, service_payment_flow_snapshot text,
      status text not null, payment_status text not null, amount_due numeric not null, amount_paid numeric not null default 0,
      customer_name text not null default 'Customer', customer_email text not null default 'customer@example.test'
    );
    create table private.payment_attempts (
      id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id),
      provider text not null default 'square', status text not null default 'reserved',
      amount_minor integer not null, currency text not null, idempotency_key text not null default gen_random_uuid()::text
    );
    insert into public.services(slug,name,booking_mode,duration_minutes,price_amount,display_order)
    values ('private-readings','Private Reading','timed',60,8500,1),
      ('wheel-of-the-year','Wheel of the Year','timed',60,6000,2),
      ('voice-memo-reading','Voice Memo Reading','untimed',null,2000,3);
    insert into public.bookings(service_id,service_name_snapshot,service_booking_mode_snapshot,service_duration_minutes_snapshot,
      service_price_amount_snapshot,service_currency_snapshot,service_payment_flow_snapshot,status,payment_status,amount_due)
    select id,name,booking_mode,duration_minutes,price_amount,currency,'direct_payment','pending_payment','unpaid',price_amount::numeric/100
    from public.services where slug = 'private-readings';
    insert into private.payment_attempts(booking_id,amount_minor,currency)
    select id,8500,'USD' from public.bookings;
  `);

  await query(`insert into public.bookings(service_id,service_name_snapshot,service_booking_mode_snapshot,service_duration_minutes_snapshot,
    service_price_amount_snapshot,service_currency_snapshot,service_payment_flow_snapshot,status,payment_status,amount_due)
    select id,name,booking_mode,duration_minutes,8500,currency,'direct_payment','confirmed','paid',85.004
    from public.services where slug = 'private-readings';`);
  await assert.rejects(query(`begin; ${migration} commit;`), /Cannot safely backfill pricing for every direct-payment booking/);
  assert.equal(await query("select to_regclass('private.booking_pricing') is null and to_regclass('private.discount_codes') is null;"), "t");
  await query("delete from public.bookings where amount_due = 85.004;");
  await query(`begin; ${migration} commit; ${adminPricingProjection}`);

  const ids = Object.fromEntries((await query("select slug || '=' || id from public.services order by slug;")).split("\n").map((line) => line.split("=")));
  const initialUndiscountedBooking = await query(`select booking_id from private.booking_pricing
    where original_amount_minor = 8500 and discount_amount_minor = 0 limit 1;`);
  const admin = (sql) => query(`set role authenticated; set request.jwt.claims = '${JSON.stringify({ role: "authenticated", sub: adminId })}'; ${sql}`);
  const ordinary = (sql) => query(`set role authenticated; set request.jwt.claims = '${JSON.stringify({ role: "authenticated", sub: userId })}'; ${sql}`);
  const anonymous = (sql) => query(`set role anon; set request.jwt.claims = '{"role":"anon"}'; ${sql}`);
  const serviceRole = (sql) => query(`set role service_role; set request.jwt.claims = '{"role":"service_role"}'; ${sql}`);

  await t.test("canonical codes, percentage bounds, and scope validation are enforced", async () => {
    const welcome = await admin(`select public.create_admin_discount_code('  welcome20  ',20,'selected',array['${ids["private-readings"]}'::uuid]);`);
    assert.match(welcome, /^[0-9a-f-]{36}$/);
    assert.equal(await query(`select code || '|' || percentage_off || '|' || scope from private.discount_codes where id='${welcome}';`), "WELCOME20|20|selected");
    await assert.rejects(admin("select public.create_admin_discount_code('welcome20',20,'all');"), /duplicate key/);
    await assert.rejects(admin("select public.create_admin_discount_code('bad code!',20,'all');"), /Discount codes must use/);
    await assert.rejects(admin("select public.create_admin_discount_code(repeat('A',33),20,'all');"), /Discount codes must use/);
    const low = await admin("select public.create_admin_discount_code('ONE',1,'all');");
    const high = await admin("select public.create_admin_discount_code('NINETYNINE',99,'all');");
    assert.match(low, /^[0-9a-f-]{36}$/); assert.match(high, /^[0-9a-f-]{36}$/);
    for (const percentage of [0, 100, -1]) {
      await assert.rejects(admin(`select public.create_admin_discount_code('P${percentage}',${percentage},'all');`), /between 1 and 99/);
    }
    await assert.rejects(admin("select public.create_admin_discount_code('EMPTY',10,'selected');"), /require at least one service/);
    await assert.rejects(admin(`select public.create_admin_discount_code('MISSING',10,'selected',array['${randomUUID()}'::uuid]);`), /does not exist/);
    const all = await admin("select public.create_admin_discount_code('ALL15',15,'all');");
    assert.equal(await query(`select scope from private.discount_codes where id='${all}';`), "all");
    await admin(`select public.set_admin_discount_code_enabled('${all}',false);`);
    assert.equal(await query(`select enabled || '|' || revision from private.discount_codes where id='${all}';`), "false|2");
    await admin(`select public.set_admin_discount_code_enabled('${all}',true);`);
    assert.equal(await query(`select enabled || '|' || revision from private.discount_codes where id='${all}';`), "true|3");
    await assert.rejects(query(`update private.discount_codes set code = 'RENAMED' where id = '${welcome}';`), /immutable/);
  });

  await t.test("integer pricing handles catalogue amounts and half-cent ties", async () => {
    assert.equal(await query("select discount_amount_minor || '|' || final_amount_minor from private.calculate_percentage_discount(2000,25);"), "500|1500");
    assert.equal(await query("select discount_amount_minor || '|' || final_amount_minor from private.calculate_percentage_discount(6000,33);"), "1980|4020");
    assert.equal(await query("select discount_amount_minor || '|' || final_amount_minor from private.calculate_percentage_discount(8500,20);"), "1700|6800");
    assert.equal(await query("select discount_amount_minor || '|' || final_amount_minor from private.calculate_percentage_discount(5,50);"), "3|2");
    const priced = await query(`select original_amount_minor || '|' || discount_amount_minor || '|' || final_amount_minor || '|' || discount_code || '|' || percentage_off from private.calculate_discount_pricing('${ids["private-readings"]}',' welcome20 ');`);
    assert.equal(priced, "8500|1700|6800|WELCOME20|20");
    await assert.rejects(query(`select * from private.calculate_discount_pricing('${ids["wheel-of-the-year"]}','WELCOME20');`), /does not apply/);
    await query(`update public.services set is_active = false where id = '${ids["private-readings"]}';`);
    await assert.rejects(query(`select * from private.calculate_discount_pricing('${ids["private-readings"]}','WELCOME20');`), /unavailable/);
    await query(`update public.services set is_active = true where id = '${ids["private-readings"]}';`);
    await assert.rejects(query(`select * from private.calculate_discount_pricing('${ids["private-readings"]}','UNKNOWN');`), /unavailable/);
    await query("update private.discount_codes set expires_at = now() - interval '1 minute' where code = 'ALL15';");
    await assert.rejects(query(`select * from private.calculate_discount_pricing('${ids["private-readings"]}','ALL15');`), /unavailable/);
  });

  await t.test("backfilled and new undiscounted direct payments receive immutable pricing", async () => {
    assert.equal(await query("select original_amount_minor || '|' || discount_amount_minor || '|' || final_amount_minor from private.booking_pricing;"), "8500|0|8500");
    assert.equal(await query("select amount_minor || '|' || (pricing_id is not null)::text from private.payment_attempts;"), "8500|true");
    const booking = await query(`insert into public.bookings(service_id,service_name_snapshot,service_booking_mode_snapshot,service_price_amount_snapshot,service_currency_snapshot,service_payment_flow_snapshot,status,payment_status,amount_due)
      values ('${ids["voice-memo-reading"]}','Voice Memo Reading','untimed',2000,'USD','direct_payment','pending_payment','unpaid',20) returning id;`);
    await query(`insert into private.payment_attempts(booking_id,amount_minor,currency) values ('${booking}',2000,'USD');`);
    assert.equal(await query(`select original_amount_minor || '|' || discount_amount_minor || '|' || final_amount_minor from private.booking_pricing where booking_id='${booking}';`), "2000|0|2000");
    assert.equal(await query(`select pricing_id is not null from private.payment_attempts where booking_id='${booking}';`), "t");
    await assert.rejects(query(`update private.booking_pricing set final_amount_minor=1 where booking_id='${booking}';`), /immutable/);
  });

  await t.test("definition changes do not rewrite historical discount snapshots", async () => {
    const code = await admin("select public.create_admin_discount_code('HISTORY20',20,'all');");
    const booking = await query(`insert into public.bookings(service_id,service_name_snapshot,service_booking_mode_snapshot,service_price_amount_snapshot,service_currency_snapshot,service_payment_flow_snapshot,status,payment_status,amount_due)
      values ('${ids["private-readings"]}','Private Reading','timed',8500,'USD','payment_link','confirmed','paid',68) returning id;`);
    await query(`insert into private.booking_pricing(booking_id,service_id,original_amount_minor,discount_amount_minor,final_amount_minor,currency,discount_code_id,discount_code_snapshot,discount_percentage_snapshot,discount_code_revision)
      values ('${booking}','${ids["private-readings"]}',8500,1700,6800,'USD','${code}','HISTORY20',20,1);`);
    await admin(`select public.update_admin_discount_code('${code}',30,'all',array[]::uuid[],false);`);
    assert.equal(await query(`select discount_code_snapshot || '|' || discount_percentage_snapshot || '|' || final_amount_minor from private.booking_pricing where booking_id='${booking}';`), "HISTORY20|20|6800");
    assert.equal(await query(`select code || '|' || percentage_off || '|' || enabled || '|' || revision from private.discount_codes where id='${code}';`), "HISTORY20|30|false|2");
    await assert.rejects(query(`select * from private.calculate_discount_pricing('${ids["private-readings"]}','HISTORY20');`), /unavailable/);
  });

  await t.test("admin booking pricing is a minimal immutable protected projection", async () => {
    const discountedCode = await admin("select public.create_admin_discount_code('ADMINHISTORY20',20,'all');");
    const discountedBooking = await query(`insert into public.bookings(service_id,service_name_snapshot,service_booking_mode_snapshot,service_price_amount_snapshot,service_currency_snapshot,service_payment_flow_snapshot,status,payment_status,amount_due)
      values ('${ids["private-readings"]}','Private Reading','timed',8500,'USD','payment_link','confirmed','paid',68) returning id;`);
    await query(`insert into private.booking_pricing(booking_id,service_id,original_amount_minor,discount_amount_minor,final_amount_minor,currency,discount_code_id,discount_code_snapshot,discount_percentage_snapshot,discount_code_revision)
      values ('${discountedBooking}','${ids["private-readings"]}',8500,1700,6800,'USD','${discountedCode}','ADMINHISTORY20',20,1);`);

    await assert.rejects(anonymous("select * from public.get_admin_booking_pricing();"), /permission denied/);
    await assert.rejects(ordinary("select * from public.get_admin_booking_pricing();"), /Administrator access is required/);

    const columns = await admin(`select string_agg(key, '|' order by key)
      from jsonb_object_keys(to_jsonb((select result from public.get_admin_booking_pricing() result limit 1))) as key;`);
    assert.equal(columns, "booking_id|currency|discount_amount_minor|discount_code_snapshot|discount_percentage_snapshot|final_amount_minor|original_amount_minor");

    const projection = await admin(`select original_amount_minor || '|' || discount_code_snapshot || '|' || discount_percentage_snapshot || '|' || discount_amount_minor || '|' || final_amount_minor || '|' || currency
      from public.get_admin_booking_pricing() where booking_id='${discountedBooking}';`);
    assert.equal(projection, "8500|ADMINHISTORY20|20|1700|6800|USD");
    assert.equal(await serviceRole(`select final_amount_minor from public.get_admin_booking_pricing() where booking_id='${discountedBooking}';`), "6800");

    await query(`update public.services set price_amount=9900 where id='${ids["private-readings"]}';`);
    await admin(`select public.update_admin_discount_code('${discountedCode}',35,'all',array[]::uuid[],false);`);
    const afterChanges = await admin(`select original_amount_minor || '|' || discount_code_snapshot || '|' || discount_percentage_snapshot || '|' || discount_amount_minor || '|' || final_amount_minor || '|' || currency
      from public.get_admin_booking_pricing() where booking_id='${discountedBooking}';`);
    assert.equal(afterChanges, "8500|ADMINHISTORY20|20|1700|6800|USD");

    const undiscounted = await admin(`select original_amount_minor || '|' || coalesce(discount_code_snapshot, 'NULL') || '|' || coalesce(discount_percentage_snapshot::text, 'NULL') || '|' || discount_amount_minor || '|' || final_amount_minor || '|' || currency
      from public.get_admin_booking_pricing() where booking_id='${initialUndiscountedBooking}';`);
    assert.equal(undiscounted, "8500|NULL|NULL|0|8500|USD");
  });

  await t.test("private definitions and records remain inaccessible to browser roles", async () => {
    await assert.rejects(anonymous("select * from private.discount_codes;"), /permission denied/);
    await assert.rejects(anonymous("select * from private.discount_code_services;"), /permission denied/);
    await assert.rejects(anonymous("select * from private.booking_pricing;"), /permission denied/);
    await assert.rejects(anonymous("select public.get_admin_discount_codes();"), /permission denied/);
    await assert.rejects(anonymous("select public.create_admin_discount_code('ANON',10,'all');"), /permission denied/);
    await assert.rejects(ordinary("select public.get_admin_discount_codes();"), /Administrator access is required/);
    await assert.rejects(ordinary("select public.create_admin_discount_code('NOPE',10,'all');"), /Administrator access is required/);
    await assert.rejects(ordinary("insert into private.discount_code_services(discount_code_id,service_id) values (gen_random_uuid(),gen_random_uuid());"), /permission denied/);
    await assert.rejects(ordinary("insert into private.booking_pricing(booking_id,service_id,original_amount_minor,final_amount_minor,currency) values (gen_random_uuid(),gen_random_uuid(),1,1,'USD');"), /permission denied/);
    await assert.rejects(ordinary("update private.booking_pricing set final_amount_minor = 1;"), /permission denied/);
    await assert.rejects(ordinary("delete from private.booking_pricing;"), /permission denied/);
    await assert.rejects(ordinary("insert into private.discount_redemptions(discount_code_id,booking_id,booking_pricing_id,completed_payment_attempt_id) values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());"), /permission denied/);
    await assert.rejects(ordinary("update private.payment_attempts set pricing_id = null;"), /permission denied/);
    const listed = await admin("select code || '|' || uses from public.get_admin_discount_codes() where code='WELCOME20';");
    assert.equal(listed, "WELCOME20|0");
  });
});
