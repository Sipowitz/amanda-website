import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const functionSql = (sql, name) => {
  const match = sql.match(new RegExp(`create(?: or replace)? function ${name.replaceAll(".", "\\.")}\\([^]*?\\n\\$\\$;`))?.[0];
  assert.ok(match, `Missing effective function ${name}`);
  return match;
};

test("admin stats projection uses immutable paid booking history", { timeout: 240000 }, async (t) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status !== 0) {
    t.skip("Requires Docker with local postgres:17 image.");
    return;
  }
  const container = `amanda-admin-stats-${randomUUID()}`;
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

  const [security, stats, testClassification] = await Promise.all([
    read("20260817185300_booking_security_admin_foundation.sql"),
    read("20261002000000_admin_stats_projection.sql"),
    read("20261003000000_admin_test_booking_classification.sql"),
  ]);
  const adminId = randomUUID();
  await query(`
    create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
    create function auth.uid() returns uuid language sql as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    ${security}
    insert into auth.users values ('${adminId}');
    insert into public.admin_users(user_id) values ('${adminId}');
    create table public.email_settings (id boolean primary key, timezone text not null);
    insert into public.email_settings values (true, 'America/Chicago');
    create function public.get_business_timezone() returns text language sql stable security definer set search_path = '' as $$
      select timezone from public.email_settings where id = true
    $$;
    create table public.services (id uuid primary key, name text not null, price_amount integer not null, currency text not null);
    create table public.bookings (
      id uuid primary key default gen_random_uuid(), service_id uuid not null references public.services,
      service_name_snapshot text not null, payment_status text not null, paid_at timestamptz,
      customer_name text, customer_email text, customer_phone text, customer_message text,
      payment_reference text, payment_access_token text
    );
    create table private.booking_pricing (
      booking_id uuid primary key references public.bookings, service_id uuid not null references public.services,
      final_amount_minor integer, currency text
    );
    ${stats}
    alter table public.bookings add column is_test boolean not null default false;
    ${functionSql(testClassification, "public.get_admin_stats")}
  `);
  const asRole = (role, sql, user = null) => query(`set role ${role}; set request.jwt.claims = '${JSON.stringify({ role, ...(user ? { sub: user } : {}) })}'; ${sql}`);
  const asAdmin = (sql) => asRole("authenticated", sql, adminId);
  const asOf = "2026-07-15T12:00:00Z";
  const serviceA = randomUUID();
  const serviceB = randomUUID();
  await query(`insert into public.services values
    ('${serviceA}', 'Live service A', 999999, 'USD'),
    ('${serviceB}', 'Live service B', 999999, 'EUR');`);
  const insert = async ({ service = serviceA, name = "Frozen Reading", status = "paid", paidAt, amount = 8500, currency = "USD", pricing = true, isTest = false }) => {
    const id = randomUUID();
    await query(`insert into public.bookings(id,service_id,service_name_snapshot,payment_status,paid_at,customer_name,customer_email,customer_phone,customer_message,payment_reference,payment_access_token,is_test)
      values ('${id}','${service}','${name}','${status}',${paidAt ? `'${paidAt}'` : "null"},'Secret Customer','secret@example.test','555','private message','provider-ref','recovery-secret',${isTest});
      ${pricing ? `insert into private.booking_pricing(booking_id,service_id,final_amount_minor,currency) values ('${id}','${service}',${amount},'${currency}');` : ""}`);
    return id;
  };
  const statsAt = async (instant = asOf) => JSON.parse(await asAdmin(`select public.get_admin_stats('${instant}'::timestamptz);`));
  const total = (stats, period, currency = "USD") => stats.period_totals[period].value_by_currency
    .find((value) => value.currency === currency)?.value_minor ?? 0;
  const month = (stats, key) => stats.monthly_history.find((row) => row.month === key);

  await t.test("paid, discounted, pending, and refunded lifecycle rows are classified safely", async () => {
    await insert({ paidAt: "2026-07-15T05:30:00Z", amount: 8500 }); // July 15 Chicago
    await insert({ paidAt: "2026-07-15T06:30:00Z", amount: 6800, name: "Frozen Discounted" });
    await insert({ status: "pending", paidAt: "2026-07-15T06:30:00Z", amount: 100 });
    await insert({ status: "unpaid", paidAt: "2026-07-15T06:30:00Z", amount: 100 });
    await insert({ status: "refunded", paidAt: "2026-07-15T06:30:00Z", amount: 100 });
    await insert({ status: "part_refunded", paidAt: "2026-07-15T06:30:00Z", amount: 100 });
    const result = await statsAt();
    assert.equal(result.period_totals.today.paid_booking_count, 2);
    assert.equal(total(result, "today"), 15300, "uses frozen final amount, not live price");
    assert.equal(result.service_breakdown.find((row) => row.service_name === "Frozen Reading").paid_booking_count, 1);
    assert.equal(result.service_breakdown.find((row) => row.service_name === "Frozen Discounted").value_by_currency[0].value_minor, 6800);
    await query(`update public.services set name='Changed live name', price_amount=1 where id='${serviceA}';`);
    const unchanged = await statsAt();
    assert.equal(total(unchanged, "today"), 15300);
    assert.ok(unchanged.service_breakdown.some((row) => row.service_name === "Frozen Reading"));
  });

  await t.test("business timezone controls today, week, month, and year boundaries", async () => {
    await insert({ paidAt: "2026-07-15T04:30:00Z", amount: 100 }); // July 14 23:30 CDT
    await insert({ paidAt: "2026-07-13T04:30:00Z", amount: 200 }); // Sunday, previous Monday-start week
    await insert({ paidAt: "2026-07-01T04:30:00Z", amount: 300 }); // June 30 CDT
    await insert({ paidAt: "2026-01-01T05:30:00Z", amount: 400 }); // Dec 31 2025 CST
    const result = await statsAt();
    assert.equal(result.period_totals.today.paid_booking_count, 2, "Chicago midnight excludes 04:30Z");
    assert.equal(total(result, "week"), 15400, "Monday-start week includes Tuesday but excludes the prior Sunday");
    assert.equal(total(result, "month"), 15600, "Chicago month includes July dates but excludes June 30 local");
    assert.equal(total(result, "year"), 15900, "Chicago year excludes Dec 31 local");
    assert.equal(result.week_starts_on, "monday");
  });

  await t.test("monthly history is a complete 12-month business-calendar series", async () => {
    const result = await statsAt();
    assert.equal(result.monthly_history.length, 12);
    assert.deepEqual(result.monthly_history.map((row) => row.month), [
      "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
    ]);
    assert.equal(month(result, "2026-02").paid_booking_count, 0);
    assert.deepEqual(month(result, "2026-02").value_by_currency, []);
  });

  await t.test("missing paid_at or immutable pricing is surfaced and never reconstructed", async () => {
    await insert({ paidAt: null, amount: 7777 });
    await insert({ paidAt: "2026-07-15T07:00:00Z", pricing: false });
    const result = await statsAt();
    const exceptions = Object.fromEntries(result.data_integrity_exceptions.map((row) => [row.reason, row.paid_booking_count]));
    assert.equal(exceptions.missing_paid_at, 1);
    assert.equal(exceptions.missing_immutable_pricing, 1);
    assert.equal(total(result, "all_time"), 16300, "invalid paid rows are excluded rather than priced from services");
  });

  await t.test("authorization and response contain no customer or payment secrets", async () => {
    await assert.rejects(asRole("authenticated", `select public.get_admin_stats('${asOf}'::timestamptz);`, randomUUID()), /Administrator access is required/);
    const raw = await asAdmin(`select public.get_admin_stats('${asOf}'::timestamptz);`);
    for (const secret of ["Secret Customer", "secret@example.test", "private message", "provider-ref", "recovery-secret", "payment_access_token", "booking_id"]) {
      assert.doesNotMatch(raw, new RegExp(secret));
    }
  });

  await t.test("an arbitrary new service is grouped by its frozen name while test bookings remain excluded", async () => {
    const genericService = randomUUID();
    await query(`insert into public.services values ('${genericService}','Current Generic Name',4200,'USD');`);
    await insert({ service: genericService, name: "Frozen Generic Session", paidAt: "2026-07-15T08:00:00Z", amount: 4200 });
    await insert({ service: genericService, name: "Frozen Generic Session", paidAt: "2026-07-15T09:00:00Z", amount: 4200, isTest: true });
    await query(`update public.services set name='Renamed Current Generic',price_amount=9900 where id='${genericService}';`);
    const result = await statsAt();
    const row = result.service_breakdown.find((item) => item.service_id === genericService);
    assert.equal(row.service_name, "Frozen Generic Session");
    assert.equal(row.paid_booking_count, 1);
    assert.equal(row.value_by_currency[0].value_minor, 4200);
  });
});
