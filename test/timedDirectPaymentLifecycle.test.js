import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = () =>
  read("../supabase/migrations/20260904000000_timed_direct_payment_lifecycle.sql");

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

test("schema supports timed direct payment without activating timed services", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /payment_required is true and payment_flow in \('payment_link', 'direct_payment'\)/,
  );
  assert.match(sql, /drop constraint bookings_direct_payment_untimed_check/);
  assert.doesNotMatch(sql, /update public\.services/);
  assert.doesNotMatch(sql, /slug in \('private-readings', 'wheel-of-the-year'\)/);
  assert.doesNotMatch(sql, /update public\.bookings[\s\S]*service_payment_flow_snapshot\s*=/);
  assert.doesNotMatch(sql, /price_amount\s*=\s*\d/);
  assert.doesNotMatch(sql, /drop column|truncate|delete from public\.bookings/i);
});

test("pending booking validates timed and untimed slot shape from database state", async () => {
  const sql = await migration();
  const fn = functionBody(sql, "public.create_pending_payment_booking");
  assert.match(fn, /p_slot_id uuid default null/);
  assert.match(fn, /where id = p_service_id for share/);
  assert.match(fn, /payment_flow <> 'direct_payment'/);
  assert.match(fn, /price_amount <= 0/);
  assert.match(fn, /currency <> 'USD'/);
  assert.doesNotMatch(fn, /voice-memo-reading|price_amount <> 2000/);
  assert.match(fn, /booking_mode = 'timed'[\s\S]*p_slot_id is null/);
  assert.match(fn, /where id = p_slot_id for update/);
  assert.match(fn, /slot_date < current_date/);
  assert.match(fn, /is_available is not true/);
  assert.match(fn, /booking_mode = 'untimed'[\s\S]*p_slot_id is not null/);
});

test("booking recovery and initial reserved attempt are created atomically", async () => {
  const sql = await migration();
  const fn = functionBody(sql, "public.create_pending_payment_booking");
  const booking = fn.indexOf("insert into public.bookings");
  const access = fn.indexOf("insert into private.booking_payment_access");
  const attempt = fn.indexOf("insert into private.payment_attempts");
  const reserve = fn.indexOf("set is_available = false");
  assert.ok(booking >= 0 && access > booking && attempt > access && reserve > attempt);
  assert.match(fn, /digest\(payment_access_token, 'sha256'\)/);
  assert.match(fn, /selected_service\.price_amount, selected_service\.currency/);
  assert.match(fn, /'sq-' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/);
});

test("the active-slot index serializes races with an explicit ownership list", async () => {
  const sql = await migration();
  const index = sql.match(
    /create unique index bookings_one_active_booking_per_slot[\s\S]*?\);/,
  )?.[0] ?? "";
  assert.match(index, /on public\.bookings \(slot_id\)/);
  for (const status of [
    "pending",
    "pending_payment",
    "confirmed",
    "completed",
    "no_show",
  ]) {
    assert.match(index, new RegExp(`'${status}'`));
  }
  assert.doesNotMatch(index, /payment_expired|cancelled|status <>/);
  assert.match(
    functionBody(sql, "public.create_pending_payment_booking"),
    /where id = p_slot_id for update/,
  );
});

test("expired timed payment restart reacquires only its original free slot", async () => {
  const sql = await migration();
  const fn = functionBody(sql, "public.begin_payment_attempt");
  assert.doesNotMatch(fn, /service_booking_mode_snapshot <> 'untimed'/);
  assert.match(fn, /status not in \('pending_payment', 'payment_expired'\)/);
  assert.match(fn, /where id = selected_booking\.slot_id for update/);
  assert.match(fn, /selected_slot\.is_available is not true/);
  assert.match(fn, /id <> selected_booking\.id/);
  assert.match(fn, /The original booking slot is no longer available/);
  assert.ok(
    fn.indexOf("set is_available = false") <
      fn.indexOf("set status = 'pending_payment'"),
  );
  assert.match(fn, /The pending booking has no active payment attempt/);
});

test("definitive failure releases timed slots but unknown remains nonterminal", async () => {
  const sql = await migration();
  const fail = functionBody(sql, "public.fail_payment_attempt");
  const complete = functionBody(sql, "public.record_provider_payment_result");
  const phaseOne = await read(
    "../supabase/migrations/20260818001000_direct_payment_phase_one.sql",
  );
  const unknown = functionBody(phaseOne, "public.mark_payment_attempt_unknown");
  assert.match(fail, /set status = 'failed'/);
  assert.match(fail, /set status = 'payment_expired'/);
  assert.match(fail, /set is_available = true/);
  assert.match(complete, /p_provider_status <> 'COMPLETED'/);
  assert.match(complete, /set status = 'failed'/);
  assert.match(complete, /set is_available = true/);
  assert.match(unknown, /set status = 'unknown'/);
  assert.doesNotMatch(unknown, /is_available|payment_expired/);
});

test("one-hour reserved-attempt expiry is private, scheduled, and releases slots", async () => {
  const sql = await migration();
  const impl = functionBody(
    sql,
    "private.expire_stale_reserved_payment_attempts",
  );
  const wrapper = functionBody(
    sql,
    "public.expire_stale_reserved_payment_attempts",
  );
  assert.match(impl, /status = 'reserved' and submitted_at is null/);
  assert.match(impl, /created_at < now\(\) - interval '1 hour'/);
  assert.match(impl, /where id = candidate\.booking_id for update/);
  assert.match(impl, /where id = candidate\.id[\s\S]*for update/);
  assert.match(impl, /where id = selected_booking\.slot_id for update/);
  assert.match(impl, /set status = 'expired'/);
  assert.match(impl, /set status = 'payment_expired'/);
  assert.match(impl, /set is_available = true/);
  assert.doesNotMatch(impl, /status in \('processing', 'unknown'\)/);
  assert.match(wrapper, /Service-role access is required/);
  assert.match(wrapper, /return private\.expire_stale_reserved_payment_attempts\(\)/);
  assert.match(
    sql,
    /cron\.schedule\([\s\S]*'expire-stale-reserved-payment-attempts'[\s\S]*'\*\/5 \* \* \* \*'/,
  );
});

test("submit and expiry use the same booking-then-attempt lock order", async () => {
  const sql = await migration();
  const phaseOne = await read(
    "../supabase/migrations/20260818001000_direct_payment_phase_one.sql",
  );
  const submit = functionBody(phaseOne, "public.mark_payment_attempt_processing");
  const expiry = functionBody(
    sql,
    "private.expire_stale_reserved_payment_attempts",
  );
  for (const fn of [submit, expiry]) {
    assert.ok(
      fn.indexOf("select * into selected_booking from public.bookings") <
        fn.indexOf("select * into selected_attempt from private.payment_attempts"),
    );
    assert.match(fn, /for update/);
  }
  assert.match(submit, /selected_attempt\.status <> 'reserved'/);
  assert.match(submit, /status = 'processing'/);
  assert.match(expiry, /selected_attempt\.submitted_at is not null/);
});

test("completion proves timed slot ownership and leaves it unavailable", async () => {
  const sql = await migration();
  const fn = functionBody(sql, "public.record_provider_payment_result");
  assert.match(fn, /where id = selected_booking\.slot_id for update/);
  assert.match(fn, /selected_slot\.is_available is not false/);
  assert.match(fn, /id <> selected_booking\.id/);
  assert.match(fn, /The booking no longer safely owns its slot/);
  const successfulPath = fn.slice(fn.indexOf("if p_provider_status <> 'COMPLETED'"));
  assert.doesNotMatch(
    successfulPath.slice(successfulPath.indexOf("status = 'confirmed'")),
    /set is_available = true/,
  );
  assert.match(fn, /status = 'confirmed', payment_status = 'paid'/);
  assert.match(fn, /payment_method = 'square'/);
  assert.equal((fn.match(/perform public\.queue_booking_email\(/g) ?? []).length, 2);
  assert.doesNotMatch(fn, /payment_received/);
  assert.match(fn, /'slot_date', selected_slot\.slot_date/);
  assert.match(fn, /'slot_time', selected_slot\.slot_time/);
});

test("referenced slots cannot be deleted", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /bookings_slot_id_fkey foreign key \(slot_id\)[\s\S]*on delete restrict/,
  );
  assert.doesNotMatch(sql, /bookings_slot_id_fkey[\s\S]*on delete cascade/);
});

test("Voice Memo and historical payment-link behavior remain supported", async () => {
  const sql = await migration();
  const phaseOne = await read(
    "../supabase/migrations/20260818001000_direct_payment_phase_one.sql",
  );
  const fn = functionBody(sql, "public.create_pending_payment_booking");
  assert.match(fn, /booking_mode = 'untimed'/);
  assert.match(fn, /A reading topic or question is required/);
  assert.match(fn, /p_slot_id is not null/);
  assert.match(sql, /payment_flow in \('payment_link', 'direct_payment'\)/);
  assert.match(phaseOne, /slug = 'voice-memo-reading'[\s\S]*then 'direct_payment'/);
  assert.match(phaseOne, /else 'payment_link'/);
  assert.doesNotMatch(sql, /drop column stripe_payment_link_url/);
  assert.doesNotMatch(sql, /delete from public\.services/);
});
