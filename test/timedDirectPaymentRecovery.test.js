import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const edge = () => read("../supabase/functions/square-payment/index.ts");
const migration = () =>
  read("../supabase/migrations/20260904000000_timed_direct_payment_lifecycle.sql");

test("status returns trusted timed booking and appointment context", async () => {
  const source = await edge();
  assert.match(source, /service_id/);
  assert.match(source, /service_name_snapshot/);
  assert.match(source, /service_booking_mode_snapshot/);
  assert.match(source, /slot_id/);
  assert.match(
    source,
    /availability_slots!bookings_slot_id_fkey\(slot_date,slot_time\)/,
  );
  for (const field of [
    "serviceId",
    "serviceName",
    "bookingMode",
    "slotId",
    "appointmentDate",
    "appointmentTime",
  ]) {
    assert.match(source, new RegExp(`${field}[,:]`));
  }
  assert.match(
    source,
    /payload\.action === "status"[\s\S]*rpc\("get_payment_status"[\s\S]*\.select\(bookingContextSelection\)/,
  );
});

test("untimed recovery cannot invent appointment data", async () => {
  const source = await edge();
  assert.match(
    source,
    /appointmentDate = bookingMode === "timed" \? slot\?\.slot_date \?\? null : null/,
  );
  assert.match(
    source,
    /appointmentTime = bookingMode === "timed" \? slot\?\.slot_time \?\? null : null/,
  );
  assert.match(source, /slotId: bookingMode === "timed" \? booking\.slot_id : null/);
});

test("browser payload cannot override appointment service or amount authority", async () => {
  const source = await edge();
  assert.match(
    source,
    /Object\.keys\(payload\)\.sort\(\)\.join\(","\) !==[\s\S]*"action,bookingId,paymentAccessToken"/,
  );
  assert.doesNotMatch(source, /payload\.(appointmentDate|appointmentTime|slotId|serviceId|amount|currency)/);
  assert.match(source, /amountMinor: data\.amount_minor/);
  assert.match(source, /currency: data\.currency/);
  assert.match(source, /amountMinor: attempt\.amount_minor/);
  assert.match(source, /currency: attempt\.currency/);
});

test("initialize returns the same protected server booking context", async () => {
  const source = await edge();
  assert.match(
    source,
    /payload\.action === "initialize"[\s\S]*begin_payment_attempt[\s\S]*\.select\(bookingContextSelection\)[\s\S]*publicBookingContext\(booking\)/,
  );
});

test("timed completion sends trusted appointment data exactly twice", async () => {
  const sql = await migration();
  const completion = sql.match(
    /create or replace function public\.record_provider_payment_result\([^]*?\n\$\$;/,
  )?.[0] ?? "";
  assert.match(completion, /'service_booking_mode', selected_booking\.service_booking_mode_snapshot/);
  assert.match(completion, /'slot_date', selected_slot\.slot_date/);
  assert.match(completion, /'slot_time', selected_slot\.slot_time/);
  assert.match(completion, /'direct_payment', true, 'payment_status', 'paid'/);
  assert.equal(
    (completion.match(/perform public\.queue_booking_email\(/g) ?? []).length,
    2,
  );
  assert.match(completion, /'booking_confirmed'/);
  assert.match(completion, /'booking_request_admin'/);
  assert.doesNotMatch(completion, /payment_received|stripe_payment_link/);
});

test("Square success wording uses trusted reusable service context", async () => {
  const component = await read(
    "../src/components/booking/SquareCardPayment.jsx",
  );
  assert.match(component, /serviceName: status\.serviceName/);
  assert.match(component, /serviceName: attempt\.serviceName/);
  assert.match(
    component,
    /Your \{context\.serviceName \|\| "booking"\} is confirmed/,
  );
  assert.doesNotMatch(component, /Your Voice Memo Reading is confirmed/);
  assert.match(component, /max-w-lg/);
  assert.match(component, /Secure checkout/);
  assert.match(component, /`Pay \$\{displayAmount\} securely`/);
  assert.match(component, /Secure payment powered by Square/);
});

test("payment security and source-token boundaries remain unchanged", async () => {
  const source = await edge();
  assert.match(source, /recoveryTokenPattern/);
  assert.match(source, /status\.attempt_id !== payload\.attemptId/);
  assert.match(source, /mark_payment_attempt_processing/);
  assert.match(source, /idempotency_key: submission\.idempotency_key/);
  assert.match(source, /source_id: payload\.sourceToken/);
  assert.doesNotMatch(source, /insert[\s\S]{0,100}(sourceToken|source_token)/i);
});
