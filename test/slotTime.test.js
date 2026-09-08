import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { rolldown } from 'rolldown';
import { businessDate, isSlotPast, visibleAdminSlots } from '../src/utils/slotTime.js';

const now = Date.parse('2026-07-16T04:30:00Z'); // July 15, 23:30 in Chicago
const slot = (starts_at, overrides = {}) => ({starts_at, is_available: true, bookings: [], ...overrides});

test('elapsed start, exact start, later today, yesterday and tomorrow use actual instants', () => {
  for (const [instant, past] of [
    ['2026-07-16T04:29:59Z', true],
    ['2026-07-16T04:30:00Z', false],
    ['2026-07-16T04:30:00.001Z', false],
    ['2026-07-16T04:31:00Z', false],
    ['2026-07-15T18:00:00Z', true],
    ['2026-07-16T14:00:00Z', false],
  ]) assert.equal(isSlotPast(slot(instant), now), past);
  assert.equal(isSlotPast(slot('2026-07-16T04:30:00Z'), now + 1), true);
  assert.equal(isSlotPast({}, now), true);
  assert.equal(isSlotPast(slot('invalid'), now), true);
});

test('business calendar day is independent of browser/UTC boundaries and observes DST', () => {
  assert.equal(businessDate('America/Chicago', now), '2026-07-15');
  assert.equal(businessDate('Asia/Tokyo', now), '2026-07-16');
  assert.equal(businessDate('America/Chicago', Date.parse('2026-07-16T05:00:00Z')), '2026-07-16');
  assert.equal(businessDate('America/Chicago', Date.parse('2026-01-16T05:30:00Z')), '2026-01-15');
  assert.equal(businessDate(null, now), null);
});

test('PostgreSQL DST instants remain unambiguous across spring gaps and repeated fall hours', () => {
  const fall = slot('2026-11-01T07:30:00Z'); // second 01:30, PostgreSQL standard-time rule
  assert.equal(isSlotPast(fall, Date.parse('2026-11-01T06:45:00Z')), false);
  assert.equal(isSlotPast(fall, Date.parse('2026-11-01T07:31:00Z')), true);
  assert.equal(isSlotPast(slot('2026-03-08T08:30:00Z'), Date.parse('2026-03-08T08:29:00Z')), false);
});

test('admin filtering retains every booked historical slot and never reopens a checkout hold', () => {
  const past = slot('2026-07-16T04:00:00Z');
  const history = slot(past.starts_at, {is_available: false, bookings: [{status: 'completed'}]});
  const held = slot(past.starts_at, {is_available: false, bookings: [{status: 'pending_payment'}]});
  const future = slot('2026-07-16T04:45:00Z');
  const original = structuredClone([past,history,held,future]);
  assert.deepEqual(visibleAdminSlots([past,history,held,future], now), [history,held,future]);
  assert.deepEqual([past,history,held,future], original);
  assert.deepEqual([past, future].filter((s) => !isSlotPast(s, now)), [future]);
});

const bundle = await rolldown({
  input: new URL('../src/services/adminService.js', import.meta.url).pathname,
  platform: 'node', plugins: [{
    name: 'slot-query-boundary',
    resolveId(source) { if (source === '../lib/supabase') return '\0db'; },
    load(id) { if (id === '\0db') return 'export const supabase = globalThis.slotQueryDb;'; },
  }],
});
const {output} = await bundle.generate({format: 'esm'});
await bundle.close();

test('admin slots request authoritative instants without a UTC date filter; bookings retain all history', async () => {
  const calls = [];
  const future = slot('2099-01-01T00:00:00Z');
  const history = slot('2000-01-01T00:00:00Z', {bookings: [{id: 'historical'}]});
  const chain = {
    select(value) { calls.push(['select',value]); return this; },
    order() { return this; }, eq() { return this; },
    then(resolve) { return Promise.resolve({data: [future,history], error: null}).then(resolve); },
  };
  globalThis.slotQueryDb = {from() {return chain;}, rpc: async () => ({data: [], error: null})};
  const service = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
  assert.deepEqual(await service.getAdminSlots(), [future,history]);
  assert.deepEqual(await service.getAvailableAdminSlots(), [future]);
  assert.equal((await service.getAdminBookings()).length, 2);
  assert.ok(calls.some(([,select]) => select === '*'));
  assert.ok(calls.some(([,select]) => select.includes('starts_at')));
  assert.ok(calls.every(([,select]) => !select.includes('starts_at:slot_starts_at')));
});

test('forward migration retains guarded paths and limits new public information', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260908000000_business_timezone_slot_expiry.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(migration, /current_date|delete from public\.bookings|disable row level security/i);
  assert.match(migration, /returns text language sql stable security definer set search_path = ''/);
  assert.match(migration, /not exists \(select 1 from public\.bookings b where b\.slot_id = slot\.id\)/);
  assert.match(migration, /is_available is true and public\.slot_starts_at/);
  assert.match(migration, /selected_attempt\.status <> 'reserved'/);
  assert.match(migration, /perform private\.require_admin\(\)/);
  assert.doesNotMatch(migration, /grant .*on (?:table )?public\.email_settings/i);
  assert.doesNotMatch(migration, /create or replace function public\.(?:record_provider_payment_result|get_payment_status|abandon_timed_payment_booking)/);
});

test('materialized-start migration keeps RLS cheap and derived data protected', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260908100000_materialize_availability_slot_starts_at.sql', import.meta.url), 'utf8');
  assert.match(migration, /add column starts_at timestamptz/);
  assert.match(migration, /alter column starts_at set not null/);
  assert.match(migration, /before insert or update of slot_date, slot_time/);
  assert.match(migration, /new\.starts_at := private\.slot_start_instant/);
  assert.match(migration, /after update of timezone/);
  assert.match(migration, /set starts_at = private\.slot_start_instant/);
  assert.match(migration, /where slot\.starts_at < clock_timestamp\(\)/);
  assert.match(migration, /using \(is_available is true and starts_at >= clock_timestamp\(\)\)/);
  assert.match(migration, /as \$\$ select \$1\.starts_at; \$\$/);
  assert.match(migration, /availability_slots_available_starts_at_idx/);
  assert.doesNotMatch(migration, /grant .*on (?:table )?public\.email_settings/i);
  assert.doesNotMatch(migration, /delete from public\.bookings/i);
});
