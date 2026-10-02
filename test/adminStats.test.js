import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";
import React from "react";
import { act, create } from "react-test-renderer";
import { rolldown } from "rolldown";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const [app, sidebar, page] = await Promise.all([
  read("src/App.jsx"),
  read("src/components/admin/AdminSidebar.jsx"),
  read("src/pages/admin/AdminStats.jsx"),
]);

const bundle = await rolldown({
  input: new URL("../src/pages/admin/AdminStats.jsx", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "admin-stats-boundaries",
    resolveId(source) {
      if (source.endsWith("/adminService")) return "\0service";
      if (source === "recharts") return "\0charts";
      if (source === "react" || source.startsWith("react/")) return { id: pathToFileURL(require.resolve(source)).href, external: true };
    },
    load(id) {
      if (id === "\0service") return `export const getAdminStats = () => globalThis.statsTest.load();`;
      if (id === "\0charts") return `
        import React from 'react';
        export const ResponsiveContainer = ({children}) => React.createElement('div', {className: 'responsive-chart'}, children);
        export const BarChart = ({children}) => React.createElement('div', {className: 'bar-chart'}, children);
        export const Bar = () => null; export const XAxis = () => null; export const YAxis = () => null; export const Tooltip = () => null;
      `;
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
const module = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
const { default: AdminStats, prepareMonthlyChartData } = module;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return (node.children || []).map(text).join("");
}

const months = Array.from({ length: 12 }, (_, index) => {
  const month = String(index + 1).padStart(2, "0");
  return { month: `2026-${month}`, paid_booking_count: index === 3 ? 0 : index + 1, value_by_currency: index === 3 ? [] : [{ currency: "USD", value_minor: (index + 1) * 1000 }] };
});

const stats = (overrides = {}) => ({
  reporting_timezone: "America/Chicago",
  week_starts_on: "monday",
  period_totals: {
    today: { paid_booking_count: 2, value_by_currency: [{ currency: "USD", value_minor: 8500 }] },
    week: { paid_booking_count: 4, value_by_currency: [{ currency: "USD", value_minor: 17000 }] },
    month: { paid_booking_count: 5, value_by_currency: [{ currency: "USD", value_minor: 21250 }] },
    year: { paid_booking_count: 8, value_by_currency: [{ currency: "USD", value_minor: 34000 }] },
    all_time: { paid_booking_count: 9, value_by_currency: [{ currency: "USD", value_minor: 38250 }] },
  },
  monthly_history: months,
  service_breakdown: [
    { service_id: "one", service_name: "Frozen First", paid_booking_count: 5, value_by_currency: [{ currency: "USD", value_minor: 21250 }] },
    { service_id: "two", service_name: "Frozen Second", paid_booking_count: 4, value_by_currency: [{ currency: "USD", value_minor: 17000 }] },
  ],
  data_integrity_exceptions: [],
  ...overrides,
});

async function mount(data = stats()) {
  globalThis.statsTest = { calls: 0, load: async () => { globalThis.statsTest.calls += 1; return data; } };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AdminStats)); });
  return { renderer, root: renderer.root };
}

test("Stats is protected and placed between Dashboard and Bookings in existing navigation", () => {
  assert.match(app, /ProtectedAdminRoute[\s\S]*path="\/admin\/stats"[\s\S]*AdminStats/);
  const dashboard = sidebar.indexOf('label: "Dashboard"');
  const statsLink = sidebar.indexOf('label: "Stats", path: "/admin/stats"');
  const bookings = sidebar.indexOf('label: "Bookings"');
  assert.ok(dashboard < statsLink && statsLink < bookings);
  for (const label of ["Dashboard", "Bookings", "Availability", "Discount codes", "Settings"]) assert.match(sidebar, new RegExp(`label: "${label}"`));
});

test("Value is the default and all period cards use aggregate monetary values", async () => {
  const { root, renderer } = await mount();
  try {
    assert.equal(globalThis.statsTest.calls, 1);
    const valueButton = root.findAllByType("button").find((button) => text(button) === "Value");
    assert.equal(valueButton.props["aria-pressed"], true);
    for (const label of ["Today", "This week", "This month", "This year", "All time"]) assert.match(text(root), new RegExp(label));
    assert.match(text(root), /\$85\.00/);
    assert.doesNotMatch(text(root), /9 bookings/);
  } finally { await act(async () => renderer.unmount()); }
});

test("mode changes reuse loaded data, preserve service order, and switch displayed metric", async () => {
  const { root, renderer } = await mount();
  try {
    const orderBefore = text(root).indexOf("Frozen First") < text(root).indexOf("Frozen Second");
    await act(async () => root.findAllByType("button").find((button) => text(button) === "Bookings").props.onClick());
    assert.equal(globalThis.statsTest.calls, 1);
    assert.match(text(root), /2 bookings/);
    assert.doesNotMatch(text(root), /\$85\.00/);
    assert.ok(orderBefore && text(root).indexOf("Frozen First") < text(root).indexOf("Frozen Second"));
    await act(async () => root.findAllByType("button").find((button) => text(button) === "Value").props.onClick());
    assert.equal(globalThis.statsTest.calls, 1);
    assert.match(text(root), /\$85\.00/);
  } finally { await act(async () => renderer.unmount()); }
});

test("chart preparation retains all twelve backend months including zero months", () => {
  const chart = prepareMonthlyChartData(months);
  assert.equal(chart.rows.length, 12);
  assert.equal(chart.rows[3].month, "2026-04");
  assert.equal(chart.rows[3].paid_booking_count, 0);
  assert.equal(chart.rows[3].value_USD, undefined);
});

test("integrity warning and timezone note are safe and conditional", async () => {
  const warningData = stats({ data_integrity_exceptions: [{ reason: "missing_paid_at", paid_booking_count: 1 }] });
  const first = await mount(warningData);
  try {
    assert.match(text(first.root), /Some paid records were excluded/);
    assert.match(text(first.root), /Reporting timezone: America\/Chicago/);
    assert.doesNotMatch(text(first.root), /CST/);
  } finally { await act(async () => first.renderer.unmount()); }
  const second = await mount(stats());
  try { assert.doesNotMatch(text(second.root), /Some paid records were excluded/); }
  finally { await act(async () => second.renderer.unmount()); }
});

test("multiple currencies remain separate and empty paid data is safe", async () => {
  const multiCurrency = stats({
    period_totals: { ...stats().period_totals, today: { paid_booking_count: 2, value_by_currency: [{ currency: "USD", value_minor: 8500 }, { currency: "EUR", value_minor: 4000 }] } },
    service_breakdown: [],
  });
  const first = await mount(multiCurrency);
  try {
    assert.match(text(first.root), /\$85\.00/);
    assert.match(text(first.root), /€40\.00/);
    assert.doesNotMatch(text(first.root), /\$125\.00/);
  } finally { await act(async () => first.renderer.unmount()); }
  const empty = await mount(stats({
    period_totals: Object.fromEntries(["today", "week", "month", "year", "all_time"].map((key) => [key, { paid_booking_count: 0, value_by_currency: [] }])),
    service_breakdown: [],
  }));
  try {
    assert.match(text(empty.root), /No value reported/);
    assert.match(text(empty.root), /No paid service data yet/);
  } finally { await act(async () => empty.renderer.unmount()); }
});

test("mobile structure has responsive cards, chart containment, and readable service rows", () => {
  for (const className of ["sm:grid-cols-2 xl:grid-cols-5", "h-72 min-w-0 sm:h-80", "sm:flex-row sm:items-center sm:justify-between", "flex flex-wrap"]) {
    assert.match(page, new RegExp(className));
  }
});
