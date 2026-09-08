import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [settings, email, app, service] = await Promise.all([
  read("src/pages/admin/AdminSettings.jsx"),
  read("src/pages/admin/AdminEmailSettings.jsx"),
  read("src/App.jsx"),
  read("src/services/adminService.js"),
]);

test("settings opens the operational form directly", () => {
  assert.match(settings, /<AdminEmailSettings embedded \/>/);
  assert.match(settings, /title="Settings"/);
  assert.doesNotMatch(settings, /Business details|Booking rules|Payments|System Configuration/);
  assert.doesNotMatch(settings, /Stripe|Square|provider/i);
});

test("email settings route redirects to the unified settings page", () => {
  assert.match(app, /path="\/admin\/settings\/email"[\s\S]*Navigate to="\/admin\/settings"/);
  assert.match(app, /path="\/admin\/settings\/payments"/);
  assert.doesNotMatch(settings, /settings\/payments/);
});

test("the unified form exposes only human-facing operational controls", () => {
  for (const label of [
    "Notification email",
    "Send Amanda booking reminders",
    "Customer reminders",
    "12 hours before",
    "1 day before",
    "2 days before",
    "3 days before",
    "1 week before",
    "Earliest send time",
    "Latest send time",
    "Business timezone",
  ]) assert.match(email, new RegExp(label));

  for (const technical of [
    "Confirmed bookings only",
    "Unpaid bookings",
    "Part-paid bookings",
    "Fully paid bookings",
    "Stripe",
    "Square",
    "payment provider",
  ]) assert.doesNotMatch(email, new RegExp(technical, "i"));
});

test("hidden reminder policy fields are round-tripped and timezone is always enabled", () => {
  for (const field of [
    "confirmedBookingsOnly",
    "sendForUnpaid",
    "sendForPartPaid",
    "sendForPaid",
  ]) assert.match(email, new RegExp(field));
  assert.match(email, /name="timezone"/);
  assert.doesNotMatch(email, /name="timezone"[\s\S]{0,180}disabled/);
  assert.match(email, /Change business timezone\?/);
  assert.match(email, /existing appointment times as well as reminders/);
});

test("saving still uses the protected service-layer RPC contract", () => {
  assert.match(email, /updateEmailSettings\(/);
  assert.match(service, /rpc\("update_email_settings"/);
  for (const parameter of [
    "p_confirmed_bookings_only",
    "p_send_for_unpaid",
    "p_send_for_part_paid",
    "p_send_for_paid",
  ]) assert.match(service, new RegExp(parameter));
});
