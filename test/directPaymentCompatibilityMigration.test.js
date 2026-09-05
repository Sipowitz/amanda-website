import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const compatibilityMigration = () =>
  read(
    "../supabase/migrations/20260904002000_direct_payment_compatibility.sql",
  );

const functionBody = (sql, qualifiedName) => {
  const escaped = qualifiedName.replaceAll(".", "\\.");
  return (
    sql.match(
      new RegExp(
        `create(?: or replace)? function ${escaped}\\([^]*?\\n\\$\\$;`,
        "i",
      ),
    )?.[0] ?? ""
  );
};

const backfillBody = (sql) =>
  sql.match(/do \$\$[\s\S]*?\n\$\$;/i)?.[0] ?? "";

test("legacy direct-payment bookings receive one reserved Square attempt", async () => {
  const backfill = backfillBody(await compatibilityMigration());
  assert.match(backfill, /service_payment_flow_snapshot = 'direct_payment'/);
  assert.match(backfill, /status = 'pending_payment'/);
  assert.match(backfill, /payment_status = 'unpaid'/);
  assert.match(
    backfill,
    /not exists \([\s\S]*private\.payment_attempts[\s\S]*booking_id = booking\.id/,
  );
  assert.match(backfill, /insert into private\.payment_attempts/);
  assert.match(backfill, /'square'/);
  assert.match(backfill, /'reserved'/);
});

test("backfill locks and rechecks before an idempotent insert", async () => {
  const backfill = backfillBody(await compatibilityMigration());
  const lock = backfill.indexOf("for update");
  const recheck = backfill.lastIndexOf("not exists");
  const insert = backfill.indexOf("insert into private.payment_attempts");
  assert.ok(lock >= 0 && recheck > lock && insert > recheck);
  assert.match(backfill, /on conflict do nothing/);
  assert.equal(
    (backfill.match(/insert into private\.payment_attempts/g) ?? []).length,
    1,
  );
});

test("backfill uses authoritative snapshots and does not mutate booking data", async () => {
  const backfill = backfillBody(await compatibilityMigration());
  assert.match(backfill, /locked_booking\.service_price_amount_snapshot/);
  assert.match(backfill, /locked_booking\.service_currency_snapshot/);
  assert.match(
    backfill,
    /'sq-' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/,
  );
  assert.doesNotMatch(backfill, /source_token|provider_payment_id/);
  assert.doesNotMatch(backfill, /update public\.bookings/);
  assert.doesNotMatch(backfill, /booking_payment_access|customer_|recovery|digest/);
});

test("existing, non-direct, paid, and non-pending rows are excluded", async () => {
  const backfill = backfillBody(await compatibilityMigration());
  assert.match(backfill, /not exists \([\s\S]*private\.payment_attempts/);
  assert.match(backfill, /service_payment_flow_snapshot = 'direct_payment'/);
  assert.match(backfill, /status = 'pending_payment'/);
  assert.match(backfill, /payment_status = 'unpaid'/);
  assert.doesNotMatch(backfill, /update private\.payment_attempts/);
});

test("begin_payment_attempt remains strict after the one-time backfill", async () => {
  const lifecycle = await read(
    "../supabase/migrations/20260904000000_timed_direct_payment_lifecycle.sql",
  );
  const compatibility = await compatibilityMigration();
  assert.match(
    functionBody(lifecycle, "public.begin_payment_attempt"),
    /The pending booking has no active payment attempt/,
  );
  assert.doesNotMatch(compatibility, /create or replace function public\.begin_payment_attempt/);
});

test("legacy booking RPC uses the canonical positive slot ownership list", async () => {
  const fn = functionBody(
    await compatibilityMigration(),
    "public.create_booking_request",
  );
  for (const status of [
    "pending",
    "pending_payment",
    "confirmed",
    "completed",
    "no_show",
  ]) {
    assert.match(fn, new RegExp(`'${status}'`));
  }
  assert.doesNotMatch(fn, /status <> 'cancelled'/);
  assert.doesNotMatch(fn, /'payment_expired'|'cancelled'/);
});

test("legacy payment-link booking behavior and grants remain compatible", async () => {
  const sql = await compatibilityMigration();
  const fn = functionBody(sql, "public.create_booking_request");
  assert.match(fn, /set is_available = false/);
  assert.match(fn, /'pending'/);
  assert.match(fn, /'unpaid'/);
  assert.match(fn, /booking_request_customer/);
  assert.match(fn, /booking_request_admin/);
  assert.match(sql, /to anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /update public\.services|direct_payment'\s+where slug/);
});
