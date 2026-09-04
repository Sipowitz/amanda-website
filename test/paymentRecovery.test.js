import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPaymentIdentity,
  readPaymentIdentity,
  storePaymentIdentity,
} from "../src/services/paymentRecovery.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const identity = {
  bookingId: "123e4567-e89b-42d3-a456-426614174000",
  paymentAccessToken: "a".repeat(64),
  serviceId: "voice-service-id",
};

test("payment recovery survives a remount in the same browser tab", () => {
  const storage = memoryStorage();
  storePaymentIdentity(storage, "voice-memo-reading", identity);

  assert.deepEqual(
    readPaymentIdentity(
      storage,
      "voice-memo-reading",
      "voice-service-id",
    ),
    identity,
  );
});

test("invalid or cross-service recovery state is rejected and removed", () => {
  const storage = memoryStorage();
  storePaymentIdentity(storage, "voice-memo-reading", identity);

  assert.equal(
    readPaymentIdentity(storage, "voice-memo-reading", "different-service"),
    null,
  );
  assert.equal(
    readPaymentIdentity(storage, "voice-memo-reading", "voice-service-id"),
    null,
  );
});

test("verified payment clears recovery identity", () => {
  const storage = memoryStorage();
  storePaymentIdentity(storage, "voice-memo-reading", identity);
  clearPaymentIdentity(storage, "voice-memo-reading");

  assert.equal(
    readPaymentIdentity(storage, "voice-memo-reading", "voice-service-id"),
    null,
  );
});
