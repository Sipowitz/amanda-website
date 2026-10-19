import process from "node:process";
import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { rolldown } from 'rolldown';
const require = createRequire(import.meta.url);
const bundle = await rolldown({
  input: new URL('../src/components/booking/DateSelector.jsx', import.meta.url).pathname,
  platform: 'node', plugins: [{
    name: 'calendar-react', resolveId(source) {
      if (source === 'react' || source.startsWith('react/')) return {id: pathToFileURL(require.resolve(source)).href, external: true};
    },
  }],
});
const {output} = await bundle.generate({format: 'esm'});
await bundle.close();
const {default: DateSelector} = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('calendar uses supplied business date in a different browser timezone and advances at midnight', async (t) => {
  const original = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  t.after(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; });
  let root;
  const selected = [];
  const props = {availableDates: ['2026-07-31', '2026-08-01'], onSelectDate: (d) => selected.push(d)};
  await act(async () => { root = create(React.createElement(DateSelector, {...props, todayDate: null})); });
  t.after(async () => { await act(async () => root.unmount()); });
  assert.equal(root.root.findAllByType('button').length, 0);
  await act(async () => root.update(React.createElement(DateSelector, {...props, todayDate: '2026-07-31'})));
  const day = root.root.findAllByType('button').find((b) => b.props['aria-label']?.includes('July 31, 2026'));
  assert.equal(day.props.disabled, false);
  await act(async () => day.props.onClick());
  assert.deepEqual(selected, ['2026-07-31']);
  await act(async () => root.update(React.createElement(DateSelector, {...props, todayDate: '2026-08-01'})));
  assert.ok(root.root.findAllByType('button').some((b) => b.props['aria-label']?.includes('August 1, 2026') && !b.props.disabled));
  assert.ok(!root.root.findAllByType('button').some((b) => b.props['aria-label']?.includes('July 31, 2026')));
});

test('calendar uses only the complete weeks needed by each month', async (t) => {
  const props = {availableDates: [], onSelectDate: () => {}};
  const emptyCells = (root) => root.root.findAllByType('div').filter((cell) => cell.props.className === 'aspect-square h-auto sm:aspect-auto sm:h-[60px] md:h-[68px]').length;
  const mountCalendar = async (todayDate) => {
    let root;
    await act(async () => { root = create(React.createElement(DateSelector, {...props, todayDate})); });
    t.after(async () => { await act(async () => root.unmount()); });
    return root;
  };
  assert.equal(emptyCells(await mountCalendar('2026-02-01')), 0, 'February 2026 uses four rows');
  assert.equal(emptyCells(await mountCalendar('2026-03-01')), 4, 'March 2026 uses five rows');
  assert.equal(emptyCells(await mountCalendar('2021-05-01')), 11, 'May 2021 uses six rows');
});
