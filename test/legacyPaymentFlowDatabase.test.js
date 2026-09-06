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
test("legacy payment-flow boundary in PostgreSQL", { timeout: 120000 }, async (t) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status !== 0) {
    t.skip("Requires Docker with local postgres:17 image.");
    return;
  }
  const container = `amanda-legacy-test-${randomUUID()}`;
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
  const adminId = randomUUID();
  await query(`
    create schema auth; create schema extensions;
    create role anon; create role authenticated; create role service_role;
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
      slot_time text default '12:00', is_available boolean default true
    );
    create table public.bookings (
      id uuid primary key default gen_random_uuid(), slot_id uuid references public.availability_slots,
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
  `);
  const asRole = (role, sql, user = null) => query(`set role ${role};
    set request.jwt.claims = '${JSON.stringify({ role, ...(user ? { sub: user } : {}) })}'; ${sql}`);
  const asAdmin = (sql) => asRole("authenticated", sql, adminId);
  const service = async (mode, flow) => {
    const id = randomUUID();
    await query(`insert into public.services(id,slug,name,booking_mode,duration_minutes,price_amount,payment_required,payment_flow)
      values ('${id}','service-${id}','Test service','${mode}',${mode === "timed" ? 60 : "null"},8500,${flow !== "none"},'${flow}');`);
    return id;
  };
  const slot = () => query("insert into public.availability_slots default values returning id;");
  const createSql = (serviceId, slotId = null) => `select public.create_booking_request(
    p_service_id => '${serviceId}', p_slot_id => ${slotId ? `'${slotId}'` : "null"},
    p_customer_name => ' Customer ', p_customer_email => ' Customer@Example.Test ');`;
  const snapshot = () => query(`select jsonb_build_object(
    'bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),
    'slots',(select jsonb_agg(to_jsonb(s) order by id) from public.availability_slots s),
    'emails',(select jsonb_agg(to_jsonb(e)) from public.test_emails e),
    'attempts',(select jsonb_agg(to_jsonb(a) order by id) from private.payment_attempts a));`);
  const state = async (id) => JSON.parse(await query(`select to_jsonb(b) from public.bookings b where id='${id}';`));
  const timedDirect = await service("timed", "direct_payment");
  const untimedDirect = await service("untimed", "direct_payment");
  const legacyService = await service("timed", "payment_link");

  // Preserve an actual pre-fix NULL-snapshot booking across the forward migration.
  const historicalSlot = await slot();
  const historical = await asRole("anon", createSql(legacyService, historicalSlot));
  assert.equal((await state(historical)).service_payment_flow_snapshot, null);
  await assert.rejects(asAdmin(`select public.update_booking_status('${historical}','confirmed');`), /payment provider controls/);
  const beforeMigration = await snapshot();
  await query(migration);
  assert.equal(await snapshot(), beforeMigration, "Forward migration must not rewrite historical data");

  for (const [mode, id] of [["timed", timedDirect], ["untimed", untimedDirect]]) {
    await t.test(`anon legacy RPC rejects ${mode} direct payment without side effects`, async () => {
      const slotId = mode === "timed" ? await slot() : null;
      const before = await snapshot();
      await assert.rejects(asRole("anon", createSql(id, slotId)), /Direct-payment services require/);
      assert.equal(await snapshot(), before);
    });
  }
  await t.test("authenticated and service-role callers cannot bypass the service guard", async () => {
    for (const role of ["authenticated", "service_role"]) {
      await assert.rejects(asRole(role, createSql(untimedDirect)), /Direct-payment services require/);
    }
  });
  await t.test("only the service-aware legacy overload is exposed; anon cannot mutate bookings or admin lifecycle", async () => {
    assert.equal(await query("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_booking_request';"), "1");
    await assert.rejects(asRole("anon", `update public.bookings set status='confirmed' where id='${historical}';`), /permission denied/);
    await assert.rejects(asRole("anon", `select public.cancel_booking('${historical}');`), /permission denied/);
    await assert.rejects(asRole("authenticated", `select public.cancel_booking('${historical}');`, randomUUID()), /Administrator access is required/);
  });
  for (const mode of ["timed", "untimed"]) {
    for (const flow of ["payment_link", "none"]) {
      await t.test(`${mode} ${flow} creation snapshots flow and preserves admin lifecycle`, async () => {
        const serviceId = await service(mode, flow);
        const slotId = mode === "timed" ? await slot() : null;
        const id = await asRole("anon", createSql(serviceId, slotId));
        const booking = await state(id);
        assert.equal(booking.service_payment_flow_snapshot, flow);
        assert.equal(booking.status, "pending");
        assert.equal(booking.payment_status, "unpaid");
        assert.equal(booking.amount_due, 85);
        assert.equal(booking.customer_name, "Customer");
        assert.equal(booking.customer_email, "customer@example.test");
        assert.equal(await query(`select count(*) from private.payment_attempts where booking_id='${id}';`), "0");
        assert.equal(await query(`select count(*) from public.test_emails where booking_id='${id}';`), "2");
        if (slotId) assert.equal(await query(`select is_available from public.availability_slots where id='${slotId}';`), "f");
        await asAdmin(`select public.update_booking_status('${id}','confirmed');`);
        assert.equal((await state(id)).status, "confirmed");
        await asAdmin(`select public.update_booking_payment('${id}','paid',85,85,'payment_link','test-reference');`);
        assert.equal((await state(id)).payment_status, "paid");
        await asAdmin(`select public.update_booking_status('${id}','completed');`);
        assert.equal((await state(id)).status, "completed");
        await asAdmin(`select public.update_booking_status('${id}','no_show');`);
        assert.equal((await state(id)).status, "no_show");
        await asAdmin(`select public.cancel_booking('${id}');`);
        assert.equal((await state(id)).status, "cancelled");
        if (slotId) assert.equal(await query(`select is_available from public.availability_slots where id='${slotId}';`), "t");
      });
    }
  }
  await t.test("historical NULL snapshot retains legacy admin behavior after service switches to direct payment", async () => {
    await query(`update public.services set payment_flow='direct_payment' where id='${legacyService}';`);
    await asAdmin(`select public.update_booking_status('${historical}','confirmed');`);
    assert.equal((await state(historical)).status, "confirmed");
    await asAdmin(`select public.update_booking_payment('${historical}','paid',85,85,'stripe','historical-reference');`);
    assert.equal((await state(historical)).payment_status, "paid");
    await asAdmin(`select public.cancel_booking('${historical}');`);
    assert.equal((await state(historical)).status, "cancelled");
    assert.equal((await state(historical)).service_payment_flow_snapshot, null);
    assert.equal(await query(`select is_available from public.availability_slots where id='${historicalSlot}';`), "t");
    await assert.rejects(asRole("anon", createSql(legacyService, historicalSlot)), /Direct-payment services require/);
  });
  await t.test("explicit direct-payment snapshots still reject manual confirmation and payment edits", async () => {
    const id = randomUUID();
    await query(`insert into public.bookings(id,service_id,service_name_snapshot,service_booking_mode_snapshot,
      service_price_amount_snapshot,service_currency_snapshot,service_payment_flow_snapshot,status,payment_status,
      amount_due,amount_paid,customer_name,customer_email)
      values ('${id}','${untimedDirect}','Direct','untimed',8500,'USD','direct_payment','pending_payment','unpaid',85,0,'Customer','customer@example.test');`);
    await assert.rejects(asAdmin(`select public.update_booking_status('${id}','confirmed');`), /payment provider controls/);
    await assert.rejects(asAdmin(`select public.update_booking_payment('${id}','paid',85,85,'stripe','fake');`), /Provider-controlled payment fields are read-only/);
    assert.equal((await state(id)).payment_status, "unpaid");
  });
});
