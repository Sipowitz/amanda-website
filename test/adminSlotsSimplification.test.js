import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, editor, service] = await Promise.all([
  read("src/pages/admin/AdminSlots.jsx"),
  read("src/components/admin/AvailabilityPeriodEditor.jsx"),
  read("src/services/adminService.js"),
]);

test("availability administration uses periods rather than legacy slot generation", () => {
  assert.match(page, /AvailabilityPeriodEditor/);
  assert.match(page, /Legacy availability is still present/);
  assert.doesNotMatch(page, /SlotGenerator|generateSlots|deleteSlot/);
  assert.match(editor, /Single date/);
  assert.match(editor, /Multiple dates/);
  assert.match(editor, /Preview appointment times/);
  assert.match(editor, /expandAvailabilityDates/);
  assert.doesNotMatch(editor, /Interval|15 mins|30 mins|45 mins/);
});

test("period service functions use protected period and preview RPCs", () => {
  for (const name of ["get_admin_availability_period_overview", "preview_availability_period_batch", "create_availability_period_batch", "update_availability_period", "delete_availability_period"]) assert.match(service, new RegExp(name));
  assert.match(service, /p_exclude_period_id/);
});
