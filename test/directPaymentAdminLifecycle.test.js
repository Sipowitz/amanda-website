import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = () =>
  read("../supabase/migrations/20260904001000_direct_payment_admin_lifecycle.sql");
const card = () => read("../src/components/admin/bookings/BookingCard.jsx");

const functionBody = (sql, qualifiedName) => {
  const escaped = qualifiedName.replaceAll(".", "\\.");
  return sql.match(
    new RegExp(`create(?: or replace)? function ${escaped}\\([^]*?\\n\\$\\$;`, "i"),
  )?.[0] ?? "";
};

test("admin receives only minimal provider-managed attempt state", async () => {
  const sql = await migration();
  const service = await read("../src/services/adminService.js");
  const fn = functionBody(sql, "public.get_admin_direct_payment_states");
  assert.match(fn, /perform private\.require_admin\(\)/);
  assert.match(fn, /booking_id uuid,[\s\S]*provider text,[\s\S]*attempt_status text/);
  assert.match(fn, /service_payment_flow_snapshot = 'direct_payment'/);
  assert.match(fn, /order by payment_attempt\.created_at desc[\s\S]*limit 1/);
  assert.doesNotMatch(
    fn,
    /idempotency_key|provider_payment_id|recovery|token|failure_detail|webhook/,
  );
  assert.match(service, /rpc\("get_admin_direct_payment_states"\)/);
  assert.match(service, /payment_attempt_status/);
  assert.match(service, /payment_provider/);
  assert.doesNotMatch(service, /from\("payment_attempts"\)/);
});

test("reserved direct-payment cancellation is atomic and releases timed slot", async () => {
  const sql = await migration();
  const fn = functionBody(sql, "public.cancel_booking");
  assert.match(fn, /where id = p_booking_id[\s\S]*for update/);
  assert.match(fn, /selected_booking\.status <> 'pending_payment'/);
  assert.match(fn, /selected_booking\.payment_status <> 'unpaid'/);
  assert.match(fn, /selected_attempt\.provider <> 'square'/);
  assert.match(fn, /selected_attempt\.status <> 'reserved'/);
  assert.match(fn, /selected_attempt\.submitted_at is not null/);
  assert.match(fn, /set status = 'cancelled'/);
  assert.match(fn, /return private\.cancel_booking\(p_booking_id\)/);
  assert.ok(
    fn.indexOf("set status = 'cancelled'") <
      fn.lastIndexOf("return private.cancel_booking(p_booking_id)"),
  );

  const lifecycle = await read(
    "../supabase/migrations/20260817210000_add_booking_services.sql",
  );
  const privateCancel = functionBody(lifecycle, "private.cancel_booking");
  assert.match(privateCancel, /set[\s\S]*status = 'cancelled'/);
  assert.match(privateCancel, /set is_available = true/);
  assert.match(privateCancel, /'booking_cancelled'/);
});

test("processing unknown paid and expired direct payments cannot be cancelled", async () => {
  const sql = await migration();
  const fn = functionBody(sql, "public.cancel_booking");
  assert.match(fn, /selected_attempt\.status <> 'reserved'/);
  assert.match(fn, /cannot be cancelled after payment submission begins/);
  assert.match(fn, /selected_booking\.status <> 'pending_payment'/);
  assert.match(fn, /Only an awaiting direct-payment checkout can be cancelled/);
  assert.doesNotMatch(fn, /set is_available = true/);
});

test("backend prevents manual provider confirmation resurrection and payment editing", async () => {
  const sql = await migration();
  const status = functionBody(sql, "public.update_booking_status");
  const phaseOne = await read(
    "../supabase/migrations/20260818001000_direct_payment_phase_one.sql",
  );
  const payment = functionBody(phaseOne, "public.update_booking_payment");
  assert.match(status, /service_payment_flow_snapshot <> 'direct_payment'/);
  assert.match(status, /selected_booking\.status <> 'confirmed'/);
  assert.match(status, /selected_booking\.payment_status <> 'paid'/);
  assert.match(status, /selected_booking\.payment_method <> 'square'/);
  assert.match(status, /selected_attempt\.status <> 'completed'/);
  assert.match(status, /p_status not in \('completed', 'no_show'\)/);
  assert.match(payment, /service_payment_flow_snapshot = 'direct_payment'/);
  assert.match(payment, /Provider-controlled payment fields are read-only/);
});

test("historical manual bookings retain existing mutation paths", async () => {
  const sql = await migration();
  const cancel = functionBody(sql, "public.cancel_booking");
  const status = functionBody(sql, "public.update_booking_status");
  assert.match(
    cancel,
    /service_payment_flow_snapshot <> 'direct_payment'[\s\S]*return private\.cancel_booking/,
  );
  assert.match(
    status,
    /service_payment_flow_snapshot <> 'direct_payment'[\s\S]*return private\.update_booking_status/,
  );
  assert.doesNotMatch(sql, /service_payment_settings|stripe_payment_link|update public\.services/);
});

test("admin UI labels each Square lifecycle without exposing manual payment controls", async () => {
  const source = await card();
  for (const label of [
    "Awaiting Square checkout",
    "Square payment processing",
    "Square payment status unknown",
    "Payment expired",
    "Paid via Square",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /Appointment no longer reserved/);
  assert.match(source, /Appointment slot held/);
  assert.match(source, /payment_provider === "square"/);
  assert.match(source, /paymentPanelOpen && !isDirectPayment/);
  assert.match(source, /!isDirectPayment && booking\.status !== "confirmed"/);
});

test("admin controls match reserved unresolved settled and expired states", async () => {
  const source = await card();
  assert.match(
    source,
    /canCancel = !isDirectPayment \|\| \(isSquarePayment &&[\s\S]*attemptStatus === "reserved"/,
  );
  assert.match(source, /\["processing", "unknown"\]\.includes\(attemptStatus\)/);
  assert.match(source, /outcome must resolve before administrative/);
  assert.match(source, /canCompleteDirectPayment[\s\S]*payment_status === "paid"/);
  assert.match(source, /payment_method === "square"/);
  assert.match(source, /attemptStatus === "completed"/);
  assert.doesNotMatch(source, /refund|refunded/i);
});

test("Voice Memo remains provider-managed without slot-specific messaging", async () => {
  const source = await card();
  assert.match(source, /isTimed \? "Appointment slot held" : ""/);
  assert.match(
    source,
    /isTimed \? "Appointment no longer reserved" : "Payment was not completed"/,
  );
  assert.match(source, /service_payment_flow_snapshot === "direct_payment"/);
  assert.doesNotMatch(source, /voice-memo-reading|Voice Memo/);
});
