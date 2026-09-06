import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import React from "react";
import { act, create } from "react-test-renderer";
import { rolldown } from "rolldown";

const require = createRequire(import.meta.url);
// Compile the actual page, payment component and controlled BookingForm in
// memory. Only transport, browser SDK, navigation and decorative selectors are
// substituted. React runs the real effects, callbacks and component remounts.
const bundle = await rolldown({
  input: new URL("../src/pages/Booking.jsx", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "checkout-test-boundaries",
    transform(code, id) {
      if (id.endsWith("SquareCardPayment.jsx")) return code.replaceAll("import.meta.env", JSON.stringify({
        VITE_SQUARE_APPLICATION_ID: "sandbox-app", VITE_SQUARE_LOCATION_ID: "location", VITE_SQUARE_ENVIRONMENT: "sandbox",
      }));
    },
    resolveId(source) {
      if (source.endsWith("services/bookingService")) return "\0transport";
      if (source === "react-router-dom") return "\0router";
      if (source === "framer-motion") return "\0motion";
      if (source.endsWith("/DateSelector")) return "\0dates";
      if (source.endsWith("/TimeSlotPicker")) return "\0slots";
      if (source === "react" || source.startsWith("react/") || source === "date-fns") {
        return { id: pathToFileURL(require.resolve(source)).href, external: true };
      }
    },
    load(id) {
      if (id === "\0transport") return `
        const call = (name) => (...args) => globalThis.checkoutHarness[name](...args);
        export const getServiceBySlug = call('service'), getAvailableSlots = call('slots'),
          getDirectPaymentStatus = call('status'), renewTimedCheckoutLease = call('lease'), cleanupTimedCheckout = call('cleanup'), abandonTimedPaymentBooking = call('abandon'),
          initializeDirectPayment = call('initialize'), submitSquarePayment = call('submit'),
          createBooking = call('create'), createPendingPaymentBooking = call('create');`;
      if (id === "\0router") return `import React from 'react'; export const useParams = () => ({serviceSlug: globalThis.checkoutHarness.slug}); export const Link = (p) => React.createElement('a', p);`;
      if (id === "\0motion") return `export const motion = { div: 'div', form: 'form' };`;
      if (id === "\0dates") return `import React from 'react'; export default function Dates(p) { return React.createElement('button', {onClick: () => p.onSelectDate('2026-12-20')}, 'Select date'); }`;
      if (id === "\0slots") return `import React from 'react'; export default function Slots(p) { return React.createElement('button', {onClick: () => p.onSelectSlot(p.slots[0])}, 'Select slot'); }`;
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
const compiledPage = output[0].code;
const bookingId = "123e4567-e89b-42d3-a456-426614174000";
const attemptId = "123e4567-e89b-42d3-a456-426614174001";
const retryId = "123e4567-e89b-42d3-a456-426614174003";
let moduleId = 0;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export async function mount(t, { mode = "timed", state = "failed", navigation = "reload", abandon, transport = {}, square, nodeMock, strict = true, emptySession = false, persistent = new Map() } = {}) {
  const slug = mode === "timed" ? "private-readings" : "voice-memo-reading";
  const identity = { bookingId, paymentAccessToken: "a".repeat(64), serviceId: "service" };
  const key = `amanda:direct-payment:${slug}`;
  const storage = new Map(emptySession ? [] : [[key, JSON.stringify(identity)]]);
  const calls = [];
  const service = { id: "service", slug, booking_mode: mode, payment_flow: "direct_payment", name: "Reading", price_amount: 8500, currency: "USD" };
  const context = {
    serviceId: "service", bookingMode: mode, serviceName: "Reading", amountMinor: 8500, currency: "USD",
    buyerContact: { givenName: "Old customer", email: "old@example.test" },
    bookingDetails: { name: "Old customer", email: "old@example.test", phone: "123", message: "Old private topic" },
  };
  let authoritative = state;
  let currentAttempt = attemptId;
  const status = () => ({
    ...context, attemptId: currentAttempt, attemptStatus: authoritative,
    bookingStatus: authoritative === "completed" ? "confirmed" : ["failed", "expired"].includes(authoritative) ? "payment_expired" : authoritative === "cancelled" ? "cancelled" : "pending_payment",
    paymentStatus: authoritative === "completed" ? "paid" : "unpaid",
    paid: authoritative === "completed", canRestart: ["failed", "expired"].includes(authoritative),
  });
  const listeners = new Map();
  globalThis.window = {
    addEventListener: (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
    removeEventListener: (event, callback) => listeners.get(event)?.delete(callback),
    localStorage: {
      get length() { return persistent.size; }, key: (i) => [...persistent.keys()][i],
      getItem: (k) => persistent.get(k) ?? null,
      setItem: (k, value) => persistent.set(k, value), removeItem: (k) => persistent.delete(k),
    },
    performance: { getEntriesByType: () => [{ type: navigation }] },
    location: { pathname: `/services/${slug}/${mode === "timed" ? "book" : "request"}` },
    sessionStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, value) => storage.set(k, value),
      removeItem: (k) => { calls.push("clear"); storage.delete(k); },
    },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Square: square || { payments: () => ({ card: async () => ({ attach: async () => {}, destroy: async () => {}, tokenize: async () => ({ status: "OK", token: "source" }) }) }) },
  };
  globalThis.checkoutHarness = {
    slug, service: async () => service,
    lease: async () => ({ cleanupCapability: "c".repeat(64), expiresAt: "2099-01-01T00:00:00Z", renewAfterSeconds: 60 }),
    cleanup: async () => { calls.push("cleanup"); return { abandoned: false }; },
    slots: async () => { calls.push("slots"); return [{ id: "slot", slot_date: "2026-12-20", slot_time: "12:00" }]; },
    status: async () => { calls.push("status"); return status(); },
    abandon: async (...args) => {
      calls.push(["abandon", ...args]);
      assert.ok(storage.has(key), "credentials survive until the server acknowledges termination");
      if (abandon) return abandon({ args, calls, storage, key, setState: (value) => { authoritative = value; currentAttempt = retryId; } });
      authoritative = "cancelled";
      return { abandoned: true };
    },
    initialize: async () => { calls.push("initialize"); if (authoritative !== "reserved") currentAttempt = retryId; authoritative = "reserved"; return { ...context, attemptId: currentAttempt, attemptStatus: "reserved" }; },
    submit: async () => { calls.push("submit"); return {}; },
    create: async () => { calls.push("create"); throw new Error("Replacement creation must require a new form submission"); },
  };
  Object.assign(globalThis.checkoutHarness, transport);
  const { default: Booking } = await import(`data:text/javascript;base64,${Buffer.from(compiledPage + `\n//# sourceURL=checkout-test-${moduleId}.mjs`).toString("base64")}#${moduleId++}`);
  let root;
  await act(async () => { root = create(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(Booking, { expectedMode: mode })), { createNodeMock: nodeMock }); });
  await act(async () => { await delay(20); });
  t.after(async () => { await act(async () => root.unmount()); });
  const button = (label) => root.root.findAllByType("button").find((node) => node.children.join("") === label);
  const click = async (label) => { assert.ok(button(label), `Missing ${label}`); await act(async () => { await button(label).props.onClick(); }); };
  const waitFor = async (predicate) => {
    for (let i = 0; !predicate(); i++) {
      assert.ok(i < 500, "Checkout did not reach the expected state");
      await act(async () => { await delay(20); });
    }
  };
  const submit = () => act(async () => root.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  return { root, storage, persistent, calls, key, button, click, waitFor, submit, dispatch: (event) => { for (const cb of listeners.get(event) || []) cb(); }, setState: (value) => { authoritative = value; } };
}
