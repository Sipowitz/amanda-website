import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260818001000_embedded_stripe_checkout_phase_one.sql",
  import.meta.url,
);
const checkoutPath = new URL(
  "../supabase/functions/create-checkout-session/index.ts",
  import.meta.url,
);
const webhookPath = new URL(
  "../supabase/functions/stripe-webhook/index.ts",
  import.meta.url,
);

test("database reserves only one active Checkout attempt per booking", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /create unique index stripe_checkout_one_active_attempt_per_booking/);
  assert.match(sql, /where status in \('creating', 'open'\)/);
  assert.match(sql, /from public\.bookings\s+where id = p_booking_id for update/);
  assert.match(sql, /status = 'payment_expired'/);
  assert.match(sql, /on conflict \(event_id\) do nothing/g);
});

test("Embedded Checkout remains an explicit Voice Memo configuration", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /slug = 'voice-memo-reading'/);
  assert.doesNotMatch(
    sql,
    /when booking_mode = 'untimed'\s+then 'embedded_checkout'/,
  );
});

test("checkout creation uses attempt idempotency and card-only payment", async () => {
  const source = await readFile(checkoutPath, "utf8");

  assert.match(source, /idempotencyKey: `embedded-checkout-\$\{attempt\.attempt_id\}`/);
  assert.match(source, /payment_method_types: \["card"\]/);
  assert.match(source, /begin_stripe_checkout_attempt/);
  assert.match(source, /register_stripe_checkout_session/);
  assert.match(source, /\+ \(35 \* 60\)/);
});

test("webhook handles only coherent completion and expiry transitions", async () => {
  const source = await readFile(webhookPath, "utf8");

  assert.match(source, /checkout\.session\.completed/);
  assert.match(source, /checkout\.session\.expired/);
  assert.match(source, /constructEventAsync/);
  assert.match(source, /session\.payment_status !== "paid"/);
});

test("database protects Stripe-controlled admin mutations", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /Stripe controls confirmation for this booking/);
  assert.match(sql, /Stripe-controlled payment fields are read-only/);
  assert.match(sql, /cannot be cancelled while payment is active or settled/);
  assert.match(
    sql,
    /create or replace function public\.cancel_booking[\s\S]*where id = p_booking_id for update/,
  );
});

test("completion verifies the current registered attempt, amount and currency", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /selected_attempt\.amount_total <> p_amount_total/);
  assert.match(sql, /selected_attempt\.currency <> p_currency/);
  assert.match(
    sql,
    /selected_booking\.stripe_checkout_session_id <> cleaned_session_id/,
  );
  assert.match(sql, /selected_attempt\.status <> 'open'/);
  assert.match(sql, /selected_booking\.status <> 'pending_payment'/);
});

test("expiry retires the current Session without deleting the booking", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /create function public\.expire_stripe_checkout_payment/);
  assert.match(sql, /set status = 'expired'/);
  assert.match(sql, /set status = 'payment_expired'/);
  assert.doesNotMatch(sql, /delete from public\.bookings/);
});

test("stale sweep locks booking before attempt and ignores open Sessions", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const sweep = sql.match(
    /create function public\.expire_stale_stripe_checkouts\(\)[\s\S]*?\n\$\$;/,
  )?.[0] || "";

  const bookingLock = sweep.indexOf(
    "from public.bookings\n    where id = stale_candidate.booking_id\n    for update",
  );
  const attemptLock = sweep.indexOf(
    "from private.stripe_checkout_sessions\n    where attempt_id = stale_candidate.attempt_id",
  );

  assert.ok(bookingLock >= 0);
  assert.ok(attemptLock > bookingLock);
  assert.match(sweep, /where attempt\.status = 'creating'/);
  assert.match(sweep, /selected_attempt\.session_id is not null/);
  assert.doesNotMatch(sweep, /attempt\.status = 'open'/);
  assert.doesNotMatch(sweep, /attempt\.expires_at </);
});
