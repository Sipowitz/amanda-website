import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { rolldown } from "rolldown";

const bundle = await rolldown({
  input: new URL("../src/services/adminService.js", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "admin-analytics-service-boundaries",
    resolveId(source) {
      if (source.endsWith("/lib/supabase")) return "\0supabase";
      if (source.endsWith("/utils/slotTime")) return "\0slot-time";
    },
    load(id) {
      if (id === "\0supabase") {
        return `export const supabase = {
          functions: { invoke: (...args) => globalThis.analyticsService.invoke(...args) }
        };`;
      }
      if (id === "\0slot-time") {
        return "export const isSlotPast = () => false; export const visibleAdminSlots = (value) => value;";
      }
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
const { describeAdminAnalyticsError, getAdminAnalytics } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);

function response() {
  return {
    period: "24h",
    window: { start: "2026-10-10T15:00:00.000Z", end: "2026-10-11T15:30:00.000Z", timezone: "UTC" },
    totals: { visits: 2, publicPageviews: 8, bookingPageviews: 3 },
    trend: [{ timestamp: "2026-10-11T15:00:00.000Z", visits: 2, pageviews: 8 }],
    pages: [{ path: "/services", pageviews: 8 }],
    sampling: { sampled: false, maxSampleInterval: 1 },
    generatedAt: "2026-10-11T15:30:00.000Z",
  };
}

test("analytics errors distinguish network, relay and safe HTTP categories", () => {
  const cases = [
    [{ name: "FunctionsFetchError" }, "ANALYTICS_NETWORK", /browser could not reach/],
    [{ name: "FunctionsRelayError" }, "ANALYTICS_RELAY", /Supabase could not reach/],
    [{ name: "FunctionsHttpError", context: { status: 401 } }, "ANALYTICS_AUTH", /session is no longer valid/],
    [{ name: "FunctionsHttpError", context: { status: 403 } }, "ANALYTICS_FORBIDDEN", /not authorized/],
    [{ name: "FunctionsHttpError", context: { status: 429 } }, "ANALYTICS_RATE_LIMITED", /rate limited/],
    [{ name: "FunctionsHttpError", context: { status: 502 } }, "ANALYTICS_UPSTREAM", /temporarily unavailable/],
    [{ name: "FunctionsHttpError", context: { status: 418 } }, "ANALYTICS_HTTP", /HTTP error \(418\)/],
    [{ name: "UnexpectedError" }, "ANALYTICS_UNKNOWN", /Unable to load/],
  ];
  for (const [input, code, message] of cases) {
    const error = describeAdminAnalyticsError(input);
    assert.equal(error.code, code);
    assert.match(error.message, message);
    assert.doesNotMatch(error.message, /token|apikey|credential/i);
  }
});

test("analytics request returns validated data and preserves the fixed request contract", async () => {
  let invocation;
  globalThis.analyticsService = {
    invoke: async (...args) => {
      invocation = args;
      return { data: response(), error: null };
    },
  };
  assert.deepEqual(await getAdminAnalytics("24h", { refresh: true }), response());
  assert.deepEqual(invocation, ["admin-analytics", { body: { period: "24h", refresh: true } }]);
});

test("analytics request rejects malformed success data distinctly", async () => {
  globalThis.analyticsService = {
    invoke: async () => ({ data: { period: "24h", totals: {} }, error: null }),
  };
  await assert.rejects(
    getAdminAnalytics("24h"),
    (error) => error.code === "ANALYTICS_INVALID_RESPONSE" && /invalid response/.test(error.message),
  );
});

test("analytics request classifies SDK errors without exposing their context", async () => {
  globalThis.analyticsService = {
    invoke: async () => ({
      data: null,
      error: {
        name: "FunctionsFetchError",
        context: { message: "secret transport detail" },
      },
    }),
  };
  await assert.rejects(
    getAdminAnalytics("24h"),
    (error) => error.code === "ANALYTICS_NETWORK" && !error.message.includes("secret transport detail"),
  );
});
