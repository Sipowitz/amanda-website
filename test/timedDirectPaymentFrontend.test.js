import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const bookingPage = () => read("../src/pages/Booking.jsx");

test("server payment_flow routes legacy requests and shared direct payment", async () => {
  const source = await bookingPage();
  assert.match(source, /usesDirectPayment = service\.payment_flow === "direct_payment"/);
  assert.match(source, /if \(!usesDirectPayment\) \{[\s\S]*await createBooking\(/);
  assert.match(source, /else \{[\s\S]*createPendingPaymentBooking\(/);
  assert.doesNotMatch(
    source,
    /(?:private-readings|wheel-of-the-year)[\s\S]{0,100}direct_payment/,
  );
  assert.match(source, /success && <BookingSuccess service=\{service\}/);
});

test("timed direct payment submits only selected slot and customer identifiers", async () => {
  const page = await bookingPage();
  const service = await read("../src/services/bookingService.js");
  assert.match(page, /slotId: selectedSlot\?\.id \|\| null/);
  assert.match(service, /p_slot_id: slotId \|\| null/);
  assert.match(service, /p_service_id: serviceId/);
  assert.doesNotMatch(
    service.match(/createPendingPaymentBooking\([^]*?\n\}/)?.[0] ?? "",
    /p_(?:price|currency|date|time)|amount/,
  );
  assert.match(page, /submitLabel=\{usesDirectPayment \? "Continue to payment" : undefined\}/);
});

test("payment stage replaces timed selectors and form with shared checkout", async () => {
  const source = await bookingPage();
  assert.match(source, /showingDirectPayment = \(!isTimed \|\| !loading\) && usesDirectPayment && paymentIdentity/);
  assert.match(
    source,
    /\{showingDirectPayment && \([\s\S]*BookingRequestSummary[\s\S]*SquareCardPayment/,
  );
  assert.match(source, /\{!loading && isTimed && !showingDirectPayment && \([\s\S]*DateSelector/);
  assert.match(source, /!isTimed && !showingDirectPayment/);
  assert.equal((source.match(/<SquareCardPayment/g) ?? []).length, 1);
  assert.doesNotMatch(source, /stripe_payment_link|Stripe/);
});

test("saved summary uses only protected recovered booking context", async () => {
  const page = await bookingPage();
  const card = await read("../src/components/booking/SquareCardPayment.jsx");
  const summary = await read(
    "../src/components/booking/BookingRequestSummary.jsx",
  );
  assert.match(page, /details=\{recoveredBookingDetails \|\| \{\}\}/);
  assert.match(page, /setRecoveredBookingDetails\(details\)/);
  assert.doesNotMatch(page, /BookingRequestSummary details=\{bookingFormData\}/);
  assert.match(card, /amountMinor: current\.amountMinor/);
  assert.match(card, /currency: current\.currency/);
  for (const field of [
    "serviceName",
    "appointmentDate",
    "appointmentTime",
    "amountMinor",
    "currency",
  ]) {
    assert.match(summary, new RegExp(`details\\.${field}`));
  }
  assert.match(summary, /sm:grid-cols-2/);
  assert.match(summary, /break-words/);
});

test("refresh recovery keeps session storage minimal and creates no booking", async () => {
  const page = await bookingPage();
  const recovery = await read("../src/services/paymentRecovery.js");
  const loadPath = page.match(
    /if \(resolvedService\.payment_flow === "direct_payment"\) \{[^]*?\n {10}\}/,
  )?.[0] ?? "";
  assert.match(loadPath, /readPaymentIdentity/);
  assert.doesNotMatch(loadPath, /createPendingPaymentBooking|createBooking|selectedSlot/);
  assert.match(recovery, /identity\.serviceId !== serviceId/);
  assert.match(recovery, /identity\.bookingId/);
  assert.match(recovery, /identity\.paymentAccessToken/);
  assert.doesNotMatch(
    recovery,
    /appointmentDate|appointmentTime|slotId|amountMinor|currency/,
  );
});

test("recovered payment states remain delegated to SquareCardPayment", async () => {
  const card = await read("../src/components/booking/SquareCardPayment.jsx");
  assert.match(card, /status\.paid && status\.bookingStatus === "confirmed"/);
  assert.match(card, /\["processing", "unknown"\]\.includes\(status\.attemptStatus\)/);
  assert.match(card, /setState\("verifying"\)/);
  assert.match(card, /setState\("restart"\)/);
  assert.match(card, /Your appointment reservation is no longer held/);
  assert.match(card, /onChooseNewAppointment/);
  assert.match(card, /initialize\(true\)/);
  assert.doesNotMatch(card, /createPendingPaymentBooking|createBooking/);
});

test("choosing a new appointment clears identity and refreshes availability", async () => {
  const source = await bookingPage();
  const handler = source.match(
    /const handleChooseNewAppointment[^]*?\n {2}\}, \[paymentIdentity, service, serviceSlug\]\);/,
  )?.[0] ?? "";
  assert.match(handler, /clearPaymentIdentity/);
  assert.match(handler, /setPaymentIdentity\(null\)/);
  assert.match(handler, /setSelectedDate\(null\)/);
  assert.match(handler, /setSelectedSlot\(null\)/);
  assert.match(handler, /getAvailableSlots\(\)/);
  assert.doesNotMatch(handler, /initializeDirectPayment|createPendingPaymentBooking/);
});

test("unavailable-slot race returns to authoritative slot selection", async () => {
  const source = await bookingPage();
  assert.match(source, /slot\.\*\(\?:no longer available\|already been booked\)/);
  assert.match(source, /setSlots\(await getAvailableSlots\(\)\)/);
  assert.match(source, /setSelectedDate\(null\)/);
  assert.match(source, /setSelectedSlot\(null\)/);
  assert.match(source, /appointment time is no longer available/);
});

test("Voice Memo continues through the same direct-payment implementation", async () => {
  const page = await bookingPage();
  const form = await read("../src/components/booking/BookingForm.jsx");
  assert.match(page, /showingDirectPayment && \(/);
  assert.match(page, /onChooseNewAppointment=\{isTimed \?/);
  assert.match(form, /required=\{!isTimed\}/);
  assert.match(form, /Tell Amanda the topic or question/);
  assert.match(page, /payment_flow === "direct_payment"/);
});
