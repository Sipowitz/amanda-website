import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { act } from "react-test-renderer";
import { mount } from "../test-support/timedCheckoutHarness.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("customer discount quote service uses only the Stage 4 browser contracts", async () => {
  const source = await read("../src/services/bookingService.js");
  assert.match(source, /export async function quoteDirectPaymentDiscount/);
  assert.match(source, /rpc\("quote_direct_payment_discount", \{[\s\S]*p_service_id: serviceId,[\s\S]*p_discount_code: discountCode/);
  assert.match(source, /Array\.isArray\(data\) \? data\[0\] : data/);
  assert.match(source, /export async function createDiscountedPendingPaymentBooking/);
  const create = source.slice(
    source.indexOf("export async function createDiscountedPendingPaymentBooking"),
    source.indexOf("async function invokePaymentAction"),
  );
  for (const field of ["p_service_id", "p_slot_id", "p_customer_name", "p_customer_email", "p_customer_phone", "p_customer_message", "p_discount_code", "p_review_guard"]) {
    assert.match(create, new RegExp(field));
  }
  assert.doesNotMatch(create, /p_(?:amount|currency|percentage|discount_amount|final_amount|original_amount)/);
  assert.match(create, /data\?\.created === false && data\.code === "PRICE_REVIEW_REQUIRED"/);
});

test("booking applies only current quotes and keeps normal creation unchanged without one", async () => {
  const source = await read("../src/pages/Booking.jsx");
  assert.match(source, /const discountRequestRef = useRef\(0\)/);
  assert.match(source, /const request = \+\+discountRequestRef\.current/);
  assert.match(source, /if \(request !== discountRequestRef\.current\) return/);
  assert.match(source, /appliedDiscountQuote\?\.accepted[\s\S]*createDiscountedPendingPaymentBooking[\s\S]*:[\s\S]*createPendingPaymentBooking/);
  assert.match(source, /discountCode: appliedDiscountQuote\.canonical_code/);
  assert.match(source, /reviewGuard: appliedDiscountQuote\.review_guard/);
  assert.doesNotMatch(source, /appliedDiscountQuote\.(?:original_amount_minor|discount_amount_minor|final_amount_minor|currency|discount_percentage)[\s\S]{0,100}createDiscountedPendingPaymentBooking/);
  assert.match(source, /creation\.created === false && creation\.code === "PRICE_REVIEW_REQUIRED"/);
  assert.match(source, /The discount changed\. Please apply your code again before continuing\./);
  assert.match(source, /invalidateDiscountQuote\(\{ clearCode: true \}\)/);
  assert.match(source, /showDiscountCode=\{usesDirectPayment\}/);
});

test("discount form presents safe quote states and invalidates an edited or removed code", async () => {
  const source = await read("../src/components/booking/BookingForm.jsx");
  assert.match(source, /Discount code <span[^>]*>\(optional\)<\/span>/);
  assert.match(source, /onChange=\{\(event\) => onDiscountCodeChange\?\.\(event\.target\.value\)\}/);
  assert.match(source, /onKeyDown=\{handleDiscountKeyDown\}/);
  assert.match(source, /type="button"[\s\S]*onClick=\{onApplyDiscount\}/);
  assert.match(source, /discountState === "applying" \? "Applying…" : "Apply"/);
  assert.match(source, /\{discountMessage && <p role="status"/);
  assert.match(source, /Original price/);
  assert.match(source, /Discount \(\{appliedDiscountQuote\.canonical_code\}\)/);
  assert.match(source, /Final amount due/);
  assert.match(source, /onClick=\{onRemoveDiscount\}/);
});

test("discount review data never enters Square or payment recovery state", async () => {
  const recovery = await read("../src/services/paymentRecovery.js");
  const square = await read("../src/components/booking/SquareCardPayment.jsx");
  const edge = await read("../supabase/functions/square-payment/index.ts");
  assert.doesNotMatch(recovery, /discount|reviewGuard|quote|amountMinor|currency/i);
  assert.doesNotMatch(square, /reviewGuard|quoteDirectPaymentDiscount|createDiscountedPendingPaymentBooking/);
  assert.doesNotMatch(edge, /discountCode|reviewGuard|quoteDirectPaymentDiscount/);
});

async function changeField(root, name, value) {
  const field = root.root.findAll((node) => node.props.name === name)[0];
  await act(async () => { field.props.onChange({ target: { value } }); });
}

const quote = {
  accepted: true,
  canonical_code: "SAVE25",
  original_amount_minor: 8500,
  discount_percentage: 25,
  discount_amount_minor: 2125,
  final_amount_minor: 6375,
  currency: "USD",
  review_guard: "a".repeat(64),
};

test("Voice Memo applies a quote and sends only code and opaque guard to reviewed creation", async (t) => {
  let reviewedPayload;
  const run = await mount(t, {
    mode: "untimed",
    emptySession: true,
    transport: {
      quote: async () => quote,
      createDiscounted: async (payload) => {
        reviewedPayload = payload;
        return { created: true, bookingId: "123e4567-e89b-42d3-a456-426614174000", paymentAccessToken: "a".repeat(64) };
      },
      create: async () => { throw new Error("normal creation must not run"); },
    },
  });
  await changeField(run.root, "discount-code", "save25");
  await run.click("Apply");
  assert.ok(JSON.stringify(run.root.toJSON()).includes("Final amount due"));
  await run.submit();
  assert.equal(reviewedPayload.discountCode, "SAVE25");
  assert.equal(reviewedPayload.reviewGuard, "a".repeat(64));
  for (const field of ["originalAmount", "finalAmount", "amount", "currency", "percentage", "discountAmount"]) {
    assert.equal(field in reviewedPayload, false);
  }
});

test("Private Reading and Wheel timed flows apply a quote before reviewed creation", async (t) => {
  for (const serviceSlug of ["private-readings", "wheel-of-the-year"]) {
    let reviewed = 0;
    const run = await mount(t, {
      mode: "timed",
      serviceSlug,
      emptySession: true,
      transport: {
        quote: async () => quote,
        createDiscounted: async () => {
          reviewed += 1;
          return { created: true, bookingId: "123e4567-e89b-42d3-a456-426614174000", paymentAccessToken: "a".repeat(64) };
        },
      },
    });
    await run.click("Select date");
    await run.click("Select slot");
    await changeField(run.root, "discount-code", "SAVE25");
    await run.click("Apply");
    await run.submit();
    assert.equal(reviewed, 1, `${serviceSlug} uses reviewed creation`);
  }
});

test("rejection, editing/removal, stale quotes and stale reviewed creation remain pre-create", async (t) => {
  let resolveOld;
  const oldQuote = new Promise((resolve) => { resolveOld = resolve; });
  let calls = 0;
  const run = await mount(t, {
    mode: "untimed",
    emptySession: true,
    transport: {
      quote: async () => {
        calls += 1;
        return calls === 1 ? oldQuote : { ...quote, canonical_code: "NEW25", review_guard: "b".repeat(64) };
      },
      createDiscounted: async () => ({ created: false, code: "PRICE_REVIEW_REQUIRED" }),
    },
  });
  await changeField(run.root, "discount-code", "old25");
  let oldApply;
  act(() => { oldApply = run.button("Apply").props.onClick(); });
  await changeField(run.root, "discount-code", "new25");
  await run.click("Apply");
  await act(async () => { resolveOld(quote); await oldApply; });
  assert.equal(run.root.root.findAll((node) => node.props.name === "discount-code")[0].props.value, "NEW25");
  await changeField(run.root, "discount-code", "edited");
  assert.equal(JSON.stringify(run.root.toJSON()).includes("Final amount due"), false);
  await run.click("Apply");
  await run.click("Remove");
  assert.equal(JSON.stringify(run.root.toJSON()).includes("Final amount due"), false);
  await changeField(run.root, "discount-code", "new25");
  await run.click("Apply");
  await run.submit();
  const tree = JSON.stringify(run.root.toJSON());
  assert.ok(tree.includes("Please apply your code again"));
  assert.equal(tree.includes("Secure checkout"), false);
});

test("unapplied or rejected codes retain normal direct-payment creation", async (t) => {
  let normal = 0;
  const run = await mount(t, {
    mode: "untimed",
    emptySession: true,
    transport: {
      quote: async () => ({ accepted: false, error_code: "DISCOUNT_UNAVAILABLE" }),
      create: async () => {
        normal += 1;
        return { bookingId: "123e4567-e89b-42d3-a456-426614174000", paymentAccessToken: "a".repeat(64) };
      },
      createDiscounted: async () => { throw new Error("reviewed creation must not run"); },
    },
  });
  await changeField(run.root, "discount-code", "NOPE");
  await run.click("Apply");
  assert.ok(JSON.stringify(run.root.toJSON()).includes("This code is unavailable."));
  await run.submit();
  assert.equal(normal, 1);
});
