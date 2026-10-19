import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { rolldown } from "rolldown";

const bundle = await rolldown({
  input: new URL("../supabase/functions/square-payment/index.ts", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "edge-boundaries",
    resolveId(source) { if (source.startsWith("jsr:")) return "\0runtime"; if (source.startsWith("npm:")) return "\0supabase"; },
    load(id) {
      if (id === "\0runtime") return "";
      if (id === "\0supabase") return "export const createClient = () => ({ rpc: (...args) => globalThis.edgeRpc(...args) });";
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
let handler;
const environment = {
  PUBLIC_SITE_URL: "https://example.test", SQUARE_ENVIRONMENT: "sandbox", SQUARE_API_VERSION: "2026-08-19",
};
globalThis.Deno = { serve: (callback) => { handler = callback; }, env: { get: (key) => environment[key] || "test-only" } };
await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
const body = { action: "cleanup", bookingId: "123e4567-e89b-42d3-a456-426614174000", attemptId: "123e4567-e89b-42d3-a456-426614174001", cleanupCapability: "c".repeat(64) };
const request = (payload, origin = "https://example.test") => handler(new Request("https://edge.test", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload),
}));

test("CORS allows both exact production origins and rejects unrelated origins", async () => {
  environment.PUBLIC_SITE_URL = "https://reachamandabeach.com";
  try {
    for (const origin of [
      "https://reachamandabeach.com",
      "https://www.reachamandabeach.com",
    ]) {
      const response = await handler(new Request("https://edge.test", {
        method: "OPTIONS", headers: { Origin: origin },
      }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    }
    for (const origin of [
      "http://reachamandabeach.com",
      "https://administration.reachamandabeach.com",
      "https://unrelated.test",
    ]) {
      const response = await handler(new Request("https://edge.test", {
        method: "OPTIONS", headers: { Origin: origin },
      }));
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    }
  } finally {
    environment.PUBLIC_SITE_URL = "https://example.test";
  }
  const nonProductionResponse = await handler(new Request("https://edge.test", {
    method: "OPTIONS", headers: { Origin: "https://www.reachamandabeach.com" },
  }));
  assert.equal(nonProductionResponse.status, 403);
  assert.equal(nonProductionResponse.headers.get("Access-Control-Allow-Origin"), null);
});

for (const allowed of [true, false]) {
  test(`cleanup endpoint returns only an acknowledgement (${allowed})`, async () => {
    globalThis.edgeRpc = async (name, args) => {
      assert.equal(name, "cleanup_timed_checkout");
      assert.deepEqual(Object.keys(args).sort(), ["p_attempt_id", "p_booking_id", "p_cleanup_capability"]);
      return { data: allowed, error: allowed ? null : { message: "private customer/payment detail" } };
    };
    const response = await request(body);
    assert.equal(response.status, allowed ? 200 : 409);
    assert.deepEqual(await response.json(), { abandoned: allowed });
  });
}

test("cleanup capability cannot authorize status, submit, initialize or lease", async () => {
  globalThis.edgeRpc = async () => { assert.fail("RPC must not be invoked"); };
  for (const action of ["status", "submit", "initialize", "lease"]) assert.equal((await request({ ...body, action })).status, 400);
  assert.equal((await request({ ...body, paymentAccessToken: "a".repeat(64) })).status, 400);
  assert.equal((await request(body, "https://unrelated.test")).status, 403);
});

test("cleanup endpoint exposes only the safe stale-marker acknowledgement", async () => {
  globalThis.edgeRpc = async () => ({ data: null, error: { code: "P0002", message: "Checkout cleanup authority is unavailable." } });
  const response = await request(body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stale: true });
});
