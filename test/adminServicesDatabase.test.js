import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

test("admin-managed services enforce the V1 catalogue boundary", { timeout: 300000 }, async (t) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status !== 0) {
    t.skip("Requires Docker with local postgres:17 image.");
    return;
  }
  const container = `amanda-admin-services-${randomUUID()}`;
  const exec = (args, input) => new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", (data) => { out += data; }); child.stderr.on("data", (data) => { err += data; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
    child.stdin.end(input);
  });
  await exec(["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]);
  t.after(() => exec(["rm", "-f", container]));
  const query = (sql) => exec(["exec", "-i", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-XqAt", "-v", "ON_ERROR_STOP=1"], sql);
  for (let attempt = 0; ; attempt += 1) {
    try { await query("select 1;"); break; } catch (error) { if (attempt === 50) throw error; await delay(100); }
  }

  const base = await read("20260817210000_add_booking_services.sql");
  const security = await read("20260817185300_booking_security_admin_foundation.sql");
  const migration = await read("20261004000000_admin_managed_services.sql");
  const adminId = randomUUID(); const ordinaryId = randomUUID();
  await query(`
    create schema auth; create schema private; create schema extensions; create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
    create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
    ${security}
    insert into auth.users values ('${adminId}'), ('${ordinaryId}');
    insert into public.admin_users(user_id) values ('${adminId}');
    ${base.match(/create table public.services \([^]*?\n\);/)[0]}
    alter table public.services add column payment_flow text not null default 'none';
    alter table public.services add constraint services_payment_flow_check check (
      (payment_required is not true and payment_flow = 'none')
      or (payment_required is true and payment_flow in ('payment_link', 'direct_payment'))
    );
    alter table public.services owner to postgres;
    alter table public.services enable row level security;
    revoke all on table public.services from public, anon, authenticated;
    grant all on table public.services to authenticated, service_role;
    create policy "Admins can manage services" on public.services to authenticated
      using (public.is_admin()) with check (public.is_admin());
    create function public.get_active_services()
    returns table (id uuid, slug text, name text, booking_mode text, duration_minutes integer,
      price_amount integer, currency text, payment_required boolean, payment_flow text, display_order integer)
    language sql stable security definer set search_path = '' as $$
      select service.id, service.slug, service.name, service.booking_mode, service.duration_minutes,
        service.price_amount, service.currency, service.payment_required, service.payment_flow, service.display_order
      from public.services service where service.is_active is true order by service.display_order, service.name;
    $$;
    alter function public.get_active_services() owner to postgres;
    revoke all on function public.get_active_services() from public;
    grant execute on function public.get_active_services() to anon, authenticated, service_role;
    create table public.bookings(
      id uuid primary key default gen_random_uuid(), service_id uuid not null references public.services,
      service_name_snapshot text not null, service_booking_mode_snapshot text not null,
      service_duration_minutes_snapshot integer, service_price_amount_snapshot integer not null,
      service_currency_snapshot text not null, service_payment_flow_snapshot text not null
    );
    create table private.booking_pricing(
      id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings,
      service_id uuid not null references public.services, original_amount_minor integer not null,
      discount_amount_minor integer not null, final_amount_minor integer not null, currency text not null
    );
    insert into public.services(slug,name,booking_mode,duration_minutes,price_amount,currency,payment_required,payment_flow,is_active,display_order)
      values ('private-readings','Private Readings','timed',60,8500,'USD',true,'direct_payment',true,10);
    ${migration}
  `);

  const asRole = (role, id, sql) => query(`set role ${role}; set request.jwt.claims = '${JSON.stringify({ role, sub: id })}'; ${sql}`);
  const admin = (sql) => asRole("authenticated", adminId, sql);
  const ordinary = (sql) => asRole("authenticated", ordinaryId, sql);
  const anon = (sql) => asRole("anon", ordinaryId, sql);
  const serviceRole = (sql) => asRole("service_role", adminId, sql);

  await t.test("migration replaces the complete active-service signature and preserves intended callers", async () => {
    const expected = "booking_mode,currency,display_order,duration_minutes,id,name,payment_flow,payment_required,price_amount,public_summary,slug";
    const keys = "select array_to_string(array(select jsonb_object_keys(to_jsonb(service)) order by 1), ',') from public.get_active_services() service limit 1;";
    assert.equal(await query(keys), expected);
    assert.equal(await anon(keys), expected);
    assert.equal(await ordinary(keys), expected);
    assert.equal(await serviceRole(keys), expected);
    assert.match(await anon("select public_summary from public.get_active_services() where slug='private-readings';"), /full hour/);
  });

  await t.test("the migration removes real authenticated table grants while retaining protected RPC access", async () => {
    assert.equal(await query(`select has_table_privilege('authenticated','public.services','INSERT') || '|' || has_table_privilege('authenticated','public.services','UPDATE') || '|' || has_table_privilege('authenticated','public.services','DELETE');`), "false|false|false");
    await assert.rejects(admin("insert into public.services(slug,name,booking_mode,duration_minutes,price_amount) values ('nope','Nope','timed',60,100);"), /permission denied/);
    await assert.rejects(admin("update public.services set name='Nope' where slug='private-readings';"), /permission denied/);
    await assert.rejects(admin("delete from public.services where slug='private-readings';"), /permission denied/);
    await assert.rejects(ordinary("select public.create_admin_service('Nope','Summary','timed',1000);"), /Administrator access/);
    assert.equal(await admin("select count(*) from public.get_admin_services();"), "1");
    assert.equal(await serviceRole("select count(*) from public.get_admin_services();"), "1");
  });

  const createService = (name, mode = "timed", amount = 1234) => admin(`select public.create_admin_service('${name}','A concise public summary.','${mode}',${amount});`);
  const timed = await createService("New Timed!");
  const untimed = await createService("New Untimed", "untimed", 2500);

  await t.test("creation fixes V1 payment configuration, duration, slug and inactive lifecycle", async () => {
    assert.equal(await query(`select slug || '|' || is_active || '|' || duration_minutes || '|' || currency || '|' || payment_required || '|' || payment_flow from public.services where id='${timed}';`), "new-timed|false|60|USD|true|direct_payment");
    assert.equal(await query(`select duration_minutes is null and not is_active from public.services where id='${untimed}';`), "t");
    assert.equal(await admin(`select count(*) from public.get_admin_services() where id in ('${timed}','${untimed}');`), "2");
    await assert.rejects(createService("New Timed"), /URL slug already exists/);
    await assert.rejects(createService("!!!"), /usable URL slug/);
    await assert.rejects(createService("Bad", "timed", 0), /positive whole-cent/);
    await assert.rejects(createService("Negative", "timed", -1), /positive whole-cent/);
    await assert.rejects(createService("Too Expensive", "timed", 100000001), /positive whole-cent/);
    await admin(`select public.update_admin_service('${timed}','Renamed','Updated summary',4321);`);
    assert.equal(await query(`select slug || '|' || name || '|' || price_amount from public.services where id='${timed}';`), "new-timed|Renamed|4321");
  });

  await t.test("activation rejects every malformed V1 configuration", async () => {
    const malformedTimed = await createService("Malformed Duration");
    await query(`update public.services set duration_minutes=30 where id='${malformedTimed}';`);
    await assert.rejects(admin(`select public.set_admin_service_active('${malformedTimed}',true);`), /V1 booking and payment/);
    // Test-only constraint removal permits controlled legacy/corrupt rows without adding an unsafe API.
    await query("alter table public.services drop constraint services_duration_check; alter table public.services drop constraint services_currency_check;");
    const malformed = {
      untimedDuration: await createService("Malformed Untimed", "untimed"), currency: await createService("Malformed Currency"),
      flow: await createService("Malformed Flow"), paymentRequired: await createService("Malformed Payment Required"),
      summary: await createService("Malformed Summary"), price: await createService("Malformed Price"),
    };
    await query(`
      update public.services set duration_minutes=60 where id='${malformed.untimedDuration}';
      update public.services set currency='EUR' where id='${malformed.currency}';
      update public.services set payment_flow='payment_link' where id='${malformed.flow}';
      update public.services set payment_required=false,payment_flow='none' where id='${malformed.paymentRequired}';
      update public.services set public_summary='   ' where id='${malformed.summary}';
      update public.services set price_amount=0 where id='${malformed.price}';
    `);
    for (const id of Object.values(malformed)) {
      await assert.rejects(admin(`select public.set_admin_service_active('${id}',true);`), /V1 booking and payment|public summary|positive whole-cent/);
    }
    const valid = await createService("Valid Activation");
    assert.equal(await admin(`select public.set_admin_service_active('${valid}',true);`), "t");
    assert.equal(await query(`select is_active from public.services where id='${valid}';`), "t");
  });

  await t.test("move validation and deterministic ordering cover boundaries, ties and inactive rows", async () => {
    await assert.rejects(admin(`select public.move_admin_service('${timed}',null);`), /Direction must be up or down/);
    await assert.rejects(admin(`select public.move_admin_service('${timed}','sideways');`), /Direction must be up or down/);
    const first = await query("select id from public.services order by display_order,name,id limit 1;");
    const last = await query("select id from public.services order by display_order desc,name desc,id desc limit 1;");
    assert.equal(await admin(`select public.move_admin_service('${first}','up');`), "f");
    assert.equal(await admin(`select public.move_admin_service('${last}','down');`), "f");
    const alpha = await createService("Equal Alpha"); const beta = await createService("Equal Beta");
    await query(`update public.services set display_order=500 where id in ('${alpha}','${beta}');`);
    assert.equal(await query(`select string_agg(name,',' order by display_order,name,id) from public.services where id in ('${alpha}','${beta}');`), "Equal Alpha,Equal Beta");
    assert.equal(await admin(`select public.move_admin_service('${beta}','up');`), "t");
    assert.equal(await query(`select string_agg(name,',' order by display_order,name,id) from public.services where id in ('${alpha}','${beta}');`), "Equal Beta,Equal Alpha");
    assert.equal(await query(`select bool_and(not is_active) from public.services where id in ('${alpha}','${beta}');`), "t");
    await admin(`select public.set_admin_service_active('${beta}',true);`);
    const before = await query(`select display_order from public.services where id='${beta}';`);
    await admin(`select public.set_admin_service_active('${beta}',false); select public.set_admin_service_active('${beta}',true);`);
    assert.equal(await query(`select display_order from public.services where id='${beta}';`), before);
  });

  await t.test("catalogue activation and historical snapshots remain independent", async () => {
    await admin(`select public.set_admin_service_active('${timed}',true); select public.set_admin_service_active('${untimed}',true);`);
    assert.equal(await query(`select count(*) from public.get_active_services() where id in ('${timed}','${untimed}');`), "2");
    const booking = await query(`insert into public.bookings(service_id,service_name_snapshot,service_booking_mode_snapshot,service_duration_minutes_snapshot,service_price_amount_snapshot,service_currency_snapshot,service_payment_flow_snapshot)
      select id,name,booking_mode,duration_minutes,price_amount,currency,payment_flow from public.services where id='${timed}' returning id;`);
    await query(`insert into private.booking_pricing(booking_id,service_id,original_amount_minor,discount_amount_minor,final_amount_minor,currency)
      select '${booking}',id,price_amount,0,price_amount,currency from public.services where id='${timed}';`);
    const frozen = await query(`select service_name_snapshot || '|' || service_price_amount_snapshot from public.bookings where id='${booking}';`);
    const pricing = await query(`select original_amount_minor || '|' || final_amount_minor from private.booking_pricing where booking_id='${booking}';`);
    await admin(`select public.update_admin_service('${timed}','Changed again','Changed again summary',5000); select public.set_admin_service_active('${timed}',false);`);
    assert.equal(await query(`select service_name_snapshot || '|' || service_price_amount_snapshot from public.bookings where id='${booking}';`), frozen);
    assert.equal(await query(`select original_amount_minor || '|' || final_amount_minor from private.booking_pricing where booking_id='${booking}';`), pricing);
    assert.equal(await query(`select count(*) from public.get_active_services() where id='${timed}';`), "0");
  });
});
