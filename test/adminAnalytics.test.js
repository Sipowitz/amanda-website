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
  read("src/pages/admin/AdminAnalytics.jsx"),
]);

const bundle = await rolldown({
  input: new URL("../src/pages/admin/AdminAnalytics.jsx", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "admin-analytics-boundaries",
    resolveId(source) {
      if (source.endsWith("/adminService")) return "\0service";
      if (source === "recharts") return "\0charts";
      if (source === "react" || source.startsWith("react/")) {
        return { id: pathToFileURL(require.resolve(source)).href, external: true };
      }
    },
    load(id) {
      if (id === "\0service") return "export const getAdminAnalytics = (...args) => globalThis.analyticsPage.load(...args);";
      if (id === "\0charts") return `
        import React from 'react';
        export const ResponsiveContainer = ({children}) => React.createElement('div', {className: 'responsive-chart'}, children);
        export const LineChart = ({children}) => React.createElement('div', {className: 'line-chart'}, children);
        export const CartesianGrid = () => null; export const Line = () => null;
        export const XAxis = () => null; export const YAxis = () => null; export const Tooltip = () => null;
      `;
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
const { default: AdminAnalytics } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return (node.children || []).map(text).join("");
}

function report() {
  return {
    period: "24h",
    totals: { visits: 2, publicPageviews: 55, bookingPageviews: 6 },
    trend: [
      { timestamp: "2026-10-09T08:00:00Z", visits: 0, pageviews: 3 },
      { timestamp: "2026-10-09T09:00:00Z", visits: 2, pageviews: 8 },
    ],
    pages: [{ path: "/services", pageviews: 31 }, { path: "/contact", pageviews: 4 }],
    sampling: { sampled: true, maxSampleInterval: 1.5 },
    generatedAt: "2026-10-09T09:30:00Z",
  };
}

test("Analytics is protected and appears in the shared admin navigation", () => {
  assert.match(app, /ProtectedAdminRoute[\s\S]*path="\/admin\/analytics"[\s\S]*AdminAnalytics/);
  assert.match(sidebar, /label: "Analytics", path: "\/admin\/analytics"/);
  assert.ok(sidebar.indexOf('label: "Stats"') < sidebar.indexOf('label: "Analytics"'));
});

test("renders a loading state while the first request is pending", async () => {
  let resolve;
  globalThis.analyticsPage = { load: () => new Promise((done) => { resolve = done; }) };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AdminAnalytics)); });
  try {
    assert.match(text(renderer.root), /Loading website analytics/);
  } finally {
    await act(async () => { resolve(report()); await Promise.resolve(); });
    await act(async () => renderer.unmount());
  }
});

test("renders a clear API error and retry control", async () => {
  globalThis.analyticsPage = { load: async () => { throw new Error("Analytics is temporarily rate limited. Please try again shortly."); } };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AdminAnalytics)); });
  try {
    assert.match(text(renderer.root), /temporarily rate limited/);
    assert.ok(renderer.root.findAllByType("button").some((button) => text(button) === "Try again"));
  } finally { await act(async () => renderer.unmount()); }
});

test("renders totals, trend, rankings, sampling and the analytics caveat", async () => {
  const calls = [];
  globalThis.analyticsPage = { load: async (...args) => { calls.push(args); return report(); } };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AdminAnalytics)); });
  try {
    const rendered = text(renderer.root);
    for (const expected of [
      "Visits", "Public pageviews", "Booking pageviews", "Visitor trend",
      "Most viewed public pages", "/services", "31 pageviews",
      "not unique visitors", "site-owner browsing", "block analytics",
      "figures are estimates",
    ]) assert.match(rendered, new RegExp(expected));
    assert.doesNotMatch(rendered, /Unique visitors/);
    assert.equal(calls[0][0], "24h");
    assert.deepEqual(calls[0][1], { refresh: false });

    const refresh = renderer.root.findAllByType("button").find((button) => text(button) === "Refresh");
    await act(async () => refresh.props.onClick());
    assert.deepEqual(calls[1][1], { refresh: true });
  } finally { await act(async () => renderer.unmount()); }
});

test("period controls are fixed and the layout remains responsive", () => {
  for (const label of ["24 hours", "7 days", "30 days", "90 days"]) assert.match(page, new RegExp(label));
  for (const className of ["sm:grid-cols-2 xl:grid-cols-3", "h-72 min-w-0 sm:h-80", "sm:flex-row", "overflow-x-auto"]) {
    assert.match(page, new RegExp(className));
  }
});
