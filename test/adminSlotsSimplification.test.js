import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, item, generator, service] = await Promise.all([
  read("src/pages/admin/AdminSlots.jsx"),
  read("src/components/admin/SlotItem.jsx"),
  read("src/components/admin/SlotGenerator.jsx"),
  read("src/services/adminService.js"),
]);

test("availability page is inventory-only and has no page-load cleanup", () => {
  assert.doesNotMatch(page, /deletePastAvailabilitySlots/);
  assert.doesNotMatch(page, /All Slots|Bookings Only|Cancel Booking|selectedDateStats/);
  assert.match(page, /View bookings/);
  assert.match(page, /No availability has been added for this date\./);
  assert.doesNotMatch(item, /customer_name|customer_email|customer_phone|payment|Cancel Booking|reserved|processing/);
});

test("slot presentation exposes only safe inventory statuses and deletion", () => {
  assert.match(item, /const status = booked \? "Booked" : slot\.is_available \? "Available" : "Unavailable"/);
  assert.match(item, /const canDelete = !booked && slot\.is_available/);
  assert.match(item, /onClick=\{\(\) => onDelete\(slot\.id\)\}/);
});

test("admin slot query minimizes booking data", () => {
  const slotQuery = service.slice(service.indexOf("export async function getAdminSlots"), service.indexOf("export async function deletePastAvailabilitySlots"));
  assert.match(slotQuery, /id,\s+slot_date,\s+slot_time,\s+starts_at,\s+is_available/);
  assert.match(slotQuery, /bookings \(\s*id,\s*status/s);
  assert.doesNotMatch(slotQuery, /customer_email|customer_name|payment_status/);
});

test("generator supports single-date and optional repeated weekday creation", () => {
  assert.match(generator, /const \[repeat, setRepeat\]/);
  assert.match(generator, /endDate: repeat \? formData\.endDate : formData\.startDate/);
  assert.match(generator, /selectedDays: repeat \? selectedDays : \[start\.getDay\(\)\]/);
  for (const interval of ["15", "30", "45", "60"]) assert.match(generator, new RegExp(`value="${interval}"`));
  assert.match(generator, /Repeat across dates/);
});
