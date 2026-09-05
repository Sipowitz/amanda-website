import assert from "node:assert/strict";
import test from "node:test";

import { formatBookingAppointment } from
  "../supabase/functions/process-booking-emails/lib/formatters.ts";
import { buildEmail } from
  "../supabase/functions/process-booking-emails/templates/index.ts";

const context = {
  siteUrl: "https://example.com",
  timezone: "America/Chicago",
};

const timedPayload = {
  booking_id: "123e4567-e89b-42d3-a456-426614174000",
  customer_name: "Test Customer",
  customer_email: "customer@example.com",
  customer_phone: "555-0100",
  customer_message: "Test reading",
  service_name: "Private Reading",
  service_booking_mode: "timed",
  service_currency: "USD",
  slot_date: "2026-07-15",
  slot_time: "10:00",
  reminder_hours: 24,
  booking_status: "confirmed",
  payment_status: "paid",
  amount_due: 85,
  amount_paid: 85,
  amount_received: 85,
  amount_remaining: 0,
};

test("configured IANA timezone renders standard-time abbreviation", () => {
  const appointment = formatBookingAppointment(
    "2026-01-15",
    "10:00",
    "America/Chicago",
  );

  assert.equal(appointment.date, "Thursday, 15 January 2026");
  assert.equal(appointment.time, "10:00 AM CST");
});

test("configured IANA timezone renders daylight-saving abbreviation", () => {
  const appointment = formatBookingAppointment(
    "2026-07-15",
    "10:00",
    "America/Chicago",
  );

  assert.equal(appointment.date, "Wednesday, 15 July 2026");
  assert.equal(appointment.time, "10:00 AM CDT");
});

for (const emailType of [
  "booking_request_customer",
  "booking_request_admin",
  "booking_confirmed",
  "booking_cancelled",
  "part_payment_received",
  "payment_received",
  "booking_reminder_24h",
  "booking_reminder_customer",
  "booking_reminder_admin",
]) {
  test(`${emailType} uses the configured timezone for appointment time`, () => {
    const email = buildEmail(emailType, timedPayload, context);

    assert.match(email.text, /time: 10:00 AM CDT/i);
    assert.match(email.html, /10:00 AM CDT/);
    assert.doesNotMatch(email.text, /BST|Europe\/London/);
  });
}

test("untimed Voice Memo email remains free of appointment fields", () => {
  const email = buildEmail("booking_confirmed", {
    ...timedPayload,
    service_name: "Voice Memo Reading",
    service_booking_mode: "untimed",
    slot_date: null,
    slot_time: null,
  }, context);

  assert.doesNotMatch(email.text, /^Date:/m);
  assert.doesNotMatch(email.text, /^Time:/m);
});

test("paid Voice Memo confirmation acknowledges direct payment without a payment link", () => {
  const email = buildEmail("booking_confirmed", {
    ...timedPayload,
    service_name: "Voice Memo Reading",
    service_booking_mode: "untimed",
    direct_payment: true,
    amount_due: 20,
    amount_paid: 20,
    stripe_payment_link_url: "https://buy.stripe.com/example",
  }, context);

  assert.match(email.text, /Payment received: \$20\.00/);
  assert.doesNotMatch(email.text, /Pay now:/);
  assert.doesNotMatch(email.html, />Pay now</);
});

test("paid timed confirmation renders appointment and omits Stripe payment link", () => {
  const email = buildEmail("booking_confirmed", {
    ...timedPayload,
    direct_payment: true,
    stripe_payment_link_url: "https://buy.stripe.com/example",
  }, context);

  assert.match(email.text, /Date: Wednesday, 15 July 2026/);
  assert.match(email.text, /Time: 10:00 AM CDT/);
  assert.match(email.text, /Payment received: \$85\.00/);
  assert.doesNotMatch(email.text, /Pay now:/);
  assert.doesNotMatch(email.html, />Pay now</);
});

test("paid direct admin notification is not described as a pending request", () => {
  const email = buildEmail("booking_request_admin", {
    ...timedPayload,
    direct_payment: true,
  }, context);

  assert.match(email.subject, /New paid booking/);
  assert.match(email.text, /paid booking has been confirmed/);
  assert.match(email.text, /Payment: Received/);
  assert.match(email.text, /Date: Wednesday, 15 July 2026/);
  assert.match(email.text, /Time: 10:00 AM CDT/);
  assert.doesNotMatch(email.text, /booking request has been received/i);
});
