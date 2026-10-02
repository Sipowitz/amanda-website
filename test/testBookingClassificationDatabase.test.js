import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

test("test booking classification is an admin-only reporting mutation", { timeout: 240000 }, async (t) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status !== 0) {
    t.skip("Requires Docker with local postgres:17 image.");
    return;
  }
  const container = `amanda-test-classification-${randomUUID()}`;
  const exec = (args, input) => new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { error += data; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(input);
  });
  await exec(["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]);
  t.after(() => exec(["rm", "-f", container]));
  const query = (sql) => exec(["exec", "-i", "-e", "PGOPTIONS=-c statement_timeout=10000", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-XqAt", "-v", "ON_ERROR_STOP=1"], sql);
  for (let i = 0; ; i += 1) { try { await query("select 1"); break; } catch (error) { if (i === 50) throw error; await delay(100); } }

  const [security, migration] = await Promise.all([
    read("20260817185300_booking_security_admin_foundation.sql"),
    read("20261003000000_admin_test_booking_classification.sql"),
  ]);
  const adminId = randomUUID(); const userId = randomUUID(); const serviceId = randomUUID(); const slotId = randomUUID();
  await query(`
    create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
    create function auth.uid() returns uuid language sql as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    ${security}
    insert into auth.users values ('${adminId}'), ('${userId}'); insert into public.admin_users(user_id) values ('${adminId}');
    create table public.email_settings(id boolean primary key, timezone text not null); insert into public.email_settings values(true, 'America/Chicago');
    create function public.get_business_timezone() returns text language sql stable security definer set search_path = '' as $$ select timezone from public.email_settings where id $$;
    create table public.services(id uuid primary key, name text not null);
    create table public.availability_slots(id uuid primary key);
    create table public.bookings(
      id uuid primary key default extensions.gen_random_uuid(), service_id uuid not null references public.services,
      service_name_snapshot text not null, status text not null, payment_status text not null, paid_at timestamptz,
      amount_paid numeric, slot_id uuid references public.availability_slots, customer_name text, customer_email text
    );
    create table private.booking_pricing(id uuid primary key, booking_id uuid unique references public.bookings, service_id uuid not null, final_amount_minor integer, currency text);
    create table private.payment_attempts(id uuid primary key, booking_id uuid references public.bookings, provider text, provider_payment_id text);
    create table private.discount_codes(id uuid primary key, code text not null, percentage_off integer, scope text, enabled boolean, expires_at timestamptz, revision integer, created_at timestamptz default now());
    create table private.discount_code_services(discount_code_id uuid, service_id uuid);
    create table private.discount_redemptions(id uuid primary key, discount_code_id uuid, booking_id uuid, booking_pricing_id uuid, completed_payment_attempt_id uuid);
    create table public.booking_email_log(id uuid primary key, booking_id uuid);
    ${migration}
  `);
  const asRole = (role, sql, id = null) => query(`set role ${role}; set request.jwt.claims = '${JSON.stringify({ role, ...(id ? { sub: id } : {}) })}'; ${sql}`);
  const asAdmin = (sql) => asRole("authenticated", sql, adminId);
  const bookingId = randomUUID(); const pricingId = randomUUID(); const attemptId = randomUUID(); const discountId = randomUUID(); const redemptionId = randomUUID(); const emailId = randomUUID();
  await query(`
    insert into public.services values ('${serviceId}', 'Current renamed service'); insert into public.availability_slots values ('${slotId}');
    insert into public.bookings(id,service_id,service_name_snapshot,status,payment_status,paid_at,amount_paid,slot_id,customer_name,customer_email)
      values ('${bookingId}','${serviceId}','Frozen historical service','confirmed','paid','2026-07-15T06:30:00Z',85,'${slotId}','Customer','customer@example.test');
    insert into private.booking_pricing values ('${pricingId}','${bookingId}','${serviceId}',8500,'USD');
    insert into private.payment_attempts values ('${attemptId}','${bookingId}','square','square-payment');
    insert into private.discount_codes(id,code,percentage_off,scope,enabled,revision) values ('${discountId}','TEST',20,'all',true,1);
    insert into private.discount_redemptions values ('${redemptionId}','${discountId}','${bookingId}','${pricingId}','${attemptId}');
    insert into public.booking_email_log values ('${emailId}','${bookingId}');
  `);
  const stats = () => asAdmin("select public.get_admin_stats('2026-07-15T12:00:00Z');").then(JSON.parse);
  const uses = () => asAdmin("select uses from public.get_admin_discount_codes() where code='TEST';").then(Number);
  const total = (result) => result.period_totals.today.value_by_currency[0]?.value_minor ?? 0;

  await t.test("defaults are real and non-admin cannot classify", async () => {
    assert.equal(await query(`select is_test from public.bookings where id='${bookingId}'`), "f");
    const newBookingId = randomUUID();
    await query(`insert into public.bookings(id,service_id,service_name_snapshot,status,payment_status,amount_paid) values ('${newBookingId}','${serviceId}','New booking','pending','unpaid',0);`);
    assert.equal(await query(`select is_test from public.bookings where id='${newBookingId}'`), "f");
    await assert.rejects(asRole("authenticated", `select public.set_booking_test_classification('${bookingId}', true)`, userId), /Administrator access is required/);
  });
  await t.test("classification updates only is_test and safely removes/restores aggregates", async () => {
    const before = await query(`select row_to_json(x) from (select status,payment_status,paid_at,amount_paid,slot_id from public.bookings where id='${bookingId}') x`);
    const pricingBefore = await query(`select row_to_json(x) from (select id,booking_id,service_id,final_amount_minor,currency from private.booking_pricing where booking_id='${bookingId}') x`);
    const attemptBefore = await query(`select row_to_json(x) from (select id,booking_id,provider,provider_payment_id from private.payment_attempts where booking_id='${bookingId}') x`);
    assert.equal((await stats()).period_totals.today.paid_booking_count, 1); assert.equal(total(await stats()), 8500); assert.equal(await uses(), 1);
    await asAdmin(`select public.set_booking_test_classification('${bookingId}', true)`);
    assert.equal(await query(`select is_test from public.bookings where id='${bookingId}'`), "t");
    assert.equal(await query(`select row_to_json(x) from (select status,payment_status,paid_at,amount_paid,slot_id from public.bookings where id='${bookingId}') x`), before);
    assert.equal(await query(`select row_to_json(x) from (select id,booking_id,service_id,final_amount_minor,currency from private.booking_pricing where booking_id='${bookingId}') x`), pricingBefore);
    assert.equal(await query(`select row_to_json(x) from (select id,booking_id,provider,provider_payment_id from private.payment_attempts where booking_id='${bookingId}') x`), attemptBefore);
    assert.equal(await query(`select count(*) from private.discount_redemptions where id='${redemptionId}'`), "1");
    assert.equal(await query(`select count(*) from public.booking_email_log where booking_id='${bookingId}'`), "1");
    const excluded = await stats(); assert.equal(excluded.period_totals.today.paid_booking_count, 0); assert.equal(total(excluded), 0);
    assert.equal(excluded.monthly_history.find((row) => row.month === "2026-07").paid_booking_count, 0); assert.deepEqual(excluded.service_breakdown, []); assert.equal(await uses(), 0);
    await asAdmin(`select public.set_booking_test_classification('${bookingId}', false)`);
    const restored = await stats(); assert.equal(restored.period_totals.today.paid_booking_count, 1); assert.equal(total(restored), 8500);
    assert.equal(restored.monthly_history.find((row) => row.month === "2026-07").paid_booking_count, 1); assert.equal(restored.service_breakdown[0].service_name, "Frozen historical service"); assert.equal(await uses(), 1);
  });
  await t.test("test paid rows are not reported as integrity exceptions", async () => {
    const badId = randomUUID();
    await query(`insert into public.bookings(id,service_id,service_name_snapshot,status,payment_status,paid_at,amount_paid,is_test) values ('${badId}','${serviceId}','Bad historical','confirmed','paid',null,1,true);`);
    assert.deepEqual((await stats()).data_integrity_exceptions, []);
  });
});
