import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";
import React from "react";
import { act, create } from "react-test-renderer";
import { rolldown } from "rolldown";

import { MAX_SERVICE_PRICE_AMOUNT, parseServicePriceAmount } from "../src/utils/servicePrice.js";

const require = createRequire(import.meta.url);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function bundleComponent(input, plugin) {
  const bundle = await rolldown({
    input: new URL(input, import.meta.url).pathname,
    platform: "node",
    plugins: [{
      name: "admin-services-test-boundaries",
      resolveId(source) {
        const mocked = plugin.resolveId?.(source);
        if (mocked) return mocked;
        if (source === "react" || source.startsWith("react/")) return { id: pathToFileURL(require.resolve(source)).href, external: true };
      },
      load: plugin.load,
    }],
  });
  const { output } = await bundle.generate({ format: "esm" });
  await bundle.close();
  return import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
}

const { default: AdminServices } = await bundleComponent("../src/pages/admin/AdminServices.jsx", {
  resolveId(source) {
    if (source.endsWith("/adminService")) return "\0admin-service";
    if (source.includes("/contexts/")) return "\0contexts";
  },
  load(id) {
    if (id === "\0admin-service") return `
      export const getAdminServices = (...args) => globalThis.adminServicesTest.get(...args);
      export const createAdminService = (...args) => globalThis.adminServicesTest.create(...args);
      export const updateAdminService = (...args) => globalThis.adminServicesTest.update(...args);
      export const setAdminServiceActive = (...args) => globalThis.adminServicesTest.active(...args);
      export const moveAdminService = (...args) => globalThis.adminServicesTest.move(...args);
    `;
    if (id === "\0contexts") return `
      export const useAdminAuth = () => ({ logout: async () => {} });
      export const useToast = () => globalThis.adminServicesTest.toast;
      export const useConfirm = () => globalThis.adminServicesTest.confirm;
    `;
  },
});

const { default: Services } = await bundleComponent("../src/pages/Services.jsx", {
  resolveId(source) {
    if (source.endsWith("/bookingService")) return "\0booking-service";
    if (source === "react-router-dom") return "\0router";
    if (source === "framer-motion") return "\0motion";
  },
  load(id) {
    if (id === "\0booking-service") return "export const getActiveServices = () => globalThis.publicServicesTest.get();";
    if (id === "\0router") return `
      import React from "react";
      export const Link = ({to, children, ...props}) => React.createElement("a", {href: to, ...props}, children);
      export const Outlet = () => React.createElement("div", {"data-outlet": true});
      export const useMatch = () => false;
    `;
    if (id === "\0motion") return "export const motion = new Proxy({}, { get: (_target, tag) => tag });";
  },
});

const service = (id, overrides = {}) => ({
  id, slug: `service-${id}`, name: `Service ${id}`, public_summary: `Summary ${id}`,
  booking_mode: "timed", duration_minutes: 60, price_amount: 8500, currency: "USD",
  payment_required: true, payment_flow: "direct_payment", is_active: true, display_order: 10,
  ...overrides,
});

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return (node.children || []).map(text).join("");
}

const button = (root, label) => root.findAllByType("button").find((item) => text(item) === label);
const field = (root, name) => root.findAll((item) => item.props.name === name)[0];

async function mountAdmin(services, options = {}) {
  const calls = { create: [], update: [], active: [], move: [], confirm: [], errors: [], success: [] };
  globalThis.adminServicesTest = {
    get: options.get || (async () => services),
    create: async (...args) => { calls.create.push(args); },
    update: async (...args) => { calls.update.push(args); },
    active: async (...args) => { calls.active.push(args); },
    move: async (...args) => { calls.move.push(args); },
    confirm: async (...args) => { calls.confirm.push(args); return options.confirm ?? true; },
    toast: { error: (message) => calls.errors.push(message), success: (message) => calls.success.push(message) },
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AdminServices)); });
  return { renderer, root: renderer.root, calls };
}

async function mountPublic(get) {
  globalThis.publicServicesTest = { get };
  let renderer;
  await act(async () => { renderer = create(React.createElement(Services)); });
  return { renderer, root: renderer.root };
}

test("Admin Services route, sidebar and protected wrappers remain connected", async () => {
  const [app, sidebar, page, wrappers] = await Promise.all([
    read("src/App.jsx"), read("src/components/admin/AdminSidebar.jsx"),
    read("src/pages/admin/AdminServices.jsx"), read("src/services/adminService.js"),
  ]);
  assert.match(app, /path="\/admin\/services"[\s\S]*AdminServices/);
  assert.match(sidebar, /label: "Services", path: "\/admin\/services"/);
  assert.doesNotMatch(page, /\.from\("services"\)/);
  for (const rpc of ["get_admin_services", "create_admin_service", "update_admin_service", "set_admin_service_active", "move_admin_service"]) {
    assert.match(wrappers, new RegExp(`rpc\\("${rpc}"`));
  }
});

test("price parser converts decimal dollars exactly and enforces the server bound", () => {
  assert.equal(parseServicePriceAmount("20"), 2000);
  assert.equal(parseServicePriceAmount("85"), 8500);
  assert.equal(parseServicePriceAmount("0.20"), 20);
  for (const invalid of ["0", "-1", "1.001", "NaN", "Infinity", "12 dollars", "", "9007199254740991", String(MAX_SERVICE_PRICE_AMOUNT / 100 + 0.01)]) {
    assert.equal(parseServicePriceAmount(invalid), null, invalid);
  }
  assert.equal(parseServicePriceAmount(String(MAX_SERVICE_PRICE_AMOUNT / 100)), MAX_SERVICE_PRICE_AMOUNT);
});

test("Admin Services renders active and inactive catalogue entries", async () => {
  const { renderer, root } = await mountAdmin([service("a"), service("b", { is_active: false, booking_mode: "untimed", duration_minutes: null })]);
  assert.match(text(root), /Service a.*Active/);
  assert.match(text(root), /Service b.*Inactive/);
  assert.match(text(root), /Timed · 60 minutes/);
  assert.match(text(root), /Untimed/);
  await act(async () => renderer.unmount());
});

test("create form fixes timed duration and sends only intended editable values", async () => {
  const { renderer, root, calls } = await mountAdmin([]);
  await act(async () => button(root, "Add service").props.onClick());
  assert.match(text(root), /Duration: 60 minutes \(fixed\)/);
  assert.match(text(root), /New services start inactive/);
  assert.equal(field(root, "duration"), undefined);
  await act(async () => {
    field(root, "name").props.onChange({ target: { value: "Arbitrary Timed" } });
    field(root, "public-summary").props.onChange({ target: { value: "A new public service." } });
    field(root, "price").props.onChange({ target: { value: "20.00" } });
  });
  const form = root.findByType("form");
  await act(async () => form.props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls.create, [[{ name: "Arbitrary Timed", publicSummary: "A new public service.", bookingMode: "timed", priceAmount: 2000 }]]);
  assert.equal(Object.hasOwn(calls.create[0][0], "currency"), false);
  assert.equal(Object.hasOwn(calls.create[0][0], "duration"), false);
  assert.equal(Object.hasOwn(calls.create[0][0], "isActive"), false);
  await act(async () => renderer.unmount());
});

test("untimed create has no arbitrary duration control and uses untimed mode", async () => {
  const { renderer, root, calls } = await mountAdmin([]);
  await act(async () => button(root, "Add service").props.onClick());
  const untimed = root.findAll((item) => item.props.name === "booking-mode" && item.props.value === "untimed")[0];
  await act(async () => untimed.props.onChange());
  assert.doesNotMatch(text(root), /Duration: 60 minutes/);
  assert.equal(field(root, "duration"), undefined);
  await act(async () => {
    field(root, "name").props.onChange({ target: { value: "Arbitrary Untimed" } });
    field(root, "public-summary").props.onChange({ target: { value: "An untimed service." } });
    field(root, "price").props.onChange({ target: { value: "0.20" } });
  });
  await act(async () => root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(calls.create[0][0].bookingMode, "untimed");
  assert.equal(calls.create[0][0].priceAmount, 20);
  await act(async () => renderer.unmount());
});

test("edit exposes only name, summary and price while showing immutable identity", async () => {
  const record = service("edit", { slug: "stable-slug" });
  const { renderer, root, calls } = await mountAdmin([record]);
  await act(async () => button(root, "Edit").props.onClick());
  assert.match(text(root), /Slug: stable-slug/);
  assert.equal(root.findAll((item) => item.props.name === "booking-mode").length, 0);
  assert.equal(field(root, "slug"), undefined);
  assert.equal(field(root, "duration"), undefined);
  assert.deepEqual([field(root, "name").props.value, field(root, "public-summary").props.value, field(root, "price").props.value], [record.name, record.public_summary, "85"]);
  await act(async () => field(root, "name").props.onChange({ target: { value: "Edited" } }));
  await act(async () => root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls.update[0][0], { serviceId: "edit", name: "Edited", publicSummary: record.public_summary, priceAmount: 8500 });
  assert.equal(button(root, "Delete"), undefined);
  await act(async () => renderer.unmount());
});

test("activation, deactivation and ordering use confirmation/protected actions", async () => {
  const records = [service("active"), service("inactive", { is_active: false })];
  const { renderer, root, calls } = await mountAdmin(records);
  await act(async () => button(root, "Deactivate").props.onClick());
  await act(async () => button(root, "Activate").props.onClick());
  assert.equal(calls.confirm.length, 2);
  assert.deepEqual(calls.active, [["active", false], ["inactive", true]]);
  const moveDown = root.findAllByType("button").find((item) => text(item) === "Move down" && !item.props.disabled);
  await act(async () => moveDown.props.onClick());
  assert.deepEqual(calls.move, [["active", "down"]]);
  assert.equal(button(root, "Delete"), undefined);
  await act(async () => renderer.unmount());
});

test("Admin Services has observable loading and load-error behavior", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const loading = await mountAdmin([], { get: () => pending });
  assert.match(text(loading.root), /Loading services/);
  await act(async () => resolve([]));
  await act(async () => loading.renderer.unmount());

  const failed = await mountAdmin([], { get: async () => { throw new Error("catalogue offline"); } });
  assert.deepEqual(failed.calls.errors, ["catalogue offline"]);
  await act(async () => failed.renderer.unmount());
});

test("public Services renders ordered DB cards, generic routes and collision-safe static cards", async () => {
  const active = [
    service("z", { slug: "parties-gatherings", name: "Bookable Collision", public_summary: "Timed DB summary", price_amount: 2000 }),
    service("u", { slug: "fresh-untimed", name: "Fresh Untimed", public_summary: "Untimed DB summary", booking_mode: "untimed", duration_minutes: null, price_amount: 20, display_order: 20 }),
  ];
  const { renderer, root } = await mountPublic(async () => active);
  const pageText = text(root);
  assert.ok(pageText.indexOf("Bookable Collision") < pageText.indexOf("Fresh Untimed"));
  assert.match(pageText, /Timed DB summary/);
  assert.match(pageText, /Untimed DB summary/);
  assert.match(pageText, /\$20\.00.*60 minutes/);
  assert.match(pageText, /\$0\.20/);
  const links = root.findAllByType("a");
  assert.equal(links.find((link) => text(link).includes("Book now")).props.href, "/services/parties-gatherings/book");
  assert.equal(links.find((link) => text(link).includes("Request now")).props.href, "/services/fresh-untimed/request");
  assert.match(pageText, /Bookable Collision.*Parties & Gatherings/);
  assert.match(pageText, /Corporate & Public Events/);
  assert.equal(links.length, 2, "static cards remain non-bookable");
  assert.doesNotMatch(pageText, /Inactive Sentinel/);
  await act(async () => renderer.unmount());
});

test("public Services handles empty catalogue, loading and RPC failure safely", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const loading = await mountPublic(() => pending);
  assert.match(text(loading.root), /Loading services/);
  await act(async () => resolve([]));
  assert.match(text(loading.root), /Parties & Gatherings/);
  assert.equal(loading.root.findAllByType("a").length, 0);
  await act(async () => loading.renderer.unmount());

  const failed = await mountPublic(async () => { throw new Error("offline"); });
  assert.match(text(failed.root), /Services could not be loaded/);
  assert.match(text(failed.root), /Corporate & Public Events/);
  await act(async () => failed.renderer.unmount());
});
