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
  input: new URL('../src/pages/admin/AdminDashboard.jsx', import.meta.url).pathname,
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
        export const getAdminBookings = async () => { if (globalThis.dashboardTest.fail) throw Error("offline"); return globalThis.dashboardTest.bookings; };
      `;
      if (id === '\0contexts') return `
        export const useAdminAuth = () => ({logout: async () => {}});
        export const useToast = () => ({success() {}, error(message) { throw Error(message); }});
        export const useConfirm = () => async () => true;
      `;
      if (id === '\0router') return `
        export const useNavigate = () => globalThis.dashboardTest.navigate;
      `;
    },
  }],
});
const { output } = await bundle.generate({ format: 'esm' });
await bundle.close();
const { default: AdminDashboard } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const booking = (id, overrides = {}) => ({
  id, customer_name: id, customer_email: `${id}@example.test`,
  service_name_snapshot: 'Private Reading', service_booking_mode_snapshot: 'timed',
  service_payment_flow_snapshot: 'direct_payment', status: 'confirmed',
  payment_status: 'paid', payment_method: 'square', payment_provider: 'square',
  payment_attempt_status: 'completed', created_at: '2026-09-01T12:00:00Z',
  availability_slots: {slot_date: '2026-09-07', slot_time: '15:00'}, ...overrides,
});
const slot = (date, time = '15:00') => ({availability_slots: {slot_date: date, slot_time: time}});
const memo = (id, fields = {}) => booking(id, {
  service_booking_mode_snapshot: 'untimed', service_name_snapshot: 'Voice Memo Reading',
  availability_slots: null, ...fields,
});
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(text).join('');
}
const section = (root, name) => root.findAllByType('section').find((s) => s.props['aria-label'] === name);
async function mount(t, bookings, {fail = false} = {}) {
  t.mock.timers.enable({apis: ['Date'], now: new Date('2026-09-07T12:00:00').getTime()});
  globalThis.dashboardTest = {bookings, calls: [], fail, navigate: (...args) => globalThis.dashboardTest.calls.push(args)};
  const listeners = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    setInterval(callback) { listeners.set('interval', callback); return 1; },
    clearInterval() { listeners.delete('interval'); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AdminDashboard)); });
  t.after(async () => {
    await act(async () => renderer.unmount());
    assert.equal(listeners.size, 0);
    globalThis.window = previousWindow;
  });
  return {root: renderer.root, listeners};
}

test('today, chronological upcoming, overdue, and untimed work have dedicated sections', async (t) => {
  const {root} = await mount(t, [
    booking('Today'), booking('EarlierToday', slot('2026-09-07', '09:00')),
    booking('Later', slot('2026-09-09')), booking('Sooner', slot('2026-09-08')),
    booking('Overdue', slot('2026-09-06')), memo('Memo'),
  ]);
  const today = text(section(root, 'Today’s appointments'));
  assert.match(today, /Today/);
  assert.match(today, /EarlierToday.*Overdue · review outcome/);
  const future = text(section(root, 'Upcoming appointments'));
  assert.ok(future.indexOf('Sooner') < future.indexOf('Later'));
  assert.doesNotMatch(future, /EarlierToday/);
  assert.match(text(section(root, 'Overdue appointments')), /Overdue/);
  assert.match(text(section(root, 'Voice Memos awaiting completion')), /Memo.*Voice Memo Reading/);
  const row = section(root, 'Today’s appointments').findAllByType('button')[0];
  await act(async () => row.props.onClick());
  assert.deepEqual(globalThis.dashboardTest.calls, [['/admin/bookings', {state: {filter: 'confirmed'}}]]);
  assert.doesNotMatch(text(root), /Paid|Payment|Square|Awaiting confirmation|Pending|To collect|Recorded/);
});

test('terminal bookings and unfinished direct checkouts never become outstanding work', async (t) => {
  const records = ['completed', 'no_show', 'cancelled', 'pending_payment', 'payment_expired', 'pending']
    .flatMap((status) => [booking(`Hidden-${status}`, {status}), memo(`Hidden-memo-${status}`, {status})]);
  records.push(...['processing', 'unknown', 'reserved'].map((state) => booking(`Hidden-${state}`, {payment_attempt_status: state})));
  records.push(booking('Hidden-unpaid', {payment_status: 'unpaid'}));
  const {root} = await mount(t, records);
  assert.doesNotMatch(text(root), /Hidden-|Review historical/);
  assert.equal(section(root, 'Overdue appointments'), undefined);
  assert.match(text(root), /Nothing scheduled today/);
  assert.match(text(root), /No Voice Memos awaiting completion/);
});

test('upcoming preview is bounded, counted in full, and Voice Memos remain oldest first', async (t) => {
  const {root} = await mount(t, [
    ...Array.from({length: 6}, (_, i) => booking(`Future${i}`, slot(`2026-09-${10 + i}`))).reverse(),
    memo('NewMemo', {created_at: '2026-09-06T12:00:00Z'}),
    memo('OldMemo', {created_at: '2026-08-01T12:00:00Z'}),
  ]);
  const future = text(section(root, 'Upcoming appointments'));
  assert.match(future, /Future0/);
  assert.doesNotMatch(future, /Future5/);
  assert.match(future, /View all 6 upcoming appointments/);
  const memos = text(section(root, 'Voice Memos awaiting completion'));
  assert.ok(memos.indexOf('OldMemo') < memos.indexOf('NewMemo'));
});

test('legacy exceptions have one modest review link without payment tasks', async (t) => {
  const {root} = await mount(t, [
    booking('LegacyRequest', {status: 'pending', service_payment_flow_snapshot: null}),
    booking('LegacyAppointment', {service_payment_flow_snapshot: 'payment_link', payment_status: 'unpaid'}),
  ]);
  assert.match(text(section(root, 'Today’s appointments')), /LegacyAppointment/);
  assert.doesNotMatch(text(root), /LegacyRequest|Payment due|Awaiting confirmation|Unpaid/);
  const link = root.findAllByType('button').find((b) => text(b).includes('Review historical'));
  assert.ok(link);
  await act(async () => link.props.onClick());
  assert.deepEqual(globalThis.dashboardTest.calls[0], ['/admin/bookings', {state: {filter: 'confirmed'}}]);
});

test('clock refresh flags passed appointment times and moves yesterday into overdue', async (t) => {
  const {root, listeners} = await mount(t, [booking('Today')]);
  assert.doesNotMatch(text(section(root, 'Today’s appointments')), /Overdue/);
  t.mock.timers.setTime(new Date('2026-09-07T16:00:00').getTime());
  await act(async () => listeners.get('interval')());
  assert.match(text(section(root, 'Today’s appointments')), /Overdue/);
  t.mock.timers.setTime(new Date('2026-09-08T09:00:00').getTime());
  await act(async () => listeners.get('focus')());
  assert.match(text(section(root, 'Overdue appointments')), /Today/);
  assert.doesNotMatch(text(section(root, 'Today’s appointments')), /today@example/);
});

test('load failure is explicit and retry restores work', async (t) => {
  const {root} = await mount(t, [memo('RecoveredMemo')], {fail: true});
  assert.match(text(root), /Failed to load dashboard/);
  assert.equal(section(root, 'Today’s appointments'), undefined);
  globalThis.dashboardTest.fail = false;
  await act(async () => root.findAllByType('button').find((b) => text(b) === 'Try again').props.onClick());
  assert.match(text(root), /RecoveredMemo/);
  assert.doesNotMatch(text(root), /Failed to load dashboard/);
});
