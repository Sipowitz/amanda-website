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
  assert.ok(result, `Missing real function ${name}`);
  return result;
};

// Real PostgreSQL executes the new RPC and existing submission/restart/expiry
// functions. An isolated fixture supplies only the tables those functions use;
// this does not apply historical data migrations or contact Supabase/Square.
test("timed checkout abandonment in PostgreSQL", { timeout: 300000 }, async (t) => {
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status !== 0) {
    t.skip("Requires Docker with local postgres:17 image (docker pull postgres:17).");
    return;
  }
  const container = `amanda-abandon-test-${randomUUID()}`;
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
  const psqlArgs = ["exec", "-i", "-e", "PGOPTIONS=-c statement_timeout=15000 -c idle_in_transaction_session_timeout=20000", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-XqAt", "-v", "ON_ERROR_STOP=1"];
  const query = (sql) => exec(psqlArgs, sql);
  for (let i = 0; ; i++) {
    try { await query("select 1;"); break; } catch (error) {
      if (i === 50) throw error;
      await delay(100);
    }
  }
  const phaseOne = await read("20260818001000_direct_payment_phase_one.sql");
  const lifecycle = await read("20260904000000_timed_direct_payment_lifecycle.sql");
  const migration = await read("20260905000000_abandon_timed_payment_checkout.sql");
  const admin = await read("20260904001000_direct_payment_admin_lifecycle.sql");
  const services = await read("20260817210000_add_booking_services.sql");
  const security = await read("20260817185300_booking_security_admin_foundation.sql");
  const attempts = phaseOne.match(/create table private.payment_attempts \([^]*?\n\);/)?.[0];
  assert.ok(attempts);
  await query(`
    create schema private; create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role;
    create function auth.jwt() returns jsonb language sql as
      $$ select current_setting('request.jwt.claims', true)::jsonb $$;
    create function auth.uid() returns uuid language sql as
      $$ select (auth.jwt() ->> 'sub')::uuid $$;
    create table public.admin_users (user_id uuid primary key);
    insert into public.admin_users values ('123e4567-e89b-42d3-a456-426614174099');
    ${functionSql(security, "public.is_admin")}
    ${functionSql(security, "private.require_admin")}
    create table public.availability_slots (
      id uuid primary key, slot_date date default current_date + 1, slot_time time default '12:00', is_available boolean default false
    );
    create table public.bookings (
      id uuid primary key, slot_id uuid references public.availability_slots,
      status text default 'pending_payment', payment_status text default 'unpaid',
      service_payment_flow_snapshot text default 'direct_payment',
      service_booking_mode_snapshot text default 'timed',
      service_name_snapshot text default 'Private Readings',
      service_price_amount_snapshot integer default 8500,
      service_currency_snapshot text default 'USD',
      amount_due numeric default 85, amount_paid numeric default 0,
      customer_name text default 'Customer', customer_email text default 'customer@example.test',
      customer_phone text, customer_message text, paid_at timestamptz,
      payment_method text, payment_reference text, confirmed_at timestamptz,
      cancelled_at timestamptz, updated_at timestamptz default now()
    );
    create unique index bookings_one_active_booking_per_slot on public.bookings(slot_id)
      where status in ('pending', 'pending_payment', 'confirmed', 'completed', 'no_show');
    create table private.booking_payment_access (booking_id uuid primary key references public.bookings, token_hash bytea);
    create table public.booking_email_config (id boolean primary key, admin_email text, admin_name text);
    insert into public.booking_email_config values (true, 'admin@example.test', 'Admin');
    create table public.test_emails (booking_id uuid, template text);
    create function public.queue_booking_email(uuid, text, text, text, jsonb)
      returns boolean language plpgsql as $$ begin
        insert into public.test_emails values ($1, $2); return true;
      end; $$;
    create table public.test_releases (slot_id uuid);
    create function public.observe_release() returns trigger language plpgsql as $$ begin
      if new.is_available and not old.is_available then
        insert into public.test_releases values (new.id);
      end if; return new;
    end; $$;
    create trigger observe_release after update on public.availability_slots
      for each row execute function public.observe_release();
    create table public.test_slot_writes (slot_id uuid);
    create function public.observe_slot_write() returns trigger language plpgsql as $$ begin
      insert into public.test_slot_writes values (new.id); return new;
    end; $$;
    create trigger observe_slot_write after update on public.availability_slots
      for each row execute function public.observe_slot_write();
    ${phaseOne.match(/create table private.payment_webhook_events \([^]*?\n\);/)?.[0]}
    ${attempts}
    create unique index payment_attempts_one_active_per_booking on private.payment_attempts(booking_id)
      where status in ('reserved', 'processing', 'unknown');
    ${functionSql(phaseOne, "public.mark_payment_attempt_processing")}
    ${functionSql(lifecycle, "public.begin_payment_attempt")}
    ${functionSql(lifecycle, "public.fail_payment_attempt")}
    ${functionSql(lifecycle, "public.record_provider_payment_result")}
    ${functionSql(lifecycle, "private.expire_stale_reserved_payment_attempts")}
    ${functionSql(services, "private.cancel_booking")}
    ${functionSql(admin, "public.cancel_booking")}
    ${migration}
  `);
  const booking = "123e4567-e89b-42d3-a456-426614174000";
  const attempt = "123e4567-e89b-42d3-a456-426614174001";
  const slot = "123e4567-e89b-42d3-a456-426614174002";
  const token = "a".repeat(64);
  const auth = `set request.jwt.claims = '{"role":"service_role"}';`;
  const abandon = `select public.abandon_timed_payment_booking('${booking}', '${token}', '${attempt}');`;
  const submit = `select public.mark_payment_attempt_processing('${booking}', '${attempt}', 'sandbox-location');`;
  const restart = `select public.begin_payment_attempt('${booking}', '${token}', 'square');`;
  const adminCancel = `set request.jwt.claims = '{"role":"authenticated","sub":"123e4567-e89b-42d3-a456-426614174099"}'; select public.cancel_booking('${booking}');`;
  const reset = () => query(`
    truncate private.payment_attempts, private.booking_payment_access, private.payment_webhook_events, public.bookings, public.availability_slots, public.test_emails, public.test_releases, public.test_slot_writes;
    insert into public.availability_slots(id) values ('${slot}');
    insert into public.bookings(id, slot_id) values ('${booking}', '${slot}');
    insert into private.booking_payment_access values ('${booking}', extensions.digest('${token}', 'sha256'));
    insert into private.payment_attempts(id, booking_id, provider, idempotency_key, amount_minor, currency)
      values ('${attempt}', '${booking}', 'square', 'test-attempt', 8500, 'USD');
  `);
  const snapshot = () => query(`select jsonb_build_object(
    'bookings', (select jsonb_agg(to_jsonb(b)) from public.bookings b),
    'attempts', (select jsonb_agg(to_jsonb(a)) from private.payment_attempts a),
    'slots', (select jsonb_agg(to_jsonb(s)) from public.availability_slots s));`);

  await t.test("safe reservation is terminally cancelled, releases slot, emits no email and creates no booking", async () => {
    await reset();
    assert.equal(await query(auth + abandon), "t");
    assert.equal(await query(`select status from public.bookings; select status from private.payment_attempts; select is_available from public.availability_slots; select count(*) from public.bookings;`), "cancelled\ncancelled\nt\n1");
    assert.doesNotMatch(migration, /perform .*queue|insert into .*email|private.cancel_booking/i);
    await assert.rejects(query(auth + restart), /not eligible/);
    await assert.rejects(query(auth + submit), /no longer eligible/);
  });

  await t.test("repeat acknowledgement cannot release a replacement booking's slot", async () => {
    await reset();
    await query(auth + abandon);
    await query(`insert into public.bookings(id, slot_id) values (gen_random_uuid(), '${slot}'); update public.availability_slots set is_available = false;`);
    const before = await snapshot();
    assert.equal(await query(auth + abandon), "t");
    assert.equal(await snapshot(), before);
  });

  for (const [name, mutation] of [
    ["processing", "update private.payment_attempts set status = 'processing', submitted_at = now();"],
    ["unknown", "update private.payment_attempts set status = 'unknown', submitted_at = now();"],
    ["submitted reservation", "update private.payment_attempts set submitted_at = now();"],
    ["completed/paid", "update private.payment_attempts set status = 'completed', submitted_at = now(), completed_at = now(), provider_payment_id = 'paid'; update public.bookings set status = 'confirmed', payment_status = 'paid', amount_paid = 85;"],
    ["provider status on reservation", "update private.payment_attempts set provider_status = 'PENDING';"],
    ["completion marker on reservation", "update private.payment_attempts set completed_at = now();"],
    ["provider result on reservation", "update private.payment_attempts set provider_payment_id = 'unresolved';"],
    ["untimed Voice Memo", "update public.bookings set service_booking_mode_snapshot = 'untimed', slot_id = null;"],
    ["payment-link booking", "update public.bookings set service_payment_flow_snapshot = 'payment_link';"],
    ["partially paid booking", "update public.bookings set amount_paid = 1;"],
    ["lost slot ownership", "update public.availability_slots set is_available = true;"],
    ["missing active attempt", "delete from private.payment_attempts;"],
    ["submitted expiry", "update private.payment_attempts set status = 'expired', submitted_at = now(); update public.bookings set status = 'payment_expired';"],
    ["failure without definitive result", "update private.payment_attempts set status = 'failed', submitted_at = now(), failed_at = now(); update public.bookings set status = 'payment_expired';"],
    ["failure with unresolved provider status", "update private.payment_attempts set status = 'failed', submitted_at = now(), failed_at = now(), provider_status = 'PENDING'; update public.bookings set status = 'payment_expired';"],
    ["unrelated cancellation", "update private.payment_attempts set status = 'cancelled'; update public.bookings set status = 'cancelled';"],
  ]) {
    await t.test(`${name} cannot be abandoned or release a slot`, async () => {
      await reset(); await query(mutation);
      const before = await snapshot();
      await assert.rejects(query(auth + abandon));
      assert.equal(await snapshot(), before);
    });
  }

  await t.test("token, booking identity and service-role authorization are mandatory", async () => {
    await reset(); const before = await snapshot();
    await assert.rejects(query(auth + abandon.replace(token, "b".repeat(64))), /Payment access is invalid/);
    await assert.rejects(query(auth + abandon.replace(booking, slot)), /Payment access is invalid/);
    await assert.rejects(query(`set request.jwt.claims = '{"role":"authenticated"}';${abandon}`), /Service-role access/);
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(query(`${auth}set role ${role};${abandon}`), /permission denied/);
    }
    assert.equal(await query(`${auth}set role service_role;${abandon}`), "t");
    assert.notEqual(await snapshot(), before);
  });

  // Hold a real transaction open and observe the competing database session
  // waiting on its lock, rather than approximating a race with sequential calls.
  async function race(firstSql, secondSql) {
    const visibleAvailability = await query("select is_available from public.availability_slots;");
    const holder = spawn("docker", psqlArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    holder.stderr.on("data", (data) => { errors += data; });
    const done = new Promise((resolve, reject) => {
      holder.on("error", reject);
      holder.on("close", (code) => code === 0 ? resolve() : reject(new Error(errors)));
    });
    const ready = new Promise((resolve, reject) => {
      holder.stdout.on("data", (data) => { output += data; if (output.includes("LOCK_HELD")) resolve(); });
      done.then(() => reject(new Error("Lock holder exited before signalling readiness")), reject);
    });
    holder.stdin.write(`${auth}begin;${firstSql}\n\\echo LOCK_HELD\n`);
    await ready;
    // Uncommitted cancellation must not make the slot available to other clients.
    assert.equal(await query("select is_available from public.availability_slots;"), visibleAvailability);
    const competing = query(`${auth}set application_name = 'abandon-race';${secondSql}`)
      .then((value) => ({ value }), (error) => ({ error }));
    try {
      for (let i = 0; ; i++) {
        const blocked = await query("select count(*) from pg_stat_activity where application_name = 'abandon-race' and wait_event_type = 'Lock';");
        if (blocked === "1") break;
        if (i === 50) throw new Error("Competing transaction never waited on lock");
        await delay(20);
      }
    } finally {
      holder.stdin.end("commit;\n");
      await done;
    }
    return competing;
  }

  await t.test("submission wins race: abandonment waits then refuses, slot remains held", async () => {
    await reset();
    const result = await race(submit, abandon);
    assert.match(result.error?.message || "", /submission may have begun/);
    assert.equal(await query("select status from private.payment_attempts; select is_available from public.availability_slots;"), "processing\nf");
  });

  await t.test("abandonment wins race: submission waits then refuses, slot releases only at commit", async () => {
    await reset();
    const result = await race(abandon, submit);
    assert.match(result.error?.message || "", /no longer eligible/);
    assert.equal(await query("select status from private.payment_attempts; select is_available from public.availability_slots;"), "cancelled\nt");
  });

  await t.test("concurrent repeated abandonment acknowledges the same terminal cancellation", async () => {
    await reset();
    const result = await race(abandon, abandon);
    assert.equal(result.value, "t");
    assert.equal(await query("select count(*) from public.bookings; select is_available from public.availability_slots;"), "1\nt");
  });

  await t.test("stale-tab restart waits for abandonment then cannot resurrect the booking", async () => {
    await reset();
    const result = await race(abandon, restart);
    assert.match(result.error?.message || "", /not eligible/);
    assert.equal(await query("select status from public.bookings;"), "cancelled");
  });

  await t.test("expiry wins race: abandonment closes the expired booking without releasing twice", async () => {
    await reset();
    await query("update private.payment_attempts set created_at = now() - interval '61 minutes';");
    const result = await race("select private.expire_stale_reserved_payment_attempts();", abandon);
    assert.equal(result.value, "t");
    assert.equal(await query("select status from public.bookings; select is_available from public.availability_slots; select count(*) from public.test_releases;"), "cancelled\nt\n1");
  });

  await t.test("abandonment wins race: expiry cannot alter the terminal cancellation", async () => {
    await reset();
    await query("update private.payment_attempts set created_at = now() - interval '61 minutes';");
    const result = await race(abandon, "select private.expire_stale_reserved_payment_attempts();");
    assert.equal(result.value, "0");
    assert.equal(await query("select status from public.bookings; select is_available from public.availability_slots;"), "cancelled\nt");
  });

  const fail = `select public.fail_payment_attempt('${booking}', '${attempt}', 'FAILED', 'CARD_DECLINED', 'Declined');`;
  const completed = (eventId = "null") => `select public.record_provider_payment_result(
    'square', ${eventId}, 'payment.updated', '${booking}', '${attempt}', 'square-payment',
    'sandbox-location', 'COMPLETED', 8500, 'USD');`;
  const declined = async () => { await reset(); await query(auth + submit + fail); };

  for (const outcome of ["failed", "expired"]) {
    await t.test(`${outcome} can retry until Choose new permanently closes it, preserving history`, async () => {
      if (outcome === "failed") await declined();
      else {
        await reset();
        await query("update private.payment_attempts set created_at = now() - interval '61 minutes'; select private.expire_stale_reserved_payment_attempts();");
      }
      const history = await query("select jsonb_build_array(submitted_at, provider_status, failure_code, failed_at, expired_at) from private.payment_attempts;");
      await query(auth + abandon);
      assert.equal(await query("select status from public.bookings; select status from private.payment_attempts; select count(*) from public.test_releases; select count(*) from public.test_emails;"), "cancelled\ncancelled\n1\n0");
      assert.equal(await query("select jsonb_build_array(submitted_at, provider_status, failure_code, failed_at, expired_at) from private.payment_attempts;"), history);
      await assert.rejects(query(auth + restart), /not eligible/);
      await assert.rejects(query(auth + submit), /no longer eligible/);
      assert.equal(await query(auth + abandon), "t");
      await query(`insert into public.bookings(id, slot_id) values (gen_random_uuid(), '${slot}'); update public.availability_slots set is_available = false;`);
      const before = await snapshot();
      assert.equal(await query(auth + abandon), "t");
      assert.equal(await snapshot(), before);
      assert.equal(await query("select count(*) from public.test_releases;"), "1");
    });
  }

  await t.test("closing an expired booking never changes the slot already acquired by another booking", async () => {
    await declined();
    await query(`insert into public.bookings(id, slot_id) values (gen_random_uuid(), '${slot}'); update public.availability_slots set is_available = false;`);
    await query(auth + abandon);
    assert.equal(await query("select is_available from public.availability_slots; select count(*) from public.test_releases;"), "f\n1");
  });

  await t.test("retry wins first: stale Choose new cannot cancel even the new unsubmitted reservation", async () => {
    await declined();
    const result = await race(restart, abandon);
    assert.match(result.error?.message || "", /attempt changed/);
    assert.equal(await query("select status from public.bookings; select is_available from public.availability_slots;"), "pending_payment\nf");
  });

  await t.test("Choose new wins first: another tab cannot restart the failed checkout", async () => {
    await declined();
    const result = await race(abandon, restart);
    assert.match(result.error?.message || "", /not eligible/);
    await assert.rejects(query(auth + submit), /no longer eligible/);
  });

  for (const source of ["API", "webhook"]) {
    const completion = completed(source === "webhook" ? "'signed-event'" : "null");
    await t.test(`${source} completion wins: Choose new rejects paid booking; exactly two emails`, async () => {
      await reset(); await query(auth + submit);
      const result = await race(completion, abandon);
      assert.match(result.error?.message || "", /cannot be abandoned/);
      assert.equal(await query("select status from public.bookings; select payment_status from public.bookings; select is_available from public.availability_slots; select count(*) from public.test_emails;"), "confirmed\npaid\nf\n2");
      await query(auth + completion);
      assert.equal(await query("select count(*) from public.test_emails;"), "2");
    });
    await t.test(`abandonment wins: stale ${source} completion cannot resurrect the booking`, async () => {
      await reset();
      const result = await race(abandon, completion);
      assert.ok(result.error);
      assert.equal(await query("select status from public.bookings; select count(*) from public.test_emails;"), "cancelled\n0");
    });
  }

  await t.test("existing decline/retry and one-hour expiry keep their behavior", async () => {
    await reset();
    await query("update private.payment_attempts set status = 'failed', submitted_at = now(); update public.bookings set status = 'payment_expired'; update public.availability_slots set is_available = true;");
    assert.equal(JSON.parse(await query(auth + restart)).action, "submit");
    assert.equal(await query("select is_available from public.availability_slots;"), "f");
    await reset();
    assert.equal(await query("select private.expire_stale_reserved_payment_attempts();"), "0");
    await query("update private.payment_attempts set created_at = now() - interval '61 minutes';");
    assert.equal(await query("select private.expire_stale_reserved_payment_attempts();"), "1");
    assert.equal(await query("select status from public.bookings; select is_available from public.availability_slots;"), "payment_expired\nt");
    for (const status of ["processing", "unknown"]) {
      await reset();
      await query(`update private.payment_attempts set status = '${status}', submitted_at = now(), created_at = now() - interval '2 hours';`);
      assert.equal(await query("select private.expire_stale_reserved_payment_attempts();"), "0");
      assert.equal(await query("select is_available from public.availability_slots;"), "f");
    }
  });

  await t.test("admin cancellation acknowledges without any writes, including repeat and two-tab acknowledgement", async () => {
    await reset();
    assert.equal(await query(adminCancel), "t");
    assert.equal(await query("select status from public.bookings; select status from private.payment_attempts; select checkout_abandoned_at is null from private.payment_attempts; select is_available from public.availability_slots; select count(*) from public.test_releases; select count(*) from public.test_emails;"), "cancelled\ncancelled\nt\nt\n1\n1");
    const before = await snapshot();
    assert.equal(await query(auth + abandon), "t");
    assert.equal((await race(abandon, abandon)).value, "t");
    assert.equal(await snapshot(), before, "acknowledgement preserves every booking, attempt and slot column");
    assert.equal(await query("select count(*) from public.test_slot_writes; select count(*) from public.test_emails;"), "1\n1");
    await assert.rejects(query(auth + restart), /not eligible/);
    await assert.rejects(query(auth + submit), /no longer eligible/);
    await assert.rejects(query(auth + abandon.replace(token, "b".repeat(64))), /Payment access is invalid/);
    await assert.rejects(query(auth + abandon.replace(attempt, slot)), /attempt changed/);
  });

  for (const [name, mutation] of [
    ["missing lifecycle timestamp", "update public.bookings set cancelled_at = null;"],
    ["submitted cancelled attempt", "update private.payment_attempts set submitted_at = now();"],
    ["provider payment evidence", "update private.payment_attempts set provider_payment_id = 'possible-charge';"],
    ["provider location evidence", "update private.payment_attempts set provider_location_id = 'sandbox-location';"],
    ["provider status evidence", "update private.payment_attempts set provider_status = 'PENDING';"],
    ["completion evidence", "update private.payment_attempts set completed_at = now();"],
    ["booking paid evidence", "update public.bookings set paid_at = now();"],
    ["booking payment reference", "update public.bookings set payment_reference = 'possible-charge';"],
    ["processing cancelled booking", "update private.payment_attempts set status = 'processing', submitted_at = now();"],
    ["unknown cancelled booking", "update private.payment_attempts set status = 'unknown', submitted_at = now();"],
    ["paid cancelled booking", "update public.bookings set payment_status = 'paid', amount_paid = 85;"],
    ["unresolved older submission", "insert into private.payment_attempts(booking_id, provider, idempotency_key, amount_minor, currency, status, submitted_at, created_at, provider_status) select booking_id, provider, 'older', amount_minor, currency, 'failed', now(), created_at - interval '1 minute', 'PENDING' from private.payment_attempts;"],
  ]) {
    await t.test(`admin cancellation with ${name} cannot be acknowledged`, async () => {
      await reset(); await query(adminCancel); await query(mutation);
      const before = await snapshot();
      await assert.rejects(query(auth + abandon));
      assert.equal(await snapshot(), before);
      assert.equal(await query("select count(*) from public.test_slot_writes;"), "1");
    });
  }

  await t.test("admin cancellation wins retry or submission race: stale tab cannot restart or submit", async () => {
    for (const action of [restart, submit]) {
      await reset();
      const result = await race(adminCancel, action);
      assert.match(result.error?.message || "", /not eligible|no longer eligible/);
      assert.equal(await query(auth + abandon), "t");
    }
  });

  await t.test("retry first: admin may cancel the new never-submitted attempt, stale customer attempt ID is rejected", async () => {
    await declined();
    const result = await race(restart, adminCancel);
    assert.equal(result.value, "t");
    await assert.rejects(query(auth + abandon), /attempt changed/);
    const newAttempt = await query("select id from private.payment_attempts where status = 'cancelled';");
    assert.equal(await query(auth + abandon.replace(attempt, newAttempt)), "t");
    await assert.rejects(query(auth + restart), /not eligible/);
  });

  await t.test("submission first: admin cancellation cannot cancel a processing payment", async () => {
    await reset();
    assert.match((await race(submit, adminCancel)).error?.message || "", /after payment submission/);
    await assert.rejects(query(auth + abandon));
    assert.equal(await query("select is_available from public.availability_slots;"), "f");
  });

  await t.test("unknown payment rejects both admin cancellation and customer acknowledgement", async () => {
    await reset(); await query(auth + submit);
    await query("update private.payment_attempts set status = 'unknown';");
    await assert.rejects(query(adminCancel), /after payment submission/);
    await assert.rejects(query(auth + abandon));
    assert.equal(await query("select count(*) from public.test_slot_writes;"), "0");
  });

  for (const source of ["API", "webhook"]) {
    const completion = completed(source === "webhook" ? "'admin-race-event'" : "null");
    await t.test(`${source} completion and admin cancellation serialize without resurrection or release of a paid slot`, async () => {
      await reset(); await query(auth + submit);
      assert.match((await race(completion, adminCancel)).error?.message || "", /Only an awaiting/);
      await assert.rejects(query(auth + abandon));
      assert.equal(await query("select payment_status from public.bookings; select count(*) from public.test_slot_writes;"), "paid\n0");
      await reset();
      assert.ok((await race(adminCancel, completion)).error);
      assert.equal(await query(auth + abandon), "t");
      assert.equal(await query("select status from public.bookings; select count(*) from public.test_slot_writes;"), "cancelled\n1");
    });
  }

  // One integration crosses the real admin RPC, the acknowledgement RPC, and
  // the existing React entry/reset path. Only HTTP and the browser SDK are
  // substituted; acknowledgement success is never invented by a frontend mock.
  for (const entry of ["reload", "mounted"]) {
    await t.test(`real admin cancellation to empty fresh React selection (${entry}), with replacement slot protected`, async (t) => {
      const { mount } = await import("../test-support/timedCheckoutHarness.js");
      await reset();
      await query("update public.bookings set customer_name = 'Old customer', customer_email = 'old@example.test', customer_phone = '123', customer_message = 'Old private topic';");
      const status = async () => JSON.parse(await query(`select jsonb_build_object(
        'serviceId', 'service', 'bookingMode', b.service_booking_mode_snapshot,
        'bookingStatus', b.status, 'paymentStatus', b.payment_status,
        'paid', b.payment_status = 'paid', 'canRestart', false,
        'attemptId', a.id, 'attemptStatus', a.status, 'amountMinor', a.amount_minor, 'currency', a.currency,
        'buyerContact', jsonb_build_object('givenName', b.customer_name, 'email', b.customer_email),
        'bookingDetails', jsonb_build_object('name', b.customer_name, 'email', b.customer_email, 'phone', b.customer_phone, 'message', b.customer_message)
      ) from public.bookings b join private.payment_attempts a on a.booking_id = b.id where b.id = '${booking}';`));
      const transport = {
        status,
        initialize: async () => {
          const result = JSON.parse(await query(auth + restart));
          return { ...await status(), attemptId: result.attempt_id };
        },
        submit: async () => query(auth + submit),
        slots: async () => JSON.parse(await query("select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.availability_slots s where is_available;")),
      };
      const options = { state: "cancelled", transport, abandon: async ({ args, storage, key }) => {
        assert.deepEqual(args, [booking, token, attempt]);
        assert.ok(storage.has(key));
        const result = await query(auth + abandon);
        return { abandoned: result === "t" };
      } };
      let run;
      if (entry === "mounted") {
        run = await mount(t, options);
        await run.waitFor(() => JSON.stringify(run.root.toJSON()).includes("Old private topic") && run.root.root.findAllByType("button").some((b) => b.props.type !== 'button' && b.props.disabled === false));
      }
      await query(adminCancel);
      assert.equal(await query("select count(*) from public.test_releases; select checkout_abandoned_at is null from private.payment_attempts;"), "1\nt");
      await query(`insert into public.bookings(id, slot_id) values (gen_random_uuid(), '${slot}'); update public.availability_slots set is_available = false;
        insert into public.availability_slots(id, slot_date, is_available) values ('123e4567-e89b-42d3-a456-426614174004', '2026-12-20', true);`);
      const before = await snapshot();
      const writes = await query("select count(*) from public.test_slot_writes;");
      if (entry === "reload") run = await mount(t, options);
      else {
        await run.submit(); // A stale card attempts submission after admin cancellation.
        await run.click("Choose a new appointment");
      }
      await run.waitFor(() => Boolean(run.button("Select date")));
      assert.equal(run.storage.has(run.key), false);
      assert.equal(run.calls.filter((call) => call === "clear").length, 1);
      await run.click("Select date"); await run.click("Select slot");
      assert.deepEqual(Object.fromEntries([...run.root.root.findAllByType("input"), ...run.root.root.findAllByType("textarea")].map((f) => [f.props.name, f.props.value])), { name: "", email: "", phone: "", message: "" });
      assert.equal(JSON.stringify(run.root.toJSON()).includes("Old private topic"), false);
      assert.equal(await snapshot(), before);
      assert.equal(await query("select count(*) from public.test_slot_writes;"), writes);
      assert.equal(await query(auth + abandon), "t");
      await assert.rejects(query(auth + restart), /not eligible/);
      await assert.rejects(query(auth + submit), /no longer eligible/);
    });
  }

});
