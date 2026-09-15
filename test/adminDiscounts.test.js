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
const [app, sidebar, page, service, bookings, card] = await Promise.all([
  read("src/App.jsx"),
  read("src/components/admin/AdminSidebar.jsx"),
  read("src/pages/admin/AdminDiscounts.jsx"),
  read("src/services/adminService.js"),
  read("src/pages/admin/AdminBookings.jsx"),
  read("src/components/admin/bookings/BookingCard.jsx"),
]);

const bundle = await rolldown({
  input: new URL("../src/pages/admin/AdminDiscounts.jsx", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "admin-discounts-interaction-boundaries",
    resolveId(source) {
      if (source.endsWith("/adminService")) return "\0service";
      if (source.includes("/contexts/")) return "\0contexts";
      if (source === "react-router-dom") return "\0router";
      if (source === "react" || source.startsWith("react/")) {
        return { id: pathToFileURL(require.resolve(source)).href, external: true };
      }
    },
    load(id) {
      if (id === "\0service") return `
        export const getAdminDiscountCodes = async () => globalThis.discountAdminTest.discounts;
        export const getEligibleDiscountServices = async () => globalThis.discountAdminTest.services;
        export const createAdminDiscountCode = async () => {};
        export const updateAdminDiscountCode = async () => {};
        export const setAdminDiscountCodeEnabled = async () => {};
      `;
      if (id === "\0contexts") return `
        export const useAdminAuth = () => ({ logout: async () => {} });
        export const useToast = () => ({ success() {}, error() {} });
        export const useConfirm = () => async () => true;
      `;
      if (id === "\0router") return "export const useNavigate = () => () => {};";
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
const { default: AdminDiscounts } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);

test("discount management is a protected admin route with navigation", () => {
  assert.match(app, /path="\/admin\/discounts"[\s\S]*AdminDiscounts/);
  assert.match(sidebar, /label: "Discount codes", path: "\/admin\/discounts"/);
});

test("Create discount code is a native accessible button that opens the create form", async () => {
  globalThis.discountAdminTest = { discounts: [], services: [] };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AdminDiscounts)); });
  assert.equal(renderer.root.findAll((node) => node.props.name === "code").length, 0);

  const createButton = renderer.root.findAll((node) =>
    node.type === "button" && node.children.join("") === "Create discount code",
  )[0];
  assert.ok(createButton);
  assert.equal(createButton.props.type, "button");
  assert.equal(createButton.props.disabled, undefined);

  await act(async () => { createButton.props.onClick(); });
  assert.equal(renderer.root.findAll((node) => node.props.name === "code").length, 1);
  assert.equal(renderer.root.findAll((node) => node.props.name === "percentage-off").length, 1);
  assert.equal(renderer.root.findAll((node) => node.props.name === "expiry").length, 1);
  assert.equal(renderer.root.findAll((node) => node.props.name === "enabled").length, 1);
});

test("discount page uses protected RPC wrappers and never private tables", () => {
  for (const wrapper of [
    "getAdminDiscountCodes",
    "createAdminDiscountCode",
    "updateAdminDiscountCode",
    "setAdminDiscountCodeEnabled",
  ]) assert.match(page, new RegExp(wrapper));
  assert.doesNotMatch(page, /private\.(discount_codes|discount_code_services)/);
  assert.doesNotMatch(service, /from\("(?:discount_codes|discount_code_services)"\)/);
  for (const rpc of [
    "get_admin_discount_codes",
    "create_admin_discount_code",
    "update_admin_discount_code",
    "set_admin_discount_code_enabled",
  ]) assert.match(service, new RegExp(`rpc\\("${rpc}"`));
});

test("discount form supports immutable code, validation, scope, expiry and enablement", () => {
  assert.match(page, /readOnly=\{Boolean\(editing\)\}/);
  assert.match(page, /Percentage off/);
  assert.match(page, /Percentage off must be a whole number from 1 to 99/);
  assert.match(page, /Choose at least one eligible service/);
  assert.match(page, /form\.scope === "selected" \? form\.selectedServiceIds : \[\]/);
  assert.match(page, /All eligible services/);
  assert.match(page, /Selected services/);
  assert.match(page, /type="datetime-local"/);
  assert.match(page, /Enabled at checkout/);
  assert.match(page, /No expiry/);
  assert.match(page, /Uses/);
  assert.doesNotMatch(page, />Delete</);
});

test("eligible services are catalogue-driven rather than hardcoded", () => {
  assert.match(service, /rpc\("get_active_services"\)/);
  for (const condition of ["payment_required", "direct_payment", "price_amount", 'currency === "USD"']) {
    assert.match(service, new RegExp(condition));
  }
  assert.doesNotMatch(page, /Private Reading|Wheel of the Year|Voice Memo Reading/);
});

test("admin bookings merge the protected immutable projection and display discounts only when present", () => {
  assert.match(bookings, /getAdminBookingPricing\(\)/);
  assert.match(bookings, /pricingRows\.map\(\(pricing\) => \[pricing\.booking_id, pricing\]\)/);
  assert.match(bookings, /booking_pricing: pricingByBooking\.get\(booking\.id\) \|\| null/);
  assert.match(card, /const pricing = booking\.booking_pricing/);
  assert.match(card, /const hasDiscount = Number\(pricing\?\.discount_amount_minor \|\| 0\) > 0/);
  for (const label of ["Original price", "Discount amount", "Paid:"]) assert.match(card, new RegExp(label));
  assert.match(card, /pricing\.discount_code_snapshot/);
  assert.match(card, /pricing\.discount_percentage_snapshot/);
  assert.match(card, /pricing\.final_amount_minor/);
  assert.match(card, /: <p>Amount: \{formatCurrency\(booking\.amount_paid\)\}<\/p>/);
  assert.doesNotMatch(card, /service_price_amount_snapshot[\s\S]{0,120}Original price/);
});
