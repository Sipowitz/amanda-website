import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rolldown } from "rolldown";

const bundle = await rolldown({
  input: new URL("../src/services/bookingService.js", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "availability-query-db",
    resolveId(source) { if (source === "../lib/supabase") return "\0availability-db"; },
    load(id) { if (id === "\0availability-db") return "export const supabase = globalThis.availabilityQueryDb;"; },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
globalThis.availabilityQueryDb = {
  from() { return globalThis.availabilityQueryChain; },
};
const bookingService = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);

test("public availability selects the physical starts_at column and retains future rows", async () => {
  const calls = [];
  const future = { id: "future", starts_at: "2099-01-01T00:00:00Z", is_available: true };
  const elapsed = { id: "elapsed", starts_at: "2000-01-01T00:00:00Z", is_available: true };
  const chain = {
    select(value) { calls.push(["select", value]); return this; },
    eq(...args) { calls.push(["eq", ...args]); return this; },
    order(...args) { calls.push(["order", ...args]); return this; },
    then(resolve) { return Promise.resolve({ data: [future, elapsed], error: null }).then(resolve); },
  };
  globalThis.availabilityQueryChain = chain;

  assert.deepEqual(await bookingService.getAvailableSlots(), [future]);
  assert.deepEqual(calls[0], ["select", "*"]);
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "is_available" && call[2] === true));
  assert.ok(!calls.some((call) => String(call[1]).includes("slot_starts_at")));
});

test("booking-page availability failures use a safe customer message", async () => {
  const source = await readFile(new URL("../src/pages/Booking.jsx", import.meta.url), "utf8");
  assert.match(source, /Appointments could not be loaded\. Please try again shortly\./);
  assert.match(source, /Available appointments could not be refreshed\. Please try again shortly\./);
  assert.doesNotMatch(source, /setError\(loadError\.message/);
});
