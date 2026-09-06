import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { setTimeout as delay } from "node:timers/promises";
import { act, create } from "react-test-renderer";
import { mount } from "../test-support/timedCheckoutHarness.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function sdk() {
  const events = [], cards = [], children = [];
  const container = { replaceChildren() { events.push("clear"); children.length = 0; } };
  return {
    events, cards, children,
    nodeMock: (node) => node.props.id === "square-card-container" ? container : null,
    square: { payments: () => ({ card: async () => {
      assert.equal(cards.filter((card) => !card.destroyed).length, 0, "only one live SDK card");
      const id = cards.length;
      const card = {
        destroyed: false,
        async attach(target) { assert.equal(target, container); events.push(`attach:${id}`); children.push(id); },
        async destroy() { events.push(`destroy:${id}`); card.destroyed = true; },
        async tokenize() { assert.equal(card.destroyed, false); events.push(`tokenize:${id}`); return { status: "OK", token: `token:${id}` }; },
      };
      cards.push(card);
      return card;
    } }) },
  };
}

for (const strict of [false, true]) {
  test(`decline/retry binds one replacement card to the reserved new attempt (StrictMode=${strict})`, async (t) => {
    const square = sdk();
    const run = await mount(t, { state: "reserved", strict, ...square });
    const payloads = [];
    const oldSubmit = run.root.root.findByType("form").props.onSubmit;
    globalThis.checkoutHarness.submit = async (payload) => {
      const status = await globalThis.checkoutHarness.status();
      assert.equal(status.attemptStatus, "reserved");
      assert.equal(payload.attemptId, status.attemptId);
      payloads.push(payload);
      run.setState(payloads.length === 1 ? "failed" : "completed");
      return payloads.length === 1 ? { declined: true } : {};
    };
    await run.submit();
    await act(async () => oldSubmit({ preventDefault() {} }));
    assert.equal(payloads.length, 1, "failed old attempt cannot resubmit");
    const retry = run.button("Try payment again").props.onClick;
    await act(async () => { await Promise.all([retry(), retry(), retry()]); });
    assert.equal(square.cards.length, 2);
    assert.deepEqual(square.children, [1], "old iframe DOM removed");
    assert.ok(square.events.indexOf("destroy:0") < square.events.indexOf("attach:1"));
    await act(async () => oldSubmit({ preventDefault() {} }));
    assert.equal(payloads.length, 1, "old render callback cannot use the retry card");
    await run.submit();
    assert.equal(payloads.length, 2);
    assert.notEqual(payloads[0].attemptId, payloads[1].attemptId);
    assert.equal(payloads[1].sourceToken, "token:1");
    assert.ok(JSON.stringify(run.root.toJSON()).includes("Payment confirmed"));
  });
}

test("delayed verification cannot overwrite the retry attempt/card", async (t) => {
  const square = sdk();
  const run = await mount(t, { state: "processing", ...square });
  const status = globalThis.checkoutHarness.status;
  const delayed = deferred();
  globalThis.checkoutHarness.status = () => delayed.promise;
  let oldCheck;
  await act(async () => { oldCheck = run.button("Check payment").props.onClick(); });
  run.setState("failed");
  const failed = await status();
  globalThis.checkoutHarness.status = status;
  await run.click("Check payment");
  await run.click("Try payment again");
  await act(async () => { delayed.resolve(failed); await oldCheck; });
  let submitted;
  globalThis.checkoutHarness.submit = async (payload) => { submitted = payload; run.setState("completed"); return {}; };
  await run.submit();
  assert.equal(submitted.attemptId, "123e4567-e89b-42d3-a456-426614174003");
  assert.equal(square.cards.length, 1);
});

test("delayed initialization after closure cannot publish an attempt or create a card", async (t) => {
  const square = sdk();
  const run = await mount(t, { ...square });
  const choose = run.button("Choose a new appointment").props.onClick;
  const initialize = globalThis.checkoutHarness.initialize;
  const pending = deferred();
  globalThis.checkoutHarness.initialize = () => pending.promise;
  let retry;
  await act(async () => { retry = run.button("Try payment again").props.onClick(); });
  await act(async () => { await choose(); });
  await act(async () => { pending.resolve(await initialize()); await retry; });
  assert.equal(square.cards.length, 0);
  assert.ok(run.button("Select date"));
});

for (const state of ["failed", "processing", "unknown", "cancelled"]) {
  test(`attempt changed to ${state} during tokenization never submits`, async (t) => {
    const square = sdk();
    const run = await mount(t, { state: "reserved", ...square });
    const pending = deferred();
    square.cards[0].tokenize = () => pending.promise;
    let submission;
    await act(async () => { submission = run.root.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    run.setState(state);
    await act(async () => { pending.resolve({ status: "OK", token: "unused" }); await submission; });
    assert.equal(run.calls.includes("submit"), false);
  });
}


test("effect re-entry during SDK attach destroys obsolete card before publishing the replacement", async (t) => {
  const square = sdk();
  const run = await mount(t, { ...square });
  const component = run.root.root.find((node) => typeof node.type === "function" && node.type.name === "SquareCardPayment");
  const Component = component.type;
  const props = component.props;
  await act(async () => run.root.unmount());
  run.setState("reserved");
  const pending = deferred();
  const factory = square.square.payments().card;
  let first = true;
  square.square.payments = () => ({ card: async () => {
    const card = await factory();
    if (first) {
      first = false;
      const attach = card.attach;
      card.attach = async (target) => { await attach(target); await pending.promise; };
    }
    return card;
  } });
  let root;
  await act(async () => { root = create(React.createElement(Component, props), { createNodeMock: square.nodeMock }); });
  t.after(async () => { await act(async () => root.unmount()); });
  await act(async () => { await delay(20); });
  assert.equal(square.cards.length, 1);
  await act(async () => { root.update(React.createElement(Component, { ...props, onBookingRecovered() {} })); });
  await act(async () => { await delay(20); });
  assert.equal(square.cards.length, 1, "replacement waits for obsolete attach");
  await act(async () => { pending.resolve(); await delay(20); });
  assert.equal(square.cards.length, 2);
  assert.deepEqual(square.children, [1]);
  assert.ok(square.events.indexOf("destroy:0") < square.events.indexOf("attach:1"));
  assert.equal(root.root.findByType("form").props.className, "block");
});


for (const attemptStatus of ["failed", "processing", "unknown"]) {
  test(`initialize returning ${attemptStatus} cannot mount or submit a card`, async (t) => {
    const square = sdk();
    const run = await mount(t, { ...square });
    const initialize = globalThis.checkoutHarness.initialize;
    globalThis.checkoutHarness.initialize = async () => ({ ...await initialize(), attemptStatus });
    await run.click("Try payment again");
    await run.submit();
    assert.equal(square.cards.length, 0);
    assert.equal(run.calls.includes("submit"), false);
    assert.ok(JSON.stringify(run.root.toJSON()).includes("Verifying your payment"));
  });
}

test("obsolete initialize response cannot replace a newer reserved attempt", async (t) => {
  const square = sdk();
  const run = await mount(t, { ...square });
  const component = run.root.root.find((node) => typeof node.type === "function" && node.type.name === "SquareCardPayment");
  const Component = component.type, props = component.props;
  await act(async () => run.root.unmount());
  run.setState("reserved");
  const initialize = globalThis.checkoutHarness.initialize;
  const pending = deferred();
  let first = true;
  globalThis.checkoutHarness.initialize = () => {
    if (first) { first = false; return pending.promise; }
    return initialize();
  };
  let root;
  await act(async () => { root = create(React.createElement(Component, props), { createNodeMock: square.nodeMock }); });
  t.after(async () => { await act(async () => root.unmount()); });
  await act(async () => { await delay(20); });
  await act(async () => { root.update(React.createElement(Component, { ...props, onBookingRecovered() {} })); });
  await act(async () => { await delay(20); });
  assert.equal(square.cards.length, 1);
  await act(async () => { pending.resolve({ ...await initialize(), attemptId: "obsolete-attempt" }); await delay(20); });
  let submitted;
  globalThis.checkoutHarness.submit = async (payload) => { submitted = payload; run.setState("completed"); return {}; };
  await act(async () => { await root.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
  assert.equal(submitted.attemptId, "123e4567-e89b-42d3-a456-426614174001");
  assert.equal(square.cards.length, 1);
});
