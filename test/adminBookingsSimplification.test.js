import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { rolldown } from 'rolldown';

const require = createRequire(import.meta.url);
const bundle = await rolldown({
  input: new URL('../src/pages/admin/AdminBookings.jsx', import.meta.url).pathname,
  platform: 'node',
  plugins: [{
    name: 'admin-test-boundaries',
    resolveId(source) {
      if (source.endsWith('/adminService')) return '\0service';
      if (source.includes('/contexts/')) return '\0contexts';
      if (source === 'react-router-dom') return '\0router';
      if (source === 'react' || source.startsWith('react/')) {
        return { id: pathToFileURL(require.resolve(source)).href, external: true };
      }
    },
    load(id) {
      if (id === '\0service') return `
        export const getAdminBookings = async () => globalThis.adminTest.bookings;
        export const getAdminBookingPricing = async () => [];
        export const updateBookingStatus = async (...args) => globalThis.adminTest.calls.push(args);
        export const updateBookingPayment = async () => {};
        export const cancelBooking = async () => {};
      `;
      if (id === '\0contexts') return `
        export const useAdminAuth = () => ({logout: async () => {}});
        export const useToast = () => ({success() {}, error(message) { throw Error(message); }});
        export const useConfirm = () => async () => true;
      `;
      if (id === '\0router') return `
        export const useLocation = () => globalThis.adminTest.location;
        export const useNavigate = () => globalThis.adminTest.navigate;
      `;
    },
  }],
});
const { output } = await bundle.generate({ format: 'esm' });
await bundle.close();
const { default: AdminBookings } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const booking = (id, overrides = {}) => ({
  id, customer_name: id, customer_email: `${id}@example.test`,
  service_name_snapshot: 'Private Reading', service_booking_mode_snapshot: 'timed',
  service_payment_flow_snapshot: 'direct_payment', status: 'confirmed',
  payment_status: 'paid', payment_method: 'square', payment_provider: 'square',
  payment_attempt_status: 'completed', amount_due: 85, amount_paid: 85,
  payment_reference: 'payment-reference', paid_at: '2026-09-07T12:00:00Z',
  created_at: '2026-09-07T12:00:00Z',
  availability_slots: {slot_date: '2020-01-01', slot_time: '10:00'},
  ...overrides,
});
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(text).join('');
}
const button = (root, label) => root.findAllByType('button').find((b) => text(b) === label);
async function mount(t, bookings, filter) {
  globalThis.adminTest = {
    bookings, calls: [], location: {pathname: '/admin/bookings', state: {filter}},
    navigate() { globalThis.adminTest.location = {pathname: '/admin/bookings', state: {}}; },
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AdminBookings)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return renderer.root;
}
async function expand(root, name) {
  const card = root.findAllByType('article').find((a) => a.findAllByType('p').some((p) => text(p) === name));
  assert.ok(card, `Card exists: ${name}`);
  await act(async () => card.findAllByType('button')[0].props.onClick());
  return card;
}

test('All plus four lifecycle filters, with Confirmed as the default, work correctly', async (t) => {
  const root = await mount(t, [booking('Overdue'), booking('Memo', {
    service_name_snapshot: 'Voice Memo Reading', service_booking_mode_snapshot: 'untimed', availability_slots: null,
  }), booking('Finished', {status: 'completed'})]);
  assert.deepEqual(root.findAllByType('button').map(text).filter((s) => ['All', 'Confirmed', 'Completed', 'No-show', 'Cancelled'].includes(s)), ['All', 'Confirmed', 'Completed', 'No-show', 'Cancelled']);
  assert.match(text(root), /Overdue/);
  assert.match(text(root), /Memo/);
  assert.doesNotMatch(text(root), /Finished|New Booking|Payment Due|Pending Payment|Upcoming/);
  await act(async () => button(root, 'All').props.onClick());
  assert.match(text(root), /Overdue|Memo|Finished/);
  await act(async () => button(root, 'Completed').props.onClick());
  assert.match(text(root), /Finished/);
  assert.doesNotMatch(text(root), /Overdue/);
});

test('All keeps search and hides unfinished direct-payment records', async (t) => {
  const root = await mount(t, [
    booking('Confirmed Amanda'),
    booking('Completed Amanda', { status: 'completed' }),
    booking('No Show Amanda', { status: 'no_show' }),
    booking('Cancelled Amanda', { status: 'cancelled' }),
    booking('Unfinished Checkout', { status: 'pending_payment', payment_attempt_status: 'reserved', payment_status: 'unpaid' }),
  ]);
  await act(async () => button(root, 'All').props.onClick());
  assert.match(text(root), /Confirmed Amanda|Completed Amanda|No Show Amanda|Cancelled Amanda/);
  assert.doesNotMatch(text(root), /Unfinished Checkout/);
  const search = root.findAllByType('input').find((input) => input.props.type === 'search');
  await act(async () => search.props.onChange({ target: { value: 'No Show' } }));
  assert.match(text(root), /No Show Amanda/);
  assert.doesNotMatch(text(root), /Confirmed Amanda|Completed Amanda|Cancelled Amanda/);
});

test('obsolete navigation filters normalize to Confirmed and unfinished direct bookings stay hidden', async (t) => {
  const hidden = [
    {status: 'pending_payment'}, {status: 'payment_expired'}, {status: 'pending'},
    {payment_attempt_status: 'processing'}, {payment_attempt_status: 'unknown'},
    {payment_status: 'unpaid'}, {status: 'cancelled', payment_attempt_status: 'cancelled', payment_status: 'unpaid'},
  ].map((fields, index) => booking(`Hidden-${index}`, fields));
  const root = await mount(t, [booking('Genuine'), ...hidden], 'payment_due');
  assert.match(text(root), /Genuine/);
  assert.doesNotMatch(text(root), /Hidden-/);
  for (const label of ['Completed', 'No-show', 'Cancelled', 'Confirmed']) {
    await act(async () => button(root, label).props.onClick());
    assert.doesNotMatch(text(root), /Hidden-/);
  }
});

test('settled card has secondary receipt details, guarded completion and timed no-show only', async (t) => {
  const root = await mount(t, [booking('Timed'), booking('Memo', {
    service_booking_mode_snapshot: 'untimed', availability_slots: null,
  })]);
  assert.doesNotMatch(text(root), /Paid|\$85|payment-reference/);
  const timed = await expand(root, 'Timed');
  assert.match(text(timed), /Amount: \$85.00/);
  assert.match(text(timed), /payment-reference|Paid on:/);
  assert.doesNotMatch(text(timed), /Paid via Square|Provider-confirmed|Due:|Requested|Timeline|Manage payment|Save Payment/);
  const labels = timed.findAllByType('button').map(text);
  assert.ok(labels.includes('Mark completed'));
  assert.ok(labels.includes('Mark no-show'));
  for (const label of ['Cancel', 'Confirm', 'Pending']) assert.ok(!labels.includes(label));
  await act(async () => button(timed, 'Mark completed').props.onClick());
  assert.deepEqual(globalThis.adminTest.calls, [['Timed', 'completed']]);
  await act(async () => button(timed, 'Mark no-show').props.onClick());
  assert.deepEqual(globalThis.adminTest.calls[1], ['Timed', 'no_show']);
  const memo = await expand(root, 'Memo');
  assert.ok(button(memo, 'Mark completed'));
  assert.equal(button(memo, 'Mark no-show'), undefined);
});

test('legacy pending requests retain conditional confirmation and payment controls', async (t) => {
  const root = await mount(t, [booking('Legacy', {
    service_payment_flow_snapshot: null, status: 'pending', payment_status: 'unpaid',
    payment_provider: null, payment_attempt_status: null,
  }), booking('LegacyConfirmed', {service_payment_flow_snapshot: 'payment_link'})]);
  assert.match(text(root), /Legacy requests awaiting confirmation/);
  const legacy = await expand(root, 'Legacy');
  assert.ok(button(legacy, 'Confirm'));
  assert.ok(button(legacy, 'Cancel'));
  await act(async () => button(legacy, 'Manage payment').props.onClick());
  assert.ok(button(legacy, 'Save Payment'));
  await act(async () => button(legacy, 'Confirm').props.onClick());
  assert.deepEqual(globalThis.adminTest.calls, [['Legacy', 'confirmed']]);
  const confirmed = await expand(root, 'LegacyConfirmed');
  assert.ok(button(confirmed, 'Pending'));
});
