import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react-test-renderer";
import { mount } from "../test-support/timedCheckoutHarness.js";
import { readCleanupMarkers, storeCleanupMarker, resolveOutstandingTimedCleanups, renewCheckoutCleanup } from "../src/services/timedCheckoutCleanup.js";

const marker = {
  bookingId: "123e4567-e89b-42d3-a456-426614174000",
  attemptId: "123e4567-e89b-42d3-a456-426614174001",
  cleanupCapability: "c".repeat(64), expiresAt: "2099-01-01T00:00:00Z",
};
const key = `amanda:timed-cleanup:${marker.bookingId}`;
const persistent = () => new Map([[key, JSON.stringify(marker)]]);

for (const outcome of ["active", "uncertain", "protected"]) {
  test(`empty session + persistent marker: ${outcome} cleanup blocks fresh booking`, async (t) => {
    const run = await mount(t, { emptySession: true, persistent: persistent(), transport: {
      cleanup: async () => { if (outcome === "uncertain") throw new Error("offline"); return { abandoned: false }; },
    } });
    assert.equal(run.storage.size, 0);
    assert.equal(run.button("Select date"), undefined);
    assert.ok(run.button("Check previous checkout"));
    assert.equal(run.persistent.size, 1);
    assert.equal(run.calls.includes("create"), false);
  });
}

test("new tab waits before grace, then acknowledgement clears marker before refreshing availability", async (t) => {
  let elapsed = false;
  const run = await mount(t, { emptySession: true, persistent: persistent(), transport: {
    cleanup: async () => ({ abandoned: elapsed }),
  } });
  assert.equal(run.button("Select date"), undefined);
  assert.equal(run.calls.includes("slots"), false);
  elapsed = true;
  await run.click("Check previous checkout");
  await run.waitFor(() => run.button("Select date"));
  assert.equal(run.persistent.size, 0);
  assert.ok(run.calls.includes("slots"));
});

test("actual reload retains session recovery, renews its capability and never runs cleanup", async (t) => {
  let renewed = 0;
  const run = await mount(t, { state: "reserved", persistent: persistent(), transport: {
    lease: async (_booking, token, attemptId, capability) => {
      assert.equal(token, "a".repeat(64));
      assert.equal(attemptId, marker.attemptId);
      assert.equal(capability, marker.cleanupCapability);
      renewed++;
      return { ...marker, renewAfterSeconds: 60 };
    },
    cleanup: async () => { throw new Error("Reload must not clean up"); },
  } });
  assert.equal(run.root.root.findByType("form").props.className, "block");
  assert.equal(run.calls.filter((call) => call === "initialize").length, 1);
  assert.equal(renewed, 1);
  await act(async () => { run.dispatch("focus"); });
  assert.equal(renewed, 2);
  assert.equal(run.persistent.get(key).includes("paymentAccessToken"), false);
});

test("missing marker uses fresh UI and no automatic cleanup", async (t) => {
  const run = await mount(t, { emptySession: true });
  assert.ok(run.button("Select date"));
  assert.equal(run.calls.includes("cleanup"), false);
});

test("Voice Memo does not read/clean or renew timed capabilities", async (t) => {
  const run = await mount(t, { mode: "untimed", state: "reserved", persistent: persistent(), transport: {
    lease: async () => { throw new Error("Untimed lease called"); },
    cleanup: async () => { throw new Error("Untimed cleanup called"); },
  } });
  assert.equal(run.root.root.findByType("form").props.className, "block");
  assert.equal(run.persistent.size, 1);
});

function storage() {
  const values = new Map();
  return { values, get length() { return values.size; }, key: (i) => [...values.keys()][i],
    getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
}

test("persistent storage allowlist excludes all recovery/customer/payment fields", () => {
  const local = storage();
  storeCleanupMarker(local, { ...marker, paymentAccessToken: "DO-NOT-STORE", buyerContact: { email: "private" }, sourceToken: "secret" });
  assert.deepEqual(readCleanupMarkers(local), [marker]);
});

test("lost acknowledgement retains capability for idempotent retry", async () => {
  const local = storage(); storeCleanupMarker(local, marker);
  assert.equal(await resolveOutstandingTimedCleanups({ storage: local, cleanup: async () => { throw new Error("lost reply"); } }), false);
  assert.equal(local.length, 1);
  assert.equal(await resolveOutstandingTimedCleanups({ storage: local, cleanup: async () => ({ abandoned: true }) }), true);
  assert.equal(local.length, 0);
});

test("delayed acknowledgement cannot erase a replacement capability", async () => {
  const local = storage(); storeCleanupMarker(local, marker);
  const replacement = { ...marker, attemptId: "123e4567-e89b-42d3-a456-426614174003" };
  assert.equal(await resolveOutstandingTimedCleanups({ storage: local, cleanup: async () => {
    storeCleanupMarker(local, replacement); return { abandoned: true };
  } }), false);
  assert.deepEqual(readCleanupMarkers(local), [replacement]);
});

test("stale renewal response after close cannot overwrite persistent marker", async () => {
  const local = storage(); storeCleanupMarker(local, marker);
  await renewCheckoutCleanup({ storage: local, ...marker, paymentAccessToken: "session-only",
    renew: async () => ({ ...marker, cleanupCapability: "d".repeat(64), renewAfterSeconds: 60 }), active: () => false });
  assert.deepEqual(readCleanupMarkers(local), [marker]);
});
