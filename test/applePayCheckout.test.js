import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react-test-renderer";
import { mount } from "../test-support/timedCheckoutHarness.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function squareSdk({ applePayResult = { status: "OK", token: "apple-token" }, applePayError, applePayInitError } = {}) {
  const requests = [];
  const events = [];
  const container = { replaceChildren() {} };
  const applePay = {
    async destroy() {},
    async tokenize() {
      events.push("apple-tokenize");
      if (applePayError) throw applePayError;
      return applePayResult;
    },
  };
  return {
    requests, events, applePay,
    nodeMock: (node) => node.props.id === "square-card-container" ? container : null,
    square: { payments: () => ({
      card: async () => ({ attach: async () => {}, destroy: async () => {}, tokenize: async () => ({ status: "OK", token: "card-token" }) }),
      paymentRequest: (request) => request,
      applePay: async (request) => {
        requests.push(request);
        if (applePayInitError) throw applePayInitError;
        return applePay;
      },
    }) },
  };
}

function appleButton(run) {
  return run.root.root.findAllByType("button").find((node) => node.props["aria-label"]?.includes("Apple Pay"));
}

test("Apple Pay initializes from the authoritative discounted attempt amount and currency", async (t) => {
  const sdk = squareSdk();
  const run = await mount(t, { state: "reserved", amountMinor: 6000, currency: "USD", ...sdk });
  assert.deepEqual(sdk.requests, [{
    countryCode: "US", currencyCode: "USD",
    total: { amount: "60.00", label: "Reading" },
  }]);
  assert.ok(appleButton(run), "Apple Pay is offered after successful initialization");
  assert.ok(run.root.root.findByProps({ id: "square-card-container" }), "Card entry remains available");
});

for (const [name, sdk] of [
  ["unsupported browsers", { square: { payments: () => ({ card: async () => ({ attach: async () => {}, destroy: async () => {}, tokenize: async () => ({ status: "OK", token: "card-token" }) }) }) } }],
  ["Apple Pay initialization failures", squareSdk({ applePayInitError: new Error("unavailable") })],
]) {
  test(`${name} preserve the Card checkout`, async (t) => {
    const run = await mount(t, { state: "reserved", ...sdk, nodeMock: sdk.nodeMock || (() => ({ replaceChildren() {} })) });
    assert.equal(appleButton(run), undefined);
    assert.ok(run.root.root.findByProps({ id: "square-card-container" }));
  });
}

test("Apple Pay sends its token once through the existing Square submission path", async (t) => {
  const sdk = squareSdk();
  const run = await mount(t, { state: "reserved", ...sdk });
  const payloads = [];
  globalThis.checkoutHarness.submit = async (payload) => {
    payloads.push(payload);
    run.setState("completed");
    return {};
  };
  await act(async () => { await appleButton(run).props.onClick({ preventDefault() {} }); });
  assert.deepEqual(payloads, [{
    bookingId: "123e4567-e89b-42d3-a456-426614174000",
    paymentAccessToken: "a".repeat(64),
    attemptId: "123e4567-e89b-42d3-a456-426614174001",
    sourceToken: "apple-token",
  }]);
  assert.deepEqual(sdk.events, ["apple-tokenize"]);
  assert.ok(JSON.stringify(run.root.toJSON()).includes("Payment confirmed"));
});

for (const status of ["CANCELLED", "FAILED"]) {
  test(`Apple Pay ${status.toLowerCase()} tokenization does not submit and keeps checkout available`, async (t) => {
    const sdk = squareSdk({ applePayResult: { status } });
    const run = await mount(t, { state: "reserved", ...sdk });
    await act(async () => { await appleButton(run).props.onClick({ preventDefault() {} }); });
    assert.equal(run.calls.includes("submit"), false);
    assert.ok(appleButton(run));
    assert.equal(run.root.root.findByType("form").props.className, "block");
  });
}

test("Apple Pay and Card cannot submit concurrently", async (t) => {
  const wait = deferred();
  const sdk = squareSdk({ applePayResult: wait.promise });
  const run = await mount(t, { state: "reserved", ...sdk });
  let appleSubmission;
  await act(async () => { appleSubmission = appleButton(run).props.onClick({ preventDefault() {} }); });
  await run.submit();
  assert.equal(run.calls.includes("submit"), false, "Card is blocked while Apple Pay is open");
  await act(async () => { wait.resolve({ status: "CANCELLED" }); await appleSubmission; });
  assert.equal(run.calls.includes("submit"), false);
});

test("duplicate Apple Pay clicks cannot create duplicate submissions", async (t) => {
  const wait = deferred();
  const sdk = squareSdk({ applePayResult: wait.promise });
  const run = await mount(t, { state: "reserved", ...sdk });
  const payloads = [];
  globalThis.checkoutHarness.submit = async (payload) => {
    payloads.push(payload);
    run.setState("completed");
    return {};
  };
  let first;
  await act(async () => { first = appleButton(run).props.onClick({ preventDefault() {} }); });
  await act(async () => { await appleButton(run).props.onClick({ preventDefault() {} }); });
  assert.deepEqual(sdk.events, ["apple-tokenize"]);
  await act(async () => { wait.resolve({ status: "OK", token: "apple-token" }); await first; });
  assert.equal(payloads.length, 1);
});

test("existing Card tokenization still submits when Apple Pay is available", async (t) => {
  const sdk = squareSdk();
  const run = await mount(t, { state: "reserved", ...sdk });
  let payload;
  globalThis.checkoutHarness.submit = async (value) => { payload = value; run.setState("completed"); return {}; };
  await run.submit();
  assert.equal(payload.sourceToken, "card-token");
  assert.equal(sdk.events.length, 0);
});
