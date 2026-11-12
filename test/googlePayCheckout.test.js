import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react-test-renderer";

import { mount } from "../test-support/timedCheckoutHarness.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function googleSdk({ result = { status: "OK", token: "google-token" }, initError } = {}) {
  const requests = [];
  const events = [];
  const cardContainer = { replaceChildren() {} };
  const googleContainer = { replaceChildren() {}, onclick: null };
  const googlePay = {
    async attach(target, options) {
      events.push(["attach", target, options]);
    },
    async destroy() {},
    async tokenize() {
      events.push("tokenize");
      return result;
    },
  };
  return {
    requests, events, googleContainer,
    nodeMock: (node) => {
      if (node.props.id === "square-card-container") return cardContainer;
      if (node.props.id === "google-pay-button") return googleContainer;
      return null;
    },
    square: { payments: () => ({
      card: async () => ({ attach: async () => {}, destroy: async () => {}, tokenize: async () => ({ status: "OK", token: "card-token" }) }),
      paymentRequest: (request) => { requests.push(request); return request; },
      googlePay: async () => {
        if (initError) throw initError;
        return googlePay;
      },
    }) },
  };
}

test("Google Pay uses the server-reserved discounted USD amount and existing submission path", async (t) => {
  const sdk = googleSdk();
  const run = await mount(t, { state: "reserved", amountMinor: 6000, currency: "USD", ...sdk });
  assert.deepEqual(sdk.requests, [{
    countryCode: "US", currencyCode: "USD",
    total: { amount: "60.00", label: "Reading" },
  }]);
  assert.ok(run.root.root.findByProps({ id: "google-pay-button" }).props["aria-label"]?.includes("Google Pay"));

  const payloads = [];
  globalThis.checkoutHarness.submit = async (payload) => {
    payloads.push(payload);
    run.setState("completed");
    return {};
  };
  await act(async () => { await sdk.googleContainer.onclick({ preventDefault() {} }); });
  assert.deepEqual(payloads, [{
    bookingId: "123e4567-e89b-42d3-a456-426614174000",
    paymentAccessToken: "a".repeat(64),
    attemptId: "123e4567-e89b-42d3-a456-426614174001",
    sourceToken: "google-token",
  }]);
  assert.deepEqual(sdk.events.at(-1), "tokenize");
});

test("unsupported Google Pay leaves card checkout ready without exposing a wallet button", async (t) => {
  const sdk = googleSdk({ initError: new Error("unsupported") });
  const run = await mount(t, { state: "reserved", ...sdk });
  const button = run.root.root.findByProps({ id: "google-pay-button" });
  assert.equal(button.props["aria-label"], undefined);
  assert.ok(run.root.root.findByProps({ id: "square-card-container" }));
});

test("a cancelled Google Pay sheet does not submit or abandon the checkout", async (t) => {
  const sdk = googleSdk({ result: { status: "CANCELLED" } });
  const run = await mount(t, { state: "reserved", ...sdk });
  await act(async () => { await sdk.googleContainer.onclick({ preventDefault() {} }); });
  assert.equal(run.calls.includes("submit"), false);
  assert.ok(run.root.root.findByType("form"));
  assert.equal(run.root.root.findByProps({ id: "google-pay-button" }).props["aria-label"].includes("Google Pay"), true);
});

test("failed Google Pay tokenization does not submit and retains card fallback", async (t) => {
  const sdk = googleSdk({ result: { status: "FAILED", errors: [{ message: "Wallet unavailable" }] } });
  const run = await mount(t, { state: "reserved", ...sdk });
  await act(async () => { await sdk.googleContainer.onclick({ preventDefault() {} }); });
  assert.equal(run.calls.includes("submit"), false);
  assert.ok(run.root.root.findByProps({ id: "square-card-container" }));
  assert.ok(JSON.stringify(run.root.toJSON()).includes("Wallet unavailable"));
});

test("repeated Google Pay clicks create only one submission", async (t) => {
  const pending = deferred();
  const sdk = googleSdk({ result: pending.promise });
  const run = await mount(t, { state: "reserved", ...sdk });
  const payloads = [];
  globalThis.checkoutHarness.submit = async (payload) => {
    payloads.push(payload);
    run.setState("completed");
    return {};
  };
  let first;
  await act(async () => { first = sdk.googleContainer.onclick({ preventDefault() {} }); });
  await act(async () => { await sdk.googleContainer.onclick({ preventDefault() {} }); });
  assert.equal(sdk.events.filter((event) => event === "tokenize").length, 1);
  await act(async () => { pending.resolve({ status: "OK", token: "google-token" }); await first; });
  assert.equal(payloads.length, 1);
});
