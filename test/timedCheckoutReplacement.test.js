import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react-test-renderer";
import { mount } from "../test-support/timedCheckoutHarness.js";

const attemptId = "123e4567-e89b-42d3-a456-426614174001";

for (const state of ["failed", "expired", "cancelled"]) {
  test(`${state}: authoritative Choose new resets selection, summary and every real BookingForm field`, async (t) => {
    const run = await mount(t, { state, abandon: async () => ({ abandoned: true }) });
    // For cancelled state the automatic entry operation already acknowledged it.
    if (state !== "cancelled") await run.click("Choose a new appointment");
    assert.equal(run.storage.has(run.key), false);
    assert.ok(run.button("Select date"));
    assert.equal(run.root.root.findAllByType("input").length, 0);
    assert.equal(run.calls.includes("create"), false);
    await run.click("Select date");
    await run.click("Select slot");
    const fields = [...run.root.root.findAllByType("input"), ...run.root.root.findAllByType("textarea")];
    assert.deepEqual(Object.fromEntries(fields.map((node) => [node.props.name, node.props.value])), { name: "", email: "", phone: "", message: "" });
    assert.equal(JSON.stringify(run.root.toJSON()).includes("Old private topic"), false);
    const operation = run.calls.find((call) => Array.isArray(call));
    assert.equal(operation[3], attemptId);
  });
}

for (const state of ["reserved", "processing", "unknown", "completed"]) {
  test(`another tab wins retry and reaches ${state}: stale Choose new retains recovery and blocks replacement`, async (t) => {
    const run = await mount(t, { abandon: async ({ setState }) => {
      setState(state); throw new Error("409: attempt changed");
    } });
    await run.click("Choose a new appointment");
    assert.equal(run.storage.has(run.key), true);
    assert.equal(run.button("Select date"), undefined);
    assert.equal(run.calls.includes("create"), false);
    assert.equal(run.root.root.findAllByType("input").length, 0);
    assert.ok(run.calls.filter((call) => call === "status").length >= 3);
  });
}

test("network uncertainty during Choose new cannot clear credentials or reset the form", async (t) => {
  const run = await mount(t, { abandon: async () => {
    globalThis.checkoutHarness.status = async () => { throw new Error("offline"); };
    throw new Error("lost response");
  } });
  await run.click("Choose a new appointment");
  assert.ok(run.storage.has(run.key));
  assert.equal(run.button("Select date"), undefined);
  assert.equal(run.calls.includes("clear"), false);
  assert.ok(JSON.stringify(run.root.toJSON()).includes("Old private topic"), "failed termination retains recovered customer details");
});

for (const state of ["failed", "expired"]) {
  test(`${state}: Try payment again invokes initialization without abandonment or credential clearing`, async (t) => {
    const run = await mount(t, { state });
    await run.click("Try payment again");
    assert.ok(run.calls.includes("initialize"));
    assert.ok(run.storage.has(run.key));
    assert.equal(run.calls.some(Array.isArray), false);
  });
}

for (const navigation of ["reload", "navigate"]) {
  test(`reserved timed ${navigation} preserves refresh recovery or waits for automatic abandonment`, async (t) => {
    const run = await mount(t, { state: "reserved", navigation });
    assert.equal(run.storage.has(run.key), navigation === "reload");
    assert.equal(Boolean(run.button("Select date")), navigation !== "reload");
  });
  test(`Voice Memo ${navigation} retains its existing checkout and never abandons`, async (t) => {
    const run = await mount(t, { mode: "untimed", state: "reserved", navigation });
    assert.ok(run.storage.has(run.key));
    assert.ok(run.calls.includes("initialize"));
    assert.equal(run.calls.some(Array.isArray), false);
    assert.equal(run.button("Choose a new appointment"), undefined);
  });
}

test("already mounted stale checkout clears old fields after observing another tab's abandonment", async (t) => {
  const run = await mount(t, { state: "reserved" });
  assert.ok(JSON.stringify(run.root.toJSON()).includes("Old private topic"));
  run.setState("cancelled");
  await act(async () => { await run.root.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
  await run.click("Choose a new appointment");
  await run.click("Select date");
  await run.click("Select slot");
  assert.ok([...run.root.root.findAllByType("input"), ...run.root.root.findAllByType("textarea")].every((field) => field.props.value === ""));
  assert.equal(JSON.stringify(run.root.toJSON()).includes("Old private topic"), false);
});

test("pending termination keeps credentials and hides replacement until acknowledgement", async (t) => {
  let acknowledge;
  const run = await mount(t, { abandon: () => new Promise((resolve) => { acknowledge = resolve; }) });
  const staleRetry = run.button("Try payment again").props.onClick;
  let closing;
  await act(async () => { closing = run.button("Choose a new appointment").props.onClick(); });
  assert.ok(run.storage.has(run.key));
  assert.equal(run.button("Select date"), undefined);
  assert.equal(run.button("Try payment again"), undefined);
  await act(async () => {
    await staleRetry();
    await run.root.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
  assert.equal(run.calls.includes("initialize"), false);
  assert.equal(run.calls.includes("submit"), false);
  await act(async () => { acknowledge({ abandoned: true }); await closing; });
  assert.equal(run.storage.has(run.key), false);
  assert.ok(run.button("Select date"));
});

test("delayed retry status cannot restore customer details after authoritative closure", async (t) => {
  const run = await mount(t);
  const staleChoose = run.button("Choose a new appointment").props.onClick;
  const originalStatus = globalThis.checkoutHarness.status;
  let finishStatus;
  globalThis.checkoutHarness.status = () => new Promise((resolve) => { finishStatus = resolve; });
  let retry;
  await act(async () => { retry = run.button("Try payment again").props.onClick(); });
  await act(async () => { await staleChoose(); });
  await act(async () => { finishStatus(await originalStatus()); await retry; });
  assert.equal(run.calls.includes("initialize"), false);
  assert.ok(run.button("Select date"));
  await run.click("Select date");
  await run.click("Select slot");
  assert.ok([...run.root.root.findAllByType("input"), ...run.root.root.findAllByType("textarea")].every((field) => field.props.value === ""));
});
