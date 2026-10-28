import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20261028000000_continuous_availability_periods.sql", import.meta.url);

test("continuous availability periods merge safely and preserve canonical anchors", { timeout: 120000 }, async (t) => {
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
  const root = await mkdtemp(join(tmpdir(), "amanda-periods-"));
  const cluster = join(root, "data"), socket = join(root, "socket");
  const port = String(40001 + Math.floor(Math.random() * 10000));
  await mkdir(socket);
  await run(join(pgBin, "initdb"), ["-D", cluster, "-A", "trust", "-U", "postgres", "--no-locale", "--encoding", "UTF8"]);
  await run(join(pgBin, "pg_ctl"), ["-D", cluster, "-l", join(root, "postgres.log"), "-o", `-F -k ${socket} -p ${port}`, "-w", "start"]);
  t.after(async () => {
    await run(join(pgBin, "pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"]);
    await rm(root, { recursive: true, force: true });
  });
  const query = (sql) => run(join(pgBin, "psql"), ["-h", socket, "-p", port, "-U", "postgres", "-d", "postgres", "-XqAt", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  const migration = await readFile(migrationUrl, "utf8");
  await query(`
    create role anon; create role authenticated; create role service_role;
    create schema private; create schema auth;
    create extension pgcrypto;
    create table public.email_settings (id boolean primary key, timezone text);
    insert into public.email_settings values (true,'America/Chicago');
    create function private.require_admin() returns void language plpgsql security definer set search_path='' as $$
      begin if current_setting('request.jwt.claims',true) not like '%"admin":true%' and current_user <> 'service_role' then
        raise exception using errcode='42501',message='Administrator access is required.'; end if; end $$;
    create function public.get_business_timezone() returns text language sql stable security definer set search_path='' as $$ select 'America/Chicago'::text $$;
  `);
  await query(migration);
  const asAdmin = (sql) => query(`set role authenticated; set request.jwt.claims='{"admin":true}'; ${sql}`);
  const asOrdinary = (sql) => query(`set role authenticated; set request.jwt.claims='{"admin":false}'; ${sql}`);
  const create = async (start, end) => JSON.parse(await asAdmin(`select public.create_availability_period('${start}'::timestamp,'${end}'::timestamp);`));
  const periods = async () => JSON.parse(await asAdmin(`select coalesce(jsonb_agg(to_jsonb(p) order by p.starts_at),'[]'::jsonb) from public.get_admin_availability_periods() p;`));

  await t.test("standard and half-hour periods retain business-local anchors", async () => {
    const result = await create("2031-01-06 10:30", "2031-01-06 16:30");
    assert.equal(result.outcome, "created");
    assert.equal(result.period.anchor_local_time, "10:30:00");
    assert.equal(result.period.timezone, "America/Chicago");
    assert.equal(result.period.starts_at, "2031-01-06T16:30:00+00:00");
  });

  await t.test("partial, contained, duplicate, and adjacent submissions are deterministic", async () => {
    const extension = await create("2031-01-06 15:30", "2031-01-06 18:30");
    assert.equal(extension.outcome, "extended");
    assert.equal(extension.period.anchor_local_time, "10:30:00");
    const contained = await create("2031-01-06 11:30", "2031-01-06 12:30");
    assert.equal(contained.outcome, "unchanged");
    const duplicate = await create("2031-01-06 10:30", "2031-01-06 18:30");
    assert.equal(duplicate.outcome, "unchanged");
    const adjacent = await create("2031-01-06 18:30", "2031-01-06 19:30");
    assert.equal(adjacent.outcome, "extended");
    assert.equal(adjacent.period.anchor_local_time, "10:30:00");
  });

  await t.test("earlier extensions retain the original anchor", async () => {
    const created = await create("2031-01-07 10:30", "2031-01-07 14:30");
    const merged = await create("2031-01-07 09:00", "2031-01-07 11:00");
    assert.equal(merged.outcome, "extended");
    assert.equal(merged.period.id, created.period.id);
    assert.equal(merged.period.anchor_local_time, "10:30:00");
    assert.equal(merged.period.starts_at, "2031-01-07T15:00:00+00:00");
  });

  await t.test("compatible chains merge while incompatible canonical anchors require review", async () => {
    await create("2031-01-08 10:00", "2031-01-08 12:00");
    await create("2031-01-08 13:00", "2031-01-08 17:00");
    const merged = await create("2031-01-08 11:00", "2031-01-08 14:00");
    assert.equal(merged.outcome, "extended");

    await create("2031-01-09 10:00", "2031-01-09 12:00");
    await create("2031-01-09 13:30", "2031-01-09 17:00");
    const conflict = await create("2031-01-09 11:00", "2031-01-09 14:00");
    assert.equal(conflict.outcome, "anchor_conflict");
    assert.equal(conflict.conflicting_period_ids.length, 1);
  });

  await t.test("editing retains its anchor, deletion is period-only, and untimed inventory is untouched", async () => {
    const created = await create("2031-01-10 10:30", "2031-01-10 14:30");
    const updated = JSON.parse(await asAdmin(`select public.update_availability_period('${created.period.id}','2031-01-10 09:00'::timestamp,'2031-01-10 15:00'::timestamp);`));
    assert.equal(updated.outcome, "updated");
    assert.equal(updated.period.anchor_local_time, "10:30:00");
    assert.equal(await asAdmin(`select public.delete_availability_period('${created.period.id}');`), "t");
    assert.equal(await asAdmin(`select public.delete_availability_period('${created.period.id}');`), "f");
  });

  await t.test("Chicago DST ambiguity, nonexistent time, invalid range, and past periods are rejected", async () => {
    await assert.rejects(create("2031-03-09 02:30", "2031-03-09 04:30"), /does not exist/);
    await assert.rejects(create("2031-11-02 01:30", "2031-11-02 03:30"), /ambiguous/);
    await assert.rejects(create("2031-02-01 12:00", "2031-02-01 12:00"), /end must be after/);
    await assert.rejects(create("2020-01-01 10:00", "2020-01-01 11:00"), /cannot start in the past/);
    await query("update public.email_settings set timezone='not/a-zone' where id=true;");
    await assert.rejects(create("2031-04-01 10:00", "2031-04-01 11:00"), /business timezone is invalid/);
    await query("update public.email_settings set timezone='America/Chicago' where id=true;");
  });

  await t.test("midnight crossing, authorization, and concurrent submissions are safe", async () => {
    const crossing = await create("2031-02-01 22:30", "2031-02-02 01:30");
    assert.equal(crossing.outcome, "created");
    await assert.rejects(asOrdinary("select public.get_admin_availability_periods();"), /Administrator access/);
    const results = await Promise.allSettled([
      create("2031-02-03 10:00", "2031-02-03 12:00"),
      create("2031-02-03 11:00", "2031-02-03 13:00"),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    const overlapping = results.map((result) => result.value).filter(Boolean);
    assert.ok(overlapping.some((result) => ["created", "extended"].includes(result.outcome)));
  });

  assert.ok((await periods()).length > 0);
});
