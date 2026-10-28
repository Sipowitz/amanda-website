import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const migrations = [
  "20261028000000_continuous_availability_periods.sql",
  "20261029000000_synchronize_period_availability_slots.sql",
  "20261030000000_availability_period_batch_preview.sql",
  "20261031000000_guarded_legacy_availability_cutover.sql",
];

test("period synchronization materializes safe appointment inventory", { timeout: 120000 }, async (t) => {
  const testScope = globalThis.process?.env.SYNC_TEST_SCOPE;
  const scoped = (name, fn) => t.test(name, {
    skip: testScope && !name.toLowerCase().includes(testScope.toLowerCase()),
  }, fn);
  const run = (command, args, input) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { error += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(input);
  });
  const pgBin = globalThis.process?.env.PG17_BIN || "/usr/lib/postgresql/17/bin";
  const root = await mkdtemp(join(tmpdir(), "amanda-slot-sync-"));
  const socket = join(root, "socket"), cluster = join(root, "data"), port = String(50001 + Math.floor(Math.random() * 10000));
  await mkdir(socket);
  await run(join(pgBin, "initdb"), ["-D", cluster, "-A", "trust", "-U", "postgres", "--no-locale", "--encoding", "UTF8"]);
  await run(join(pgBin, "pg_ctl"), ["-D", cluster, "-l", join(root, "postgres.log"), "-o", `-F -k ${socket} -p ${port}`, "-w", "start"]);
  t.after(async () => {
    await run(join(pgBin, "pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"]);
    await rm(root, { recursive: true, force: true });
  });
  const query = (sql) => run(join(pgBin, "psql"), ["-h", socket, "-p", port, "-U", "postgres", "-d", "postgres", "-XqAt", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  const [periodMigration, syncMigration, phase4Migration, phase5Migration] = await Promise.all(migrations.map((name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")));
  await query(`
    create role anon; create role authenticated; create role service_role;
    create schema private; create schema auth; create extension pgcrypto;
    create table public.email_settings(id boolean primary key, timezone text); insert into public.email_settings values(true,'America/Chicago');
    create function private.require_admin() returns void language plpgsql security definer set search_path='' as $$ begin
      if current_setting('request.jwt.claims',true) not like '%"admin":true%' and current_user <> 'service_role' then raise exception using errcode='42501',message='Administrator access is required.'; end if; end $$;
    create function public.get_business_timezone() returns text language sql stable security definer set search_path='' as $$ select 'America/Chicago'::text $$;
    create table public.availability_slots(
      id uuid primary key default gen_random_uuid(), slot_date date not null, slot_time text not null,
      starts_at timestamptz not null, is_available boolean not null default true,
      unique(slot_date,slot_time)
    );
    create function private.maintain_slot_start() returns trigger language plpgsql as $$ begin
      new.starts_at := (new.slot_date + new.slot_time::time) at time zone 'America/Chicago'; return new; end $$;
    create trigger availability_slots_maintain_starts_at before insert or update of slot_date,slot_time on public.availability_slots for each row execute function private.maintain_slot_start();
    create policy "Public can view future available slots" on public.availability_slots for select to anon,authenticated using (true);
    grant select, insert, update, delete on public.availability_slots to authenticated;
    create table public.bookings(
      id uuid primary key default gen_random_uuid(), slot_id uuid references public.availability_slots(id),
      status text not null, service_booking_mode_snapshot text not null,
      appointment_starts_at timestamptz, appointment_ends_at timestamptz
    );
    create table private.payment_attempts(id uuid primary key default gen_random_uuid(), booking_id uuid, status text not null);
    grant select, insert, update, delete on public.bookings to authenticated;
  `);
  await query(periodMigration);
  await query(syncMigration);
  await query(phase4Migration);
  await query(phase5Migration);
  await query("alter table public.bookings add constraint bookings_no_overlapping_active_timed_appointments check (true);");
  const asAdmin = (sql) => query(`set role authenticated; set request.jwt.claims='{"admin":true}'; ${sql}`);
  const create = async (start, end) => JSON.parse(await asAdmin(`select public.create_availability_period('${start}'::timestamp,'${end}'::timestamp);`));
  const slots = () => asAdmin("select coalesce(jsonb_agg(jsonb_build_object('date',slot_date,'time',slot_time,'source',availability_source,'available',is_available) order by slot_date,slot_time),'[]'::jsonb) from public.availability_slots;");
  const addBooking = (slotId, status = "confirmed") => query(`insert into public.bookings(slot_id,status,service_booking_mode_snapshot,appointment_starts_at,appointment_ends_at) select '${slotId}','${status}','timed',starts_at,starts_at+interval '60 minutes' from public.availability_slots where id='${slotId}' returning id;`);

  await scoped("standard, half-hour, earlier extension, and idempotency generate the anchored cadence", async () => {
    const created = await create("2032-01-06 10:30", "2032-01-06 14:30");
    assert.equal(created.reconciliation.slots_created, 4);
    assert.deepEqual(JSON.parse(await slots()).map((slot) => slot.time), ["10:30", "11:30", "12:30", "13:30"]);
    const extended = await create("2032-01-06 09:00", "2032-01-06 11:00");
    assert.equal(extended.reconciliation.slots_created, 1);
    assert.deepEqual(JSON.parse(await slots()).map((slot) => slot.time), ["09:30", "10:30", "11:30", "12:30", "13:30"]);
    const repeat = await create("2032-01-06 09:00", "2032-01-06 14:30");
    assert.equal(repeat.outcome, "unchanged");
    assert.equal(repeat.reconciliation.slots_created, 0);
  });

  await scoped("editing/deleting removes only unreferenced period inventory and preserves legacy/history", async () => {
    const period = await create("2032-01-07 10:00", "2032-01-07 13:00");
    const protectedSlot = JSON.parse(await asAdmin("select to_jsonb(s) from public.availability_slots s where slot_date='2032-01-07' and slot_time='11:00';"));
    await addBooking(protectedSlot.id, "pending_payment");
    const legacy = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-01-07','15:00','2032-01-07T21:00:00Z',true) returning id;");
    const changed = JSON.parse(await asAdmin(`select public.update_availability_period('${period.period.id}','2032-01-07 10:00'::timestamp,'2032-01-07 11:00'::timestamp);`));
    assert.equal(changed.reconciliation.obsolete_slots_deleted, 1);
    assert.equal(changed.reconciliation.protected_slots_preserved, 1);
    assert.equal(await asAdmin(`select is_available from public.availability_slots where id='${protectedSlot.id}';`), "f");
    await asAdmin(`update public.availability_slots set is_available=true where id='${protectedSlot.id}';`);
    assert.equal(await asAdmin(`select is_available from public.availability_slots where id='${protectedSlot.id}';`), "f");
    assert.equal(await asAdmin(`select count(*) from public.availability_slots where id='${legacy}';`), "1");
    const deleted = JSON.parse(await asAdmin(`select public.delete_availability_period('${period.period.id}');`));
    assert.equal(deleted.outcome, "deleted");
    assert.equal(await asAdmin(`select count(*) from public.availability_slots where id='${protectedSlot.id}';`), "1");
    assert.equal(await asAdmin(`select is_available from public.availability_slots where id='${protectedSlot.id}';`), "f");
  });

  await scoped("customer visibility excludes a different-start active appointment conflict", async () => {
    await create("2032-01-08 10:00", "2032-01-08 12:00");
    const first = await asAdmin("select id from public.availability_slots where slot_date='2032-01-08' and slot_time='10:00';");
    await addBooking(first, "confirmed");
    const secondBookable = await asAdmin("select public.slot_is_customer_bookable(s) from public.availability_slots s where slot_date='2032-01-08' and slot_time='11:00';");
    assert.equal(secondBookable, "t", "adjacent inventory remains visible");
    const overlapId = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-01-08','10:30','2032-01-08T16:30:00Z',true) returning id;");
    assert.equal(await asAdmin(`select public.slot_is_customer_bookable(s) from public.availability_slots s where id='${overlapId}';`), "f");
  });

  await scoped("Chicago DST/midnight policy skips ambiguous cadence occurrences and keeps full durations", async () => {
    const crossing = await create("2032-03-14 00:30", "2032-03-14 05:30");
    assert.ok(crossing.reconciliation.dst_occurrences_skipped >= 1);
    const localTimes = JSON.parse(await asAdmin("select coalesce(jsonb_agg(slot_time order by slot_time),'[]'::jsonb) from public.availability_slots where slot_date='2032-03-14';"));
    assert.ok(!localTimes.includes("02:30"));
  });

  await scoped("batch preview is read-only and batch creation is atomic", async () => {
    const payload = "jsonb_build_array(jsonb_build_object('start_local','2032-01-12T10:30','end_local','2032-01-12T12:30'),jsonb_build_object('start_local','2032-01-13T10:30','end_local','2032-01-13T12:30'))";
    const before = await query("select count(*) from public.availability_periods;");
    const preview = JSON.parse(await asAdmin(`set statement_timeout='5s'; select public.preview_availability_period_batch(${payload}, null::uuid);`));
    assert.equal(preview.outcome, "preview");
    assert.equal(await query("select count(*) from public.availability_periods;"), before);
    const created = JSON.parse(await asAdmin(`select public.create_availability_period_batch(${payload});`));
    assert.equal(created.periods_requested, 2);
    assert.equal(await query("select count(*) from public.availability_periods;"), String(Number(before) + 2));
    await create("2032-01-15 10:00", "2032-01-15 11:00");
    await create("2032-01-15 12:30", "2032-01-15 13:30");
    const countBeforeConflict = await query("select count(*) from public.availability_periods;");
    await assert.rejects(asAdmin("select public.create_availability_period_batch(jsonb_build_array(jsonb_build_object('start_local','2032-01-15T10:30','end_local','2032-01-15T13:00')));"), /incompatible appointment start times/);
    assert.equal(await query("select count(*) from public.availability_periods;"), countBeforeConflict);
  });

  await scoped("legacy cutover retires future inventory without breaking lifecycle updates", async () => {
    const legacy = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-02-01','10:00','2032-02-01T16:00:00Z',true) returning id;");
    const booked = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-02-01','11:00','2032-02-01T17:00:00Z',true) returning id;");
    await addBooking(booked, "confirmed");
    const preview = JSON.parse(await asAdmin("select public.preview_legacy_availability_cutover();"));
    assert.equal(preview.blockers.length, 0);
    const cutover = JSON.parse(await asAdmin("select public.activate_legacy_availability_cutover();"));
    assert.equal(await query(`select is_available is false and legacy_retired_at is not null from public.availability_slots where id='${legacy}';`), "t");
    await query(`update public.bookings set status='cancelled' where slot_id='${booked}'; update public.availability_slots set is_available=true where id='${booked}';`);
    assert.equal(await query(`select is_available from public.availability_slots where id='${booked}';`), "f");
    assert.equal(await query(`select count(*) from private.legacy_availability_cutover_slots where cutover_id='${cutover.cutover_id}';`), String(cutover.retired));
    assert.equal(JSON.parse(await asAdmin("select public.activate_legacy_availability_cutover();")).retired, 0);
  });

  await scoped("cutover preflight—not the retired-slot trigger—checks Phase 2-4 dependencies", async () => {
    await query("alter function public.slot_is_customer_bookable(public.availability_slots) rename to slot_is_customer_bookable_missing_for_test;");
    const blockedPreview = JSON.parse(await asAdmin("select public.preview_legacy_availability_cutover();"));
    assert.deepEqual(blockedPreview.blockers, ["Phase 2-4 availability prerequisites are missing."]);
    const retired = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available,legacy_retired_at) values('2032-02-02','10:00','2032-02-02T16:00:00Z',false,clock_timestamp()) returning id;");
    await query(`update public.availability_slots set is_available=true where id='${retired}';`);
    assert.equal(await query(`select is_available from public.availability_slots where id='${retired}';`), "f");
    await query("alter function public.slot_is_customer_bookable_missing_for_test(public.availability_slots) rename to slot_is_customer_bookable;");
  });

  await scoped("restoration is explicit, period-gated, idempotent, and never reopens active bookings", async () => {
    const unknown = JSON.parse(await asAdmin("select public.restore_legacy_availability_cutover(gen_random_uuid());"));
    assert.equal(unknown.outcome, "not_found");

    const eligible = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-03-02','10:00','2032-03-02T16:00:00Z',true) returning id;");
    const eligibleCutover = JSON.parse(await asAdmin("select public.activate_legacy_availability_cutover();"));
    // The production trigger normally adopts a matching retired row as soon
    // as an administrator creates the period.  Disable it only here to reach
    // the explicit restoration RPC's otherwise-unreachable eligible branch.
    await query("alter table public.availability_periods disable trigger availability_periods_adopt_retired_legacy_slots;");
    await create("2032-03-02 10:00", "2032-03-02 11:00");
    await query("alter table public.availability_periods enable trigger availability_periods_adopt_retired_legacy_slots;");
    const restored = JSON.parse(await asAdmin(`select public.restore_legacy_availability_cutover('${eligibleCutover.cutover_id}');`));
    assert.equal(restored.slots_restored, 1);
    assert.equal(await query(`select availability_source='period' and is_available and legacy_retired_at is null from public.availability_slots where id='${eligible}';`), "t");
    assert.equal(JSON.parse(await asAdmin(`select public.restore_legacy_availability_cutover('${eligibleCutover.cutover_id}');`)).slots_restored, 0);

    const protectedSlot = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-03-03','10:00','2032-03-03T16:00:00Z',true) returning id;");
    await create("2032-03-03 10:00", "2032-03-03 11:00");
    await addBooking(protectedSlot, "confirmed");
    const protectedCutover = JSON.parse(await asAdmin("select public.activate_legacy_availability_cutover();"));
    const blocked = JSON.parse(await asAdmin(`select public.restore_legacy_availability_cutover('${protectedCutover.cutover_id}');`));
    assert.equal(blocked.slots_restored, 0);
    assert.equal(await query(`select is_available is false and legacy_retired_at is not null from public.availability_slots where id='${protectedSlot}';`), "t");
    assert.equal(await query(`select count(*) from public.bookings where slot_id='${protectedSlot}';`), "1");

    const uncovered = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-03-04','10:00','2032-03-04T16:00:00Z',true) returning id;");
    const uncoveredCutover = JSON.parse(await asAdmin("select public.activate_legacy_availability_cutover();"));
    assert.equal(JSON.parse(await asAdmin(`select public.restore_legacy_availability_cutover('${uncoveredCutover.cutover_id}');`)).slots_restored, 0);
    assert.equal(await query(`select is_available is false and legacy_retired_at is not null from public.availability_slots where id='${uncovered}';`), "t");

    const conflictSlot = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-03-05','10:00','2032-03-05T16:00:00Z',true) returning id;");
    const conflictCutover = JSON.parse(await asAdmin("select public.activate_legacy_availability_cutover();"));
    await query("alter table public.availability_periods disable trigger availability_periods_adopt_retired_legacy_slots;");
    await create("2032-03-05 10:00", "2032-03-05 11:00");
    await query("alter table public.availability_periods enable trigger availability_periods_adopt_retired_legacy_slots;");
    const overlappingSlot = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-03-05','10:30','2032-03-05T16:30:00Z',true) returning id;");
    await addBooking(overlappingSlot, "confirmed");
    assert.equal(JSON.parse(await asAdmin(`select public.restore_legacy_availability_cutover('${conflictCutover.cutover_id}');`)).slots_restored, 0);
    assert.equal(await query(`select is_available is false and legacy_retired_at is not null from public.availability_slots where id='${conflictSlot}';`), "t");
  });

  await scoped("cutover serializes concurrent activation, period reconciliation, and reopen attempts", async () => {
    const first = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-04-01','10:00','2032-04-01T16:00:00Z',true) returning id;");
    const second = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-04-01','11:00','2032-04-01T17:00:00Z',true) returning id;");
    const activations = await Promise.all([
      asAdmin("set lock_timeout='5s'; select public.activate_legacy_availability_cutover();"),
      asAdmin("set lock_timeout='5s'; select public.activate_legacy_availability_cutover();"),
    ]);
    const retired = activations.map(JSON.parse).reduce((total, result) => total + result.retired, 0);
    assert.equal(retired, 2);
    assert.equal(await query(`select bool_and(is_available is false and legacy_retired_at is not null) from public.availability_slots where id in ('${first}','${second}');`), "t");

    await Promise.all([
      query(`update public.availability_slots set is_available=true where id='${first}';`),
      query(`update public.availability_slots set is_available=true where id='${first}';`),
    ]);
    assert.equal(await query(`select is_available from public.availability_slots where id='${first}';`), "f");

    const reconciledLegacy = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-04-02','10:00','2032-04-02T16:00:00Z',true) returning id;");
    await Promise.all([
      asAdmin("set lock_timeout='5s'; select public.activate_legacy_availability_cutover();"),
      create("2032-04-02 10:00", "2032-04-02 11:00"),
    ]);
    assert.equal(await query(`select availability_source='period' and is_available and legacy_retired_at is null from public.availability_slots where id='${reconciledLegacy}';`), "t");

    const bookingRaceSlot = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-04-03','09:00','2032-04-03T15:00:00Z',true) returning id;");
    const bookingRace = await Promise.allSettled([
      asAdmin("set lock_timeout='5s'; select public.activate_legacy_availability_cutover();"),
      addBooking(bookingRaceSlot, "confirmed"),
    ]);
    assert.equal(bookingRace.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(await query(`select count(*) from public.bookings where slot_id='${bookingRaceSlot}';`), "1");
    assert.equal(await query(`select is_available is false and legacy_retired_at is not null from public.availability_slots where id='${bookingRaceSlot}';`), "t");

    const cancellationSlot = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-04-03','10:00','2032-04-03T16:00:00Z',true) returning id;");
    const cancellationBooking = await addBooking(cancellationSlot, "confirmed");
    await Promise.all([
      asAdmin("set lock_timeout='5s'; select public.activate_legacy_availability_cutover();"),
      query(`begin; set local lock_timeout='5s'; update public.bookings set status='cancelled' where id='${cancellationBooking}'; update public.availability_slots set is_available=true where id='${cancellationSlot}'; commit;`),
    ]);
    assert.equal(await query(`select status from public.bookings where id='${cancellationBooking}';`), "cancelled");
    assert.equal(await query(`select is_available is false and legacy_retired_at is not null from public.availability_slots where id='${cancellationSlot}';`), "t");

    const expirySlot = await query("insert into public.availability_slots(slot_date,slot_time,starts_at,is_available) values('2032-04-04','10:00','2032-04-04T16:00:00Z',true) returning id;");
    const expiryBooking = await addBooking(expirySlot, "pending_payment");
    const expiryAttempt = await query(`insert into private.payment_attempts(booking_id,status) values('${expiryBooking}','reserved') returning id;`);
    const expiryRace = await Promise.allSettled([
      asAdmin("set lock_timeout='5s'; select public.activate_legacy_availability_cutover();"),
      query(`begin; set local lock_timeout='5s'; update private.payment_attempts set status='expired' where id='${expiryAttempt}'; update public.bookings set status='payment_expired' where id='${expiryBooking}'; update public.availability_slots set is_available=true where id='${expirySlot}'; commit;`),
    ]);
    assert.equal(expiryRace[1].status, "fulfilled");
    if (expiryRace[0].status === "rejected") {
      assert.match(String(expiryRace[0].reason), /Unresolved payment attempts block legacy cutover/);
      await asAdmin("select public.activate_legacy_availability_cutover();");
    }
    assert.equal(await query(`select status from private.payment_attempts where id='${expiryAttempt}';`), "expired");
    assert.equal(await query(`select status from public.bookings where id='${expiryBooking}';`), "payment_expired");
    assert.equal(await query(`select is_available is false and legacy_retired_at is not null from public.availability_slots where id='${expirySlot}';`), "t");
  });
});
