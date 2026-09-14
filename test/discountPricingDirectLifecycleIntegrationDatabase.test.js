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

  const [security, phaseOne, current, supersession, discount, stageTwo, stageThree] = await Promise.all([
    read("20260817185300_booking_security_admin_foundation.sql"),
    read("20260818001000_direct_payment_phase_one.sql"),
    read("20260908000000_business_timezone_slot_expiry.sql"),
    read("20260906000000_payment_failure_supersession.sql"),
    read("20260914000000_discount_pricing_foundation.sql"),
    read("20260915000000_discount_aware_booking_creation.sql"),
    read("20260915001000_discount_revalidation_and_redemption.sql"),
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
    ${stageTwo}
    ${stageThree}
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

  await t.test("deployed six-argument named contract remains unambiguous and undiscounted", async () => {
    const result = JSON.parse(await query(`select public.create_pending_payment_booking(
      p_service_id => '${ids.voice}', p_customer_name => 'Customer', p_customer_email => 'customer@example.test',
      p_customer_phone => null, p_customer_message => 'Question', p_slot_id => null);`));
    assert.deepEqual(Object.keys(result).sort(), ["booking_id", "payment_access_token"]);
    assert.equal(await query(`select bp.original_amount_minor || '|' || bp.discount_amount_minor || '|' || bp.final_amount_minor || '|' || b.amount_due || '|' || a.amount_minor from public.bookings b join private.booking_pricing bp on bp.booking_id=b.id join private.payment_attempts a on a.booking_id=b.id where b.id='${result.booking_id}';`), "2000|0|2000|20.0000000000000000|2000");
  });

  await t.test("discount validation failures are atomic and blank codes are no-code", async () => {
    const timedSlot = await slot();
    const before = await query("select count(*) from public.bookings;");
    for (const code of ["UNKNOWN", "bad code!"]) {
      await assert.rejects(query(`set request.jwt.claims = '{"role":"service_role"}'; select public.create_pending_payment_booking('${ids.private}','Customer','customer@example.test',null,'Question','${timedSlot}','${code}');`));
      assert.equal(await query("select count(*) from public.bookings;"), before);
      assert.equal(await query(`select is_available from public.availability_slots where id='${timedSlot}';`), "t");
    }
    const blank = JSON.parse(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.create_pending_payment_booking('${ids.voice}','Customer','customer@example.test',null,'Question',null,'   ');`));
    assert.equal(await query(`select discount_amount_minor || '|' || final_amount_minor from private.booking_pricing where booking_id='${blank.booking_id}';`), "0|2000");
  });

  await t.test("disabled, expired, inactive, and selected-scope failures leave no artifacts", async () => {
    const disabled = await query("insert into private.discount_codes(code,percentage_off,enabled,scope) values ('DISABLED10',10,false,'all') returning id;");
    const expired = await query("insert into private.discount_codes(code,percentage_off,scope,expires_at) values ('EXPIRED10',10,'all',now()-interval '1 minute') returning id;");
    await query(`with code as (insert into private.discount_codes(code,percentage_off,scope) values ('PRIVATEONLY',10,'selected') returning id) insert into private.discount_code_services(discount_code_id,service_id) select id,'${ids.private}' from code returning discount_code_id;`);
    const cases = [["DISABLED10", "voice", false], ["EXPIRED10", "voice", false], ["PRIVATEONLY", "wheel", true]];
    for (const [code, service, timed] of cases) {
      const slotId = timed ? await slot() : null;
      const before = await query("select count(*) from public.bookings;");
      await assert.rejects(query(`set request.jwt.claims = '{"role":"service_role"}'; select public.create_pending_payment_booking('${ids[service]}','Customer','customer@example.test',null,'Question',${slotId ? `'${slotId}'` : 'null'},'${code}');`));
      assert.equal(await query("select count(*) from public.bookings;"), before);
      if (slotId) assert.equal(await query(`select is_available and not exists(select 1 from public.bookings where slot_id='${slotId}') from public.availability_slots where id='${slotId}';`), "t");
    }
    await query(`update public.services set is_active=false where id='${ids.voice}';`);
    const before = await query("select count(*) from public.bookings;");
    await assert.rejects(query(`set request.jwt.claims = '{"role":"service_role"}'; select public.create_pending_payment_booking('${ids.voice}','Customer','customer@example.test',null,'Question',null,'DISABLED10');`));
    assert.equal(await query("select count(*) from public.bookings;"), before);
    await query(`update public.services set is_active=true where id='${ids.voice}';`);
    assert.match(disabled + expired, /[0-9a-f-]{36}/);
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

  await t.test("optional codes freeze authoritative discounted prices without changing the legacy RPC", async () => {
    const codes = await query(`
      insert into private.discount_codes(code,percentage_off,scope) values ('PRIVATE20',20,'all'),('VOICE25',25,'all'),('WHEEL33',33,'all')
      returning code || '=' || id;`);
    const codeIds = Object.fromEntries(codes.split("\n").map((row) => row.split("=")));
    const createDiscounted = async (service, code, slotId = null) => JSON.parse(await query(
      `select public.create_pending_payment_booking('${ids[service]}','Customer','customer@example.test',null,'Question',${slotId ? `'${slotId}'` : 'null'},'${code}');`,
    ));
    const privateReading = await createDiscounted("private", "PRIVATE20", await slot());
    const voice = await createDiscounted("voice", "VOICE25");
    const wheel = await createDiscounted("wheel", "WHEEL33", await slot());
    for (const [booking, code, id, expected] of [
      [privateReading.booking_id, "PRIVATE20", codeIds.PRIVATE20, "8500|1700|6800|68.0000000000000000"],
      [voice.booking_id, "VOICE25", codeIds.VOICE25, "2000|500|1500|15.0000000000000000"],
      [wheel.booking_id, "WHEEL33", codeIds.WHEEL33, "6000|1980|4020|40.2000000000000000"],
    ]) {
      const pricing = await query(`select original_amount_minor || '|' || discount_amount_minor || '|' || final_amount_minor || '|' || (select amount_due from public.bookings where id='${booking}') from private.booking_pricing where booking_id='${booking}';`);
      assert.match(pricing, new RegExp(`^${expected.split("|").slice(0, 3).join("\\|")}\\|`));
      assert.equal(await query(`select discount_code_id='${id}' and discount_code_snapshot='${code}' and discount_percentage_snapshot > 0 and discount_code_revision=1 from private.booking_pricing where booking_id='${booking}';`), "t");
    }
    await query("update private.discount_codes set percentage_off=99, enabled=false where code='VOICE25';");
    const first = await query(`select id from private.payment_attempts where booking_id='${voice.booking_id}';`);
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.mark_payment_attempt_processing('${voice.booking_id}','${first}','sandbox'); select public.fail_payment_attempt('${voice.booking_id}','${first}','FAILED');`);
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.begin_payment_attempt('${voice.booking_id}','${voice.payment_access_token}','square');`);
    assert.equal(await query(`select count(distinct pricing_id) || '|' || min(amount_minor) from private.payment_attempts where booking_id='${voice.booking_id}';`), "1|1500");
  });

  await t.test("discount overload is service-role-only and completion uses frozen final pricing", async () => {
    await assert.rejects(query(`set role anon; select public.create_pending_payment_booking('${ids.voice}','Customer','customer@example.test',null,'Question',null,'VOICE25');`), /permission denied/);
    await assert.rejects(query(`set role authenticated; select public.create_pending_payment_booking('${ids.voice}','Customer','customer@example.test',null,'Question',null,'VOICE25');`), /permission denied/);
    const code = await query("insert into private.discount_codes(code,percentage_off,scope) values ('COMPLETE25',25,'all') returning id;");
    const booking = JSON.parse(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.create_pending_payment_booking('${ids.voice}','Customer','customer@example.test',null,'Question',null,'COMPLETE25');`));
    const attempt = await query(`select id from private.payment_attempts where booking_id='${booking.booking_id}';`);
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.mark_payment_attempt_processing('${booking.booking_id}','${attempt}','sandbox');`);
    await assert.rejects(query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','wrong-${randomUUID()}','payment.updated','${booking.booking_id}','${attempt}','pay-wrong','sandbox','COMPLETED',2000,'USD');`), /details do not match/);
    const payment = `pay-${randomUUID()}`;
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','ok-${randomUUID()}','payment.updated','${booking.booking_id}','${attempt}','${payment}','sandbox','COMPLETED',1500,'USD');`);
    assert.equal(await query(`select amount_paid || '|' || status || '|' || payment_status from public.bookings where id='${booking.booking_id}';`), "15.0000000000000000|confirmed|paid");
    const event = `late-${randomUUID()}`;
    assert.equal(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','${event}','payment.updated','${booking.booking_id}','${attempt}','${payment}','sandbox','FAILED',1500,'USD');`), "f");
    assert.equal(await query(`select processed_at is not null from private.payment_webhook_events where event_id='${event}';`), "t");
    assert.match(code, /^[0-9a-f-]{36}$/);
  });

  await t.test("Private, Wheel, and Voice completion trust final pricing and delayed CANCELED is harmless", async () => {
    await query("insert into private.discount_codes(code,percentage_off,scope) values ('P20X',20,'all'),('W33X',33,'all'),('V25X',25,'all');");
    const cases = [["private", "P20X", 8500, 6800], ["wheel", "W33X", 6000, 4020], ["voice", "V25X", 2000, 1500]];
    for (const [service, code, original, final] of cases) {
      const slotId = service === "voice" ? null : await slot();
      const booking = JSON.parse(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.create_pending_payment_booking('${ids[service]}','Customer','customer@example.test',null,'Question',${slotId ? `'${slotId}'` : 'null'},'${code}');`));
      const attempt = await query(`select id from private.payment_attempts where booking_id='${booking.booking_id}';`);
      await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.mark_payment_attempt_processing('${booking.booking_id}','${attempt}','sandbox');`);
      await assert.rejects(query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','bad-${randomUUID()}','payment.updated','${booking.booking_id}','${attempt}','bad-${randomUUID()}','sandbox','COMPLETED',${original},'USD');`));
      await assert.rejects(query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','currency-${randomUUID()}','payment.updated','${booking.booking_id}','${attempt}','badcurrency-${randomUUID()}','sandbox','COMPLETED',${final},'EUR');`));
      const payment = `pay-${randomUUID()}`;
      await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','webhook-${randomUUID()}','payment.updated','${booking.booking_id}','${attempt}','${payment}','sandbox','COMPLETED',${final},'USD');`);
      assert.equal(await query(`select service_price_amount_snapshot || '|' || status || '|' || payment_status || '|' || (amount_due=amount_paid) from public.bookings where id='${booking.booking_id}';`), `${original}|confirmed|paid|true`);
      assert.equal(await query(`select amount_due = ${final}::numeric / 100 from public.bookings where id='${booking.booking_id}';`), "t");
      if (service === "voice") {
        const event = `cancel-${randomUUID()}`;
        assert.equal(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','${event}','payment.updated','${booking.booking_id}','${attempt}','${payment}','sandbox','CANCELED',${final},'USD');`), "f");
        assert.equal(await query(`select processed_at is not null from private.payment_webhook_events where event_id='${event}';`), "t");
      }
    }
  });

  await t.test("Stage 3 revalidates only reserved discounts and records one redemption", async () => {
    const createDiscounted = async (service, code, slotId = null) => JSON.parse(await query(
      `set request.jwt.claims = '{"role":"service_role"}'; select public.create_pending_payment_booking('${ids[service]}','Customer','customer@example.test',null,'Question',${slotId ? `'${slotId}'` : "null"},'${code}');`,
    ));
    const attemptFor = (bookingId) => query(`select id from private.payment_attempts where booking_id='${bookingId}' order by created_at desc limit 1;`);
    const mark = async (bookingId, attemptId) => JSON.parse(await query(
      `set request.jwt.claims = '{"role":"service_role"}'; select public.mark_payment_attempt_processing('${bookingId}','${attemptId}','sandbox');`,
    ));
    const complete = (bookingId, attemptId, amount, event = `stage3-${randomUUID()}`) => query(
      `set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','${event}','payment.updated','${bookingId}','${attemptId}','payment-${randomUUID()}','sandbox','COMPLETED',${amount},'USD');`,
    );

    const undiscounted = await create("voice");
    const undiscountedAttempt = await attemptFor(undiscounted.booking_id);
    assert.equal((await mark(undiscounted.booking_id, undiscountedAttempt)).should_submit, true);
    await complete(undiscounted.booking_id, undiscountedAttempt, 2000);
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${undiscounted.booking_id}';`), "0");

    await query("insert into private.discount_codes(code,percentage_off,scope) values ('S3VALID20',20,'all');");
    const valid = await createDiscounted("private", "S3VALID20", await slot());
    const validAttempt = await attemptFor(valid.booking_id);
    assert.deepEqual(await mark(valid.booking_id, validAttempt), {
      should_submit: true, idempotency_key: await query(`select idempotency_key from private.payment_attempts where id='${validAttempt}';`), amount_minor: 6800, currency: "USD",
    });
    assert.equal(await query(`select service_price_amount_snapshot || '|' || amount_due || '|' || final_amount_minor from public.bookings join private.booking_pricing on booking_pricing.booking_id=bookings.id where bookings.id='${valid.booking_id}';`), "8500|68.0000000000000000|6800");
    const validEvent = `stage3-valid-${randomUUID()}`;
    const validPayment = `payment-${randomUUID()}`;
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','${validEvent}','payment.updated','${valid.booking_id}','${validAttempt}','${validPayment}','sandbox','COMPLETED',6800,'USD');`);
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${valid.booking_id}';`), "1");
    assert.equal(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square',null,'api.create_payment','${valid.booking_id}','${validAttempt}','${validPayment}','sandbox','COMPLETED',6800,'USD');`), "f");
    assert.equal(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','${validEvent}','payment.updated','${valid.booking_id}','${validAttempt}','${validPayment}','sandbox','COMPLETED',6800,'USD');`), "f");
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${valid.booking_id}';`), "1");

    await query("insert into private.discount_codes(code,percentage_off,scope) values ('S3APIFIRST20',20,'all'),('S3CANCEL20',20,'all');");
    const apiFirst = await createDiscounted("voice", "S3APIFIRST20");
    const apiFirstAttempt = await attemptFor(apiFirst.booking_id);
    await mark(apiFirst.booking_id, apiFirstAttempt);
    const apiFirstPayment = `payment-${randomUUID()}`;
    assert.equal(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square',null,'api.create_payment','${apiFirst.booking_id}','${apiFirstAttempt}','${apiFirstPayment}','sandbox','COMPLETED',1600,'USD');`), "t");
    assert.equal(await query(`select status || '|' || payment_status from public.bookings where id='${apiFirst.booking_id}';`), "confirmed|paid");
    assert.equal(await query(`select status from private.payment_attempts where id='${apiFirstAttempt}';`), "completed");
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${apiFirst.booking_id}';`), "1");
    const apiFirstWebhook = `api-first-webhook-${randomUUID()}`;
    assert.equal(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','${apiFirstWebhook}','payment.updated','${apiFirst.booking_id}','${apiFirstAttempt}','${apiFirstPayment}','sandbox','COMPLETED',1600,'USD');`), "f");
    assert.equal(await query(`select count(*) || '|' || (min(processed_at) is not null) from private.payment_webhook_events where provider='square' and event_id='${apiFirstWebhook}';`), "1|true");
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${apiFirst.booking_id}';`), "1");

    const canceled = await createDiscounted("voice", "S3CANCEL20");
    const canceledAttempt = await attemptFor(canceled.booking_id);
    await mark(canceled.booking_id, canceledAttempt);
    assert.equal(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','cancel-before-settlement-${randomUUID()}','payment.updated','${canceled.booking_id}','${canceledAttempt}','payment-${randomUUID()}','sandbox','CANCELED',1600,'USD');`), "t");
    assert.equal(await query(`select status || '|' || payment_status || '|' || amount_paid from public.bookings where id='${canceled.booking_id}';`), "payment_expired|unpaid|0");
    assert.equal(await query(`select status from private.payment_attempts where id='${canceledAttempt}';`), "failed");
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${canceled.booking_id}';`), "0");

    await query("insert into private.discount_codes(code,percentage_off,scope) values ('S3RACE20',20,'all');");
    const race = await createDiscounted("voice", "S3RACE20");
    const raceAttempt = await attemptFor(race.booking_id);
    await mark(race.booking_id, raceAttempt);
    const racePayment = `payment-${randomUUID()}`;
    const raceResults = await Promise.all([
      query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','race-a-${randomUUID()}','payment.updated','${race.booking_id}','${raceAttempt}','${racePayment}','sandbox','COMPLETED',1600,'USD');`),
      query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','race-b-${randomUUID()}','payment.updated','${race.booking_id}','${raceAttempt}','${racePayment}','sandbox','COMPLETED',1600,'USD');`),
    ]);
    assert.deepEqual(raceResults.sort(), ["f", "t"]);
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${race.booking_id}';`), "1");

    const invalidCases = [
      ["S3DISABLED", "voice", async () => query("update private.discount_codes set enabled=false where code='S3DISABLED';")],
      ["S3EXPIRED", "voice", async () => query("update private.discount_codes set expires_at=now()-interval '1 second' where code='S3EXPIRED';")],
      ["S3INACTIVE", "voice", async () => query(`update public.services set is_active=false where id='${ids.voice}';`)],
      ["S3SCOPE", "private", async () => query(`begin; delete from private.discount_code_services where discount_code_id=(select id from private.discount_codes where code='S3SCOPE'); insert into private.discount_code_services(discount_code_id,service_id) select id,'${ids.wheel}' from private.discount_codes where code='S3SCOPE'; commit;`)],
    ];
    await query(`
      insert into private.discount_codes(code,percentage_off,scope,expires_at) values
        ('S3DISABLED',20,'all',null), ('S3EXPIRED',20,'all',now()+interval '1 hour'),
        ('S3INACTIVE',20,'all',null);
      with c as (insert into private.discount_codes(code,percentage_off,scope) values ('S3SCOPE',20,'selected') returning id)
      insert into private.discount_code_services(discount_code_id,service_id) select id,'${ids.private}' from c;
    `);
    for (const [code, service, mutate] of invalidCases) {
      const slotId = service === "private" ? await slot() : null;
      const booking = await createDiscounted(service, code, slotId);
      const attempt = await attemptFor(booking.booking_id);
      await mutate();
      const result = await mark(booking.booking_id, attempt);
      assert.deepEqual(result, { should_submit: false, attempt_status: "expired", failure_code: "DISCOUNT_NO_LONGER_VALID", price_review: true });
      assert.equal(await query(`select status || '|' || payment_status from public.bookings where id='${booking.booking_id}';`), "payment_expired|unpaid");
      assert.equal(await query(`select status || '|' || (submitted_at is null) from private.payment_attempts where id='${attempt}';`), "expired|true");
      assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${booking.booking_id}';`), "0");
      if (slotId) assert.equal(await query(`select is_available and not exists(select 1 from public.bookings where slot_id='${slotId}' and status='pending_payment') from public.availability_slots where id='${slotId}';`), "t");
      if (code === "S3INACTIVE") await query(`update public.services set is_active=true where id='${ids.voice}';`);
    }

    await query("insert into private.discount_codes(code,percentage_off,scope,enabled) values ('S3PERCENT',20,'all',true),('S3REENABLE',20,'all',true),('S3INFLIGHT',20,'all',true),('S3RETRY',20,'all',true),('S3FAILED',20,'all',true);");
    const percentage = await createDiscounted("voice", "S3PERCENT");
    const percentageAttempt = await attemptFor(percentage.booking_id);
    await query("update private.discount_codes set percentage_off=25, revision=revision+1 where code='S3PERCENT';");
    assert.equal((await mark(percentage.booking_id, percentageAttempt)).amount_minor, 1600);
    // The payment amount remains the original frozen 20% amount, not 25%.
    assert.equal(await query(`select final_amount_minor from private.booking_pricing where booking_id='${percentage.booking_id}';`), "1600");

    const reenabled = await createDiscounted("voice", "S3REENABLE");
    const reenabledAttempt = await attemptFor(reenabled.booking_id);
    await query("update private.discount_codes set enabled=false where code='S3REENABLE';");
    await query("update private.discount_codes set enabled=true where code='S3REENABLE';");
    assert.equal((await mark(reenabled.booking_id, reenabledAttempt)).should_submit, true);

    const inFlight = await createDiscounted("voice", "S3INFLIGHT");
    const inFlightAttempt = await attemptFor(inFlight.booking_id);
    assert.equal((await mark(inFlight.booking_id, inFlightAttempt)).should_submit, true);
    await query("update private.discount_codes set enabled=false where code='S3INFLIGHT';");
    await complete(inFlight.booking_id, inFlightAttempt, 1600);
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${inFlight.booking_id}';`), "1");

    const failed = await createDiscounted("voice", "S3FAILED");
    const failedAttempt = await attemptFor(failed.booking_id);
    await mark(failed.booking_id, failedAttempt);
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','failed-${randomUUID()}','payment.updated','${failed.booking_id}','${failedAttempt}','payment-${randomUUID()}','sandbox','FAILED',1600,'USD');`);
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${failed.booking_id}';`), "0");

    const retry = await createDiscounted("voice", "S3RETRY");
    const retryFirst = await attemptFor(retry.booking_id);
    await mark(retry.booking_id, retryFirst);
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square','retry-failed-${randomUUID()}','payment.updated','${retry.booking_id}','${retryFirst}','payment-${randomUUID()}','sandbox','FAILED',1600,'USD');`);
    const retryAttempt = JSON.parse(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.begin_payment_attempt('${retry.booking_id}','${retry.payment_access_token}','square');`)).attempt_id;
    await mark(retry.booking_id, retryAttempt);
    await complete(retry.booking_id, retryAttempt, 1600);
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${retry.booking_id}';`), "1");
  });

  await t.test("Stage 3 helpers remain private and only service role can submit", async () => {
    const booking = await create("voice");
    const attempt = await query(`select id from private.payment_attempts where booking_id='${booking.booking_id}';`);
    await assert.rejects(query(`set role anon; select private.discount_pricing_is_currently_redeemable((select pricing_id from private.payment_attempts where id='${attempt}'));`), /permission denied/);
    await assert.rejects(query(`set role authenticated; select public.mark_payment_attempt_processing('${booking.booking_id}','${attempt}','sandbox');`), /permission denied|Service-role/);
    await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.mark_payment_attempt_processing('${booking.booking_id}','${attempt}','sandbox');`);
  });

  await t.test("two independent sessions serialize one timed Stage 2 creation", async () => {
    const slotId = await slot();
    const createSql = (name) => `set request.jwt.claims = '{"role":"service_role"}'; select public.create_pending_payment_booking('${ids.private}','${name}','${name}@example.test',null,'Question','${slotId}',null);`;
    const sessionA = exec(["exec", "-i", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-XqAt", "-v", "ON_ERROR_STOP=1"], `begin; select id from public.availability_slots where id='${slotId}' for update; select pg_sleep(1); ${createSql("A")} commit;`);
    await delay(150);
    const sessionB = query(createSql("B")).then(
      () => null,
      (error) => error,
    );
    const winner = await sessionA;
    assert.match(String(await sessionB), /no longer available/);
    assert.match(winner, /booking_id/);
    assert.equal(await query(`select count(*) || '|' || (select count(*) from private.booking_pricing bp join public.bookings b on b.id=bp.booking_id where b.slot_id='${slotId}') || '|' || (select count(*) from private.booking_payment_access a join public.bookings b on b.id=a.booking_id where b.slot_id='${slotId}') || '|' || (select count(*) from private.payment_attempts a join public.bookings b on b.id=a.booking_id where b.slot_id='${slotId}') || '|' || (select is_available from public.availability_slots where id='${slotId}') from public.bookings where slot_id='${slotId}';`), "1|1|1|1|false");
  });

  await t.test("settled Stage 1 Voice pricing remains a settled Stage 2 record", async () => {
    const booking = await query(`insert into public.bookings(service_id,service_name_snapshot,service_booking_mode_snapshot,service_price_amount_snapshot,service_currency_snapshot,service_payment_flow_snapshot,status,payment_status,amount_due,amount_paid,customer_name,customer_email)
      values ('${ids.voice}','Voice Memo Reading','untimed',2000,'USD','direct_payment','confirmed','paid',20,20,'Historical','historical@example.test') returning id;`);
    const pricing = await query(`insert into private.booking_pricing(booking_id,service_id,original_amount_minor,discount_amount_minor,final_amount_minor,currency) values ('${booking}','${ids.voice}',2000,0,2000,'USD') returning id;`);
    const accessToken = "h".repeat(64);
    await query(`insert into private.booking_payment_access(booking_id,token_hash) values ('${booking}',extensions.digest('${accessToken}','sha256')); insert into private.payment_attempts(booking_id,provider,idempotency_key,amount_minor,currency,pricing_id,status,provider_payment_id,provider_location_id,submitted_at,completed_at) values ('${booking}','square','hist-${randomUUID()}',2000,'USD','${pricing}','completed','hist-payment','sandbox',now(),now());`);
    const status = JSON.parse(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.get_payment_status('${booking}','${accessToken}');`));
    assert.equal(`${status.paid}|${status.amount_minor}|${status.currency}`, "true|2000|USD");
    const begin = JSON.parse(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.begin_payment_attempt('${booking}','${accessToken}','square');`));
    assert.equal(`${begin.action}|${begin.amount_minor}|${begin.currency}`, "paid|2000|USD");
    assert.equal(await query(`set request.jwt.claims = '{"role":"service_role"}'; select public.record_provider_payment_result('square',null,'api.create_payment','${booking}',(select id from private.payment_attempts where booking_id='${booking}'),'hist-payment','sandbox','COMPLETED',2000,'USD');`), "f");
    assert.equal(await query(`select status || '|' || payment_status || '|' || amount_paid from public.bookings where id='${booking}';`), "confirmed|paid|20");
    assert.equal(await query(`select count(*) from private.discount_redemptions where booking_id='${booking}';`), "0");
  });
});
