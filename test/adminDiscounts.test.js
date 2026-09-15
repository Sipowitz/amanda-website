import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [app, sidebar, page, service, bookings, card] = await Promise.all([
  read("src/App.jsx"),
  read("src/components/admin/AdminSidebar.jsx"),
  read("src/pages/admin/AdminDiscounts.jsx"),
  read("src/services/adminService.js"),
  read("src/pages/admin/AdminBookings.jsx"),
  read("src/components/admin/bookings/BookingCard.jsx"),
]);

test("discount management is a protected admin route with navigation", () => {
  assert.match(app, /path="\/admin\/discounts"[\s\S]*AdminDiscounts/);
  assert.match(sidebar, /label: "Discount codes", path: "\/admin\/discounts"/);
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
