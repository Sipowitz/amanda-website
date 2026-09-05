import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCheckoutEntryPolicy, resolveTimedPaymentEntry } from "../src/services/timedPaymentEntry.js";

const identity = { bookingId: "booking", paymentAccessToken: "secret", serviceId: "timed" };
const reserved = {
  serviceId: "timed", bookingMode: "timed", bookingStatus: "pending_payment",
  paymentStatus: "unpaid", paid: false, attemptStatus: "reserved", attemptId: "attempt",
  bookingDetails: { name: "Old customer", email: "old@example.test" },
};

function scenario({ status = reserved, recover = false, statusError, abandonError, result = { abandoned: true } } = {}) {
  const calls = [];
  let stored = identity;
  return {
    calls,
    stored: () => stored,
    run: () => resolveTimedPaymentEntry({
      identity, recover,
      getStatus: async (...args) => {
        calls.push(["status", ...args]);
        if (statusError) throw statusError;
        return status;
      },
      abandon: async (...args) => {
        calls.push(["abandon", ...args]);
        assert.equal(stored, identity, "credentials must survive until acknowledgement");
        if (abandonError) throw abandonError;
        return result;
      },
      clearIdentity: () => { calls.push(["clear"]); stored = null; },
    }),
  };
}

test("reload eligibility belongs only to the first booking entry in the document", () => {
  const policy = createCheckoutEntryPolicy("reload", "/services/private-readings/book");
  assert.equal(policy("/services/private-readings/book"), true);
  assert.equal(policy("/services/private-readings/book"), false);
  assert.equal(createCheckoutEntryPolicy("reload", "/services")("/services/private-readings/book"), false);
  for (const type of ["navigate", "back_forward", undefined]) {
    assert.equal(createCheckoutEntryPolicy(type, "/book")("/book"), false);
  }
});

test("timed reserved reload recovers the same identity without abandonment", async () => {
  const run = scenario({ recover: true });
  assert.equal(await run.run(), identity);
  assert.deepEqual(run.calls, [["status", "booking", "secret"]]);
  assert.equal(run.stored(), identity);
});

test("fresh reserved entry waits for abandonment before clearing; no old details or new booking", async () => {
  const run = scenario();
  assert.equal(await run.run(), null);
  assert.equal(run.stored(), null);
  assert.deepEqual(run.calls, [["status", "booking", "secret"], ["abandon", "booking", "secret", "attempt"], ["clear"]]);
});

for (const [name, status] of [
  ["processing", { ...reserved, attemptStatus: "processing" }],
  ["unknown", { ...reserved, attemptStatus: "unknown" }],
  ["completed/paid", { ...reserved, attemptStatus: "completed", bookingStatus: "confirmed", paymentStatus: "paid", paid: true }],
  ["missing paid flag", { ...reserved, paid: undefined }],
  ["unexpected booking state", { ...reserved, bookingStatus: "confirmed" }],
  ["unexpected payment state", { ...reserved, paymentStatus: "partial" }],
  ["unexpected", { ...reserved, attemptStatus: "unexpected" }],
  ["declined retry", { ...reserved, attemptStatus: "failed", bookingStatus: "payment_expired", canRestart: true }],
  ["one-hour expiry retry", { ...reserved, attemptStatus: "expired", bookingStatus: "payment_expired", canRestart: true }],
  ["Voice Memo", { ...reserved, bookingMode: "untimed" }],
  ["cross-service identity", { ...reserved, serviceId: "another-service" }],
]) {
  test(`${name} is retained without abandonment`, async () => {
    const run = scenario({ status });
    assert.equal(await run.run(), identity);
    assert.equal(run.stored(), identity);
    assert.equal(run.calls.length, 1);
  });
}

for (const [name, options] of [
  ["status network error", { statusError: new Error("offline") }],
  ["malformed status", { status: null }],
  ["abandonment network error", { abandonError: new Error("lost response") }],
  ["submission wins race", { abandonError: new Error("409") }],
  ["submitted reservation rejected", { abandonError: new Error("already submitted") }],
  ["unconfirmed abandonment", { result: { abandoned: false } }],
]) {
  test(`${name} never clears credentials or permits fresh booking`, async () => {
    const run = scenario(options);
    assert.equal(await run.run(), identity);
    assert.equal(run.stored(), identity);
    assert.ok(run.calls.every(([action]) => action !== "clear"));
  });
}

test("lost abandonment response can be acknowledged on a subsequent reload", async () => {
  const run = scenario({ recover: true, status: { ...reserved, bookingStatus: "cancelled", attemptStatus: "cancelled" } });
  assert.equal(await run.run(), null);
  assert.deepEqual(run.calls.map(([action]) => action), ["status", "abandon", "clear"]);
});

test("pending abandonment keeps identity until the server resolves", async () => {
  let acknowledge;
  let cleared = false;
  const operation = resolveTimedPaymentEntry({
    identity, recover: false, getStatus: async () => reserved,
    abandon: () => new Promise((resolve) => { acknowledge = resolve; }),
    clearIdentity: () => { cleared = true; },
  });
  await Promise.resolve();
  assert.equal(cleared, false);
  acknowledge({ abandoned: true });
  assert.equal(await operation, null);
  assert.equal(cleared, true);
});

test("page gates checkout and selector, resets details, and bypasses timed policy for Voice Memo", async () => {
  const page = await readFile(new URL("../src/pages/Booking.jsx", import.meta.url), "utf8");
  assert.match(page, /showingDirectPayment = \(!isTimed \|\| !loading\) && usesDirectPayment && paymentIdentity/);
  assert.match(page, /!loading && isTimed && !showingDirectPayment/);
  assert.match(page, /loading && isTimed && <p role="status"/);
  assert.match(page, /setBookingFormData\(\{ name: "", email: "", phone: "", message: "" \}\)/);
  assert.match(page, /\{!isTimed && !showingDirectPayment && \(/);
  assert.match(page, /storedIdentity && resolvedService.booking_mode === "timed"/);
  assert.match(page, /entry\.resolution \|\|= resolveTimedPaymentEntry/);
  assert.ok(page.indexOf("await entry.resolution") < page.indexOf("await getAvailableSlots()"));
  const load = page.slice(page.indexOf("async function loadBookingPage"), page.indexOf("const uniqueDates"));
  assert.doesNotMatch(load, /createPendingPaymentBooking\(|createBooking\(/);
  assert.doesNotMatch(page, /beforeunload|pagehide|unload|localStorage/);
});

test("Edge abandonment accepts only recovery credentials and invokes its own RPC", async () => {
  const edge = await readFile(new URL("../supabase/functions/square-payment/index.ts", import.meta.url), "utf8");
  assert.match(edge, /"action,attemptId,bookingId,paymentAccessToken"/);
  assert.match(edge, /if \(payload.action === "abandon"\) \{[\s\S]*rpc\("abandon_timed_payment_booking"/);
  assert.match(edge, /error \|\| data !== true/);
  assert.doesNotMatch(edge, /rpc\("cancel_booking"/);
});

test("timed card recovery cannot bypass authoritative status guards after a submit error", async () => {
  const card = await readFile(new URL("../src/components/booking/SquareCardPayment.jsx", import.meta.url), "utf8");
  assert.match(card, /status.bookingStatus === "cancelled" && status.paymentStatus === "unpaid" &&\s+status.paid === false && status.attemptStatus === "cancelled"/);
  assert.match(card, /const status = await checkStatus\(\);\s+if \(service.booking_mode === "timed"\) \{\s+if \(handleStatus\(status\) === "ready"\) setState\("ready"\)/);
});
