import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const publicComponents = [
  '../src/components/booking/TimeSlotPicker.jsx',
  '../src/components/booking/BookingForm.jsx',
  '../src/components/booking/BookingRequestSummary.jsx',
];
const adminComponents = [
  '../src/components/admin/SlotItem.jsx',
  '../src/components/admin/bookings/BookingCard.jsx',
  '../src/components/admin/bookings/CreateBookingPanel.jsx',
  '../src/pages/admin/AdminDashboard.jsx',
];

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('public appointment displays use the shared slot-time formatter', async () => {
  for (const path of publicComponents) {
    const value = await source(path);
    assert.match(value, /import \{ formatSlotTime \} from/);
    assert.match(value, /formatSlotTime\(/);
  }
});

test('admin appointment displays use the shared slot-time formatter', async () => {
  for (const path of adminComponents) {
    const value = await source(path);
    assert.match(value, /import \{ formatSlotTime(?:, isSlotPast)? \} from/);
    assert.match(value, /formatSlotTime\(/);
  }
});
