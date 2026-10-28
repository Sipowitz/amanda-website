import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20261027000000_timed_booking_range_conflicts.sql",
  import.meta.url,
);

test("timed booking migration derives immutable ranges and excludes active temporal overlaps", { timeout: 120000 }, async (t) => {
  const run = (command, args, input) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let error = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { error += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(input);
  });
  let query;
  if (spawnSync("docker", ["image", "inspect", "postgres:17"], { stdio: "ignore" }).status === 0) {
    const container = `amanda-appointment-conflict-${randomUUID()}`;
    await run("docker", ["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]);
    t.after(() => run("docker", ["rm", "-f", container]));
    query = (sql) => run("docker", ["exec", "-i", "-e", "PGOPTIONS=-c statement_timeout=10000", container,
      "psql", "-h", "127.0.0.1", "-U", "postgres", "-XqAt", "-v", "ON_ERROR_STOP=1"], sql);
  } else {
    const pgBin = globalThis.process?.env.PG17_BIN || "/usr/lib/postgresql/17/bin";
    const root = await mkdtemp(join(tmpdir(), "amanda-appointment-conflict-"));
    const cluster = join(root, "data");
    const socket = join(root, "socket");
    const port = String(20000 + Math.floor(Math.random() * 20000));
    await mkdir(socket);
    await run(join(pgBin, "initdb"), ["-D", cluster, "-A", "trust", "-U", "postgres", "--no-locale", "--encoding", "UTF8"]);
    await run(join(pgBin, "pg_ctl"), ["-D", cluster, "-l", join(root, "postgres.log"), "-o", `-F -k ${socket} -p ${port}`, "-w", "start"]);
    t.after(async () => {
      await run(join(pgBin, "pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"]);
      await rm(root, { recursive: true, force: true });
    });
    query = (sql) => run(join(pgBin, "psql"), ["-h", socket, "-p", port, "-U", "postgres", "-d", "postgres", "-XqAt", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  }

  const migration = await readFile(migrationUrl, "utf8");
  const setup = async () => query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
    drop schema public cascade;
    create schema public;
    create schema if not exists private;
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create table public.availability_slots (
      id uuid primary key default extensions.gen_random_uuid(),
      starts_at timestamptz not null
    );
    create table public.bookings (
      id uuid primary key default extensions.gen_random_uuid(),
      slot_id uuid references public.availability_slots(id),
      service_booking_mode_snapshot text not null,
      service_duration_minutes_snapshot integer,
      status text not null
    );
  `);
  const addSlot = (instant) => query(`insert into public.availability_slots(starts_at) values ('${instant}') returning id;`);
  const addTimed = (slot, status = "pending_payment") => query(`insert into public.bookings(
    slot_id,service_booking_mode_snapshot,service_duration_minutes_snapshot,status
  ) values ('${slot}','timed',60,'${status}') returning id;`);

  await setup();
  await query(migration);

  await t.test("server-derived [start, end) ranges allow adjacency and reject different-start overlap", async () => {
    const ten = await addSlot("2030-01-02T16:00:00Z");
    const tenThirty = await addSlot("2030-01-02T16:30:00Z");
    const eleven = await addSlot("2030-01-02T17:00:00Z");
    const first = await addTimed(ten);
    assert.equal(await query(`select appointment_starts_at = '2030-01-02T16:00:00Z'::timestamptz
      and appointment_ends_at = '2030-01-02T17:00:00Z'::timestamptz from public.bookings where id='${first}';`), "t");
    await assert.rejects(addTimed(tenThirty), /bookings_no_overlapping_active_timed_appointments/);
    assert.ok(await addTimed(eleven));
  });

  await t.test("pending-payment reservations block overlap and payment_expired releases only their range", async () => {
    const noon = await addSlot("2030-01-03T18:00:00Z");
    const noonThirty = await addSlot("2030-01-03T18:30:00Z");
    const booking = await addTimed(noon, "pending_payment");
    await assert.rejects(addTimed(noonThirty), /bookings_no_overlapping_active_timed_appointments/);
    await query(`update public.bookings set status='payment_expired' where id='${booking}';`);
    assert.ok(await addTimed(noonThirty));
  });

  await t.test("concurrent different-start attempts have one database winner", async () => {
    const two = await addSlot("2030-01-04T20:00:00Z");
    const twoThirty = await addSlot("2030-01-04T20:30:00Z");
    const results = await Promise.allSettled([addTimed(two), addTimed(twoThirty)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.match(String(results.find((result) => result.status === "rejected").reason), /bookings_no_overlapping_active_timed_appointments/);
  });

  await t.test("confirmation keeps a reservation's interval and cancellation releases it", async () => {
    const three = await addSlot("2030-01-05T21:00:00Z");
    const threeThirty = await addSlot("2030-01-05T21:30:00Z");
    const booking = await addTimed(three, "pending_payment");
    await query(`update public.bookings set status='confirmed' where id='${booking}';`);
    await assert.rejects(addTimed(threeThirty), /bookings_no_overlapping_active_timed_appointments/);
    await query(`update public.bookings set status='cancelled' where id='${booking}';`);
    assert.ok(await addTimed(threeThirty));
  });

  await t.test("appointment source and derived snapshots cannot be changed after creation", async () => {
    const slot = await addSlot("2030-01-06T16:00:00Z");
    const booking = await addTimed(slot, "confirmed");
    await assert.rejects(
      query(`update public.bookings set appointment_ends_at='2030-01-06T18:00:00Z' where id='${booking}';`),
      /Booking appointment snapshots are immutable/,
    );
    await assert.rejects(
      query(`update public.bookings set service_duration_minutes_snapshot=30 where id='${booking}';`),
      /Booking appointment snapshots are immutable/,
    );
    assert.equal(await query(`select appointment_ends_at = '2030-01-06T17:00:00Z'::timestamptz from public.bookings where id='${booking}';`), "t");
  });

  await t.test("untimed records remain interval-free", async () => {
    const id = await query("insert into public.bookings(slot_id,service_booking_mode_snapshot,service_duration_minutes_snapshot,status) values(null,'untimed',null,'pending') returning id;");
    assert.equal(await query(`select appointment_starts_at is null and appointment_ends_at is null from public.bookings where id='${id}';`), "t");
  });

  await t.test("migration stops safely when pre-existing active bookings overlap", async () => {
    await setup();
    const first = await addSlot("2020-01-02T16:00:00Z");
    const second = await addSlot("2020-01-02T16:30:00Z");
    await addTimed(first, "completed");
    await addTimed(second, "completed");
    await assert.rejects(query(`begin; ${migration} commit;`), /Existing active timed bookings overlap/);
    assert.equal(await query("select count(*) from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='appointment_starts_at';"), "0");
  });
});

test("customer booking UI maps exclusion violations to the safe unavailable-appointment message", async () => {
  const source = await readFile(new URL("../src/pages/Booking.jsx", import.meta.url), "utf8");
  assert.match(source, /bookingError\?\.code === "23P01"/);
  assert.match(source, /That appointment time is no longer available\. Please choose another time\./);
});
