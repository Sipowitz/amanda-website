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
test("admin booking/slot permission boundary in PostgreSQL", { timeout: 240000 }, async (t) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status !== 0) {
    t.skip("Requires Docker with local postgres:17 image.");
    return;
  }
  const container = `amanda-permissions-test-${randomUUID()}`;
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
  const asRole = (role, sql, user = null) => query(`set role ${role};
    set request.jwt.claims = '${JSON.stringify({ role, ...(user ? { sub: user } : {}) })}'; ${sql}`);
  const asAdmin = (sql) => asRole("authenticated", sql, adminId);
  const service = async (mode, flow) => {
    const id = randomUUID();
    await query(`insert into public.services(id,slug,name,booking_mode,duration_minutes,price_amount,payment_required,payment_flow)
      values ('${id}','service-${id}','Test service','${mode}',${mode === "timed" ? 60 : "null"},8500,${flow !== "none"},'${flow}');`);
    return id;
  };
  let slotDay = 1;
  const slot = () => query(`insert into public.availability_slots(slot_date) values(current_date + ${slotDay++}) returning id;`);
  const createSql = (serviceId, slotId = null) => `select public.create_booking_request(
    p_service_id => '${serviceId}', p_slot_id => ${slotId ? `'${slotId}'` : "null"},
    p_customer_name => ' Customer ', p_customer_email => ' Customer@Example.Test ');`;
  const snapshot = () => query(`select jsonb_build_object(
    'bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),
    'slots',(select jsonb_agg(to_jsonb(s) order by id) from public.availability_slots s),
    'emails',(select jsonb_agg(to_jsonb(e)) from public.test_emails e),
    'attempts',(select jsonb_agg(to_jsonb(a) order by id) from private.payment_attempts a));`);
  const state = async (id) => JSON.parse(await query(`select to_jsonb(b) from public.bookings b where id='${id}';`));
  const directService = await service("timed", "direct_payment");
  const legacyService = await service("timed", "payment_link");
  const server = (sql) => asRole("service_role", sql);
  const reserve = async () => {
    const slotId = await slot();
    const identity = JSON.parse(await asRole("anon", `select public.create_pending_payment_booking(
      '${directService}','Customer','customer@example.test',null,null,'${slotId}');`));
    const attemptId = await query(`select id from private.payment_attempts where booking_id='${identity.booking_id}';`);
    return { id: identity.booking_id, token: identity.payment_access_token, attemptId, slotId };
  };
  const processing = (b) => server(`select public.mark_payment_attempt_processing('${b.id}','${b.attemptId}','test-location');`);
  const complete = (b) => server(`select public.record_provider_payment_result('square',null,'api.create_payment',
    '${b.id}','${b.attemptId}','payment-${b.id}','test-location','COMPLETED',8500,'USD');`);
  const held = await reserve();
  assert.equal(await query("select has_table_privilege('authenticated','public.bookings','UPDATE');"), "t");
  const before = await snapshot();
  await query(permissions);
  assert.equal(await snapshot(), before, "Permission migration must not change booking/payment data");

  await t.test("effective grants and policies allow reads only for browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["bookings", "availability_slots"]) {
        assert.equal(await query(`select bool_or(has_table_privilege('${role}','public.${table}', privilege))
          from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege;`), "f");
      }
    }
    assert.equal(await query(`select count(*) from pg_policies where schemaname='public'
      and tablename in ('bookings','availability_slots') and cmd <> 'SELECT';`), "0");
    assert.equal(await asAdmin(`select count(*) from public.bookings where id='${held.id}';`), "1");
    assert.equal(await asAdmin(`select count(*) from public.availability_slots where id='${held.slotId}';`), "1");
    assert.equal(await asAdmin(`select count(*) from public.get_admin_direct_payment_states() where booking_id='${held.id}';`), "1");
    assert.equal(await asRole("authenticated", "select count(*) from public.bookings;", randomUUID()), "0");
    assert.equal(await asRole("anon", `select count(*) from public.availability_slots where id='${held.slotId}';`), "0");
    assert.equal(await query("select has_table_privilege('service_role','public.bookings','UPDATE') and has_table_privilege('service_role','public.availability_slots','UPDATE');"), "t");
  });
  for (const [label, role, user] of [["anon","anon",null], ["ordinary user","authenticated",randomUUID()], ["admin","authenticated",adminId]]) {
    await t.test(`${label} cannot forge state, rewrite snapshots, delete evidence, or modify owned slots directly`, async () => {
      const beforeWrites = await snapshot();
      for (const sql of [
        `update public.bookings set status='confirmed',payment_status='paid',amount_paid=85 where id='${held.id}'`,
        `update public.bookings set payment_reference='fake',payment_method='square',paid_at=now() where id='${held.id}'`,
        `update public.bookings set service_payment_flow_snapshot='payment_link' where id='${held.id}'`,
        `update public.bookings set service_payment_flow_snapshot=null where id='${held.id}'`,
        `update public.bookings set status='cancelled',slot_id=null where id='${held.id}'`,
        `delete from public.bookings where id='${held.id}'`,
        `insert into public.bookings select * from public.bookings where id='${held.id}'`,
        `update public.availability_slots set is_available=true where id='${held.slotId}'`,
        `update public.availability_slots set id=gen_random_uuid(),slot_date=current_date+300,slot_time='13:00' where id='${held.slotId}'`,
        `delete from public.availability_slots where id='${held.slotId}'`,
        `insert into public.availability_slots(slot_date,slot_time) values(current_date+400,'12:00')`,
        `truncate public.bookings cascade`,
        `truncate public.availability_slots cascade`,
      ]) await assert.rejects(asRole(role, sql, user), /permission denied/);
      assert.equal(await snapshot(), beforeWrites);
    });
  }
  await t.test("slot RPCs reject non-admin callers and caller-owned availability/IDs", async () => {
    for (const [role,user] of [["anon",null],["authenticated",randomUUID()]]) {
      await assert.rejects(asRole(role, "select public.create_availability_slots('[]');", user), /permission denied|Administrator access/);
      await assert.rejects(asRole(role, `select public.delete_availability_slot('${held.slotId}');`, user), /permission denied|Administrator access/);
    }
    for (const extra of ["is_available", "id"]) {
      await assert.rejects(asAdmin(`select public.create_availability_slots(jsonb_build_array(jsonb_build_object(
        'slot_date',current_date+20,'slot_time','12:00','${extra}','false')));`), /only a valid date/);
    }
  });
  await t.test("slot creation is idempotent and cannot reopen or overwrite reserved inventory", async () => {
    const values = await query(`select jsonb_build_array(jsonb_build_object('slot_date',slot_date,'slot_time',slot_time),
      jsonb_build_object('slot_date',current_date+500,'slot_time','09:00')) from public.availability_slots where id='${held.slotId}';`);
    assert.equal(await asAdmin(`select public.create_availability_slots('${values}');`), "1");
    assert.equal(await asAdmin(`select public.create_availability_slots('${values}');`), "0");
    assert.equal(await query(`select is_available from public.availability_slots where id='${held.slotId}';`), "f");
    const free = await query("select id from public.availability_slots where slot_date=current_date+500;");
    assert.equal(await asAdmin(`select public.delete_availability_slot('${free}');`), "t");
    assert.equal(await asAdmin(`select public.delete_availability_slot('${free}');`), "f");
    await assert.rejects(asAdmin(`select public.delete_availability_slot('${held.slotId}');`), /booking history/);
  });
  await t.test("protected reservation cancellation works and preserves booking/attempt history", async () => {
    const b = await reserve();
    await asAdmin(`select public.cancel_booking('${b.id}');`);
    assert.equal((await state(b.id)).status, "cancelled");
    assert.equal(await query(`select status from private.payment_attempts where id='${b.attemptId}';`), "cancelled");
    assert.equal(await query(`select is_available from public.availability_slots where id='${b.slotId}';`), "t");
    await assert.rejects(asAdmin(`select public.delete_availability_slot('${b.slotId}');`), /booking history/);
  });
  await t.test("server payment lifecycle works; submitted, unknown and settled bookings cannot be cancelled or deleted by admin", async () => {
    await processing(held);
    for (const stage of ["processing","unknown","completed"]) {
      if (stage === "unknown") await server(`select public.mark_payment_attempt_unknown('${held.id}','${held.attemptId}');`);
      if (stage === "completed") await complete(held);
      await assert.rejects(asAdmin(`select public.cancel_booking('${held.id}');`), /cannot be cancelled|Only an awaiting/);
      await assert.rejects(asAdmin(`select public.delete_availability_slot('${held.slotId}');`), /booking history/);
      await assert.rejects(asAdmin(`delete from public.bookings where id='${held.id}';`), /permission denied/);
      await assert.rejects(asAdmin(`update public.availability_slots set is_available=true where id='${held.slotId}';`), /permission denied/);
    }
    assert.equal((await state(held.id)).payment_status, "paid");
    assert.equal(await query(`select status from private.payment_attempts where id='${held.attemptId}';`), "completed");
    await asAdmin(`select public.update_booking_status('${held.id}','completed');`);
    assert.equal((await state(held.id)).status, "completed");
    const noShow = await reserve();
    await processing(noShow); await complete(noShow);
    await asAdmin(`select public.update_booking_status('${noShow.id}','no_show');`);
    assert.equal((await state(noShow.id)).status, "no_show");
  });
  await t.test("admin cannot invoke provider-only RPCs or manually settle a reservation", async () => {
    const b = await reserve();
    await assert.rejects(asAdmin(`select public.mark_payment_attempt_processing('${b.id}','${b.attemptId}','test-location');`), /permission denied/);
    await assert.rejects(asAdmin(`select public.update_booking_status('${b.id}','confirmed');`), /payment provider controls/);
    await assert.rejects(asAdmin(`select public.update_booking_payment('${b.id}','paid',85,85,'stripe','fake');`), /Provider-controlled/);
  });
  await t.test("legacy administration and historical NULL snapshots retain their RPC lifecycle", async () => {
    for (const historical of [false,true]) {
      const slotId = await slot();
      const id = await asRole("anon", createSql(legacyService, slotId));
      if (historical) await query(`update public.bookings set service_payment_flow_snapshot=null where id='${id}';`);
      await asAdmin(`select public.update_booking_status('${id}','confirmed');`);
      await asAdmin(`select public.update_booking_payment('${id}','paid',85,85,'stripe','legacy');`);
      assert.equal((await state(id)).payment_status, "paid");
      await asAdmin(`select public.cancel_booking('${id}');`);
      assert.equal((await state(id)).status, "cancelled");
      assert.equal(await query(`select is_available from public.availability_slots where id='${slotId}';`), "t");
    }
  });
  await t.test("slot deletion and reservation serialize safely in either order", async () => {
    for (const deletionFirst of [true, false]) {
      const slotId = await slot();
      const create = `select public.create_pending_payment_booking('${directService}','Customer','customer@example.test',null,null,'${slotId}');`;
      const remove = `select public.delete_availability_slot('${slotId}');`;
      const holder = spawn("docker", ["exec", "-i", container, "psql", "-h", "127.0.0.1", "-U", "postgres",
        "-XqAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      let errors = "";
      let readyResolve;
      let readyReject;
      const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      holder.stdout.on("data", (data) => { output += data; if (output.includes("holding-slot")) readyResolve(); });
      holder.stderr.on("data", (data) => { errors += data; });
      const done = new Promise((resolve, reject) => {
        holder.on("error", (error) => { readyReject(error); reject(error); });
        holder.on("close", (code) => {
          if (code === 0) resolve();
          else { const error = new Error(errors); readyReject(error); reject(error); }
        });
      });
      done.catch(() => {});
      let waiter;
      try {
        holder.stdin.write(`begin; set local idle_in_transaction_session_timeout='15s';
          set local role ${deletionFirst ? "authenticated" : "anon"};
          set local request.jwt.claims='${JSON.stringify(deletionFirst ? { role: "authenticated", sub: adminId } : { role: "anon" })}';
          ${deletionFirst ? remove : create}
          \\echo holding-slot
        `);
        await ready;
        waiter = (deletionFirst ? asRole("anon", create) : asAdmin(remove)).then(
          (value) => ({ value }), (error) => ({ error }));
        let blocked = false;
        for (let i = 0; i < 30; i++) {
          blocked = await query(`select exists(select 1 from pg_stat_activity where pid <> pg_backend_pid()
            and wait_event_type='Lock' and query like '%${slotId}%');`) === "t";
          if (blocked) break;
          await delay(50);
        }
        assert.ok(blocked, "Competing operation must wait for the slot transaction");
      } finally {
        holder.stdin.end("commit;\n");
        await done;
      }
      const result = await waiter;
      assert.match(result.error?.message || "", deletionFirst ? /slot does not exist/ : /booking history/);
      assert.equal(await query(`select count(*) from public.bookings where slot_id='${slotId}';`), deletionFirst ? "0" : "1");
      assert.equal(await query(`select count(*) from public.availability_slots where id='${slotId}';`), deletionFirst ? "0" : "1");
    }
  });
  await t.test("past-slot cleanup retains referenced history and server slot management remains functional", async () => {
    await query(`update public.availability_slots set slot_date=current_date-1 where id='${held.slotId}';
      insert into public.availability_slots(slot_date,slot_time) values(current_date-2,'12:00');`);
    assert.equal(await asAdmin("select public.delete_past_availability_slots();"), "1");
    assert.equal(await query(`select count(*) from public.availability_slots where id='${held.slotId}';`), "1");
    assert.equal(await server(`select public.create_availability_slots(jsonb_build_array(jsonb_build_object('slot_date',current_date+600,'slot_time','12:00')));`), "1");
  });
});
