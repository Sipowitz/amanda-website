import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { rolldown } from "rolldown";

const bundle = await rolldown({
  input: new URL("../supabase/functions/admin-analytics/index.ts", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "admin-analytics-edge-boundaries",
    resolveId(source) {
      if (source.startsWith("jsr:")) return "\0runtime";
      if (source.startsWith("npm:")) return "\0supabase";
    },
    load(id) {
      if (id === "\0runtime") return "";
      if (id === "\0supabase") {
        return "export const createClient = (...args) => globalThis.analyticsEdge.createClient(...args);";
      }
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();

let handler;
const environment = {
  PUBLIC_SITE_URL: "https://example.test",
  SUPABASE_URL: "https://supabase.example.test",
  SUPABASE_ANON_KEY: "anon-test-key",
  CLOUDFLARE_API_TOKEN: "cloudflare-test-token",
  CLOUDFLARE_ACCOUNT_ID: "cloudflare-test-account",
};
globalThis.Deno = {
  serve: (callback) => { handler = callback; },
  env: { get: (key) => environment[key] },
};
await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);

function configureAuth({ authenticated = true, admin = true } = {}) {
  globalThis.analyticsEdge = {
    authCalls: 0,
    adminCalls: 0,
    createClient: (_url, _key, options) => ({
      auth: {
        getUser: async (token) => {
          globalThis.analyticsEdge.authCalls += 1;
          assert.equal(token, "user-jwt");
          assert.equal(options.global.headers.Authorization, "Bearer user-jwt");
          return authenticated
            ? { data: { user: { id: "admin-user" } }, error: null }
            : { data: { user: null }, error: { message: "invalid" } };
        },
      },
      rpc: async (name) => {
        globalThis.analyticsEdge.adminCalls += 1;
        assert.equal(name, "is_admin");
        return { data: admin, error: null };
      },
    }),
  };
}

function request(body, { authorization = "Bearer user-jwt", origin = "https://example.test" } = {}) {
  const headers = { Origin: origin, "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  return handler(new Request("https://edge.example.test/admin-analytics", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }));
}

function row(count, visits = 0, sampleInterval = 1, dimensions) {
  return {
    count,
    sum: { visits },
    avg: { sampleInterval },
    ...(dimensions ? { dimensions } : {}),
  };
}

function cloudflareBody(overrides = {}) {
  return {
    data: {
      viewer: {
        accounts: [{
          totals: [row(20, 4)],
          bookings: [row(5, 1)],
          trend: [],
          pages: [{ count: 12, avg: { sampleInterval: 1 }, dimensions: { requestPath: "/services" } }],
          ...overrides,
        }],
      },
    },
    errors: null,
  };
}

test("requires a valid JWT and an independently allowlisted administrator", async () => {
  configureAuth();
  assert.equal((await request({ period: "24h" }, { authorization: "" })).status, 401);
  assert.equal(globalThis.analyticsEdge.authCalls, 0);

  configureAuth({ authenticated: false });
  assert.equal((await request({ period: "24h" })).status, 401);
  assert.equal(globalThis.analyticsEdge.adminCalls, 0);

  configureAuth({ admin: false });
  assert.equal((await request({ period: "24h" })).status, 403);
  assert.equal(globalThis.analyticsEdge.adminCalls, 1);

  configureAuth();
  assert.equal((await request({ period: "24h" }, { origin: "https://unrelated.test" })).status, 403);
  assert.equal(globalThis.analyticsEdge.authCalls, 0);
});

test("accepts only fixed reporting periods and a boolean refresh flag", async () => {
  configureAuth();
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return Response.json(cloudflareBody()); };
  for (const payload of [
    { period: "1y" },
    { period: "24h", refresh: "yes" },
    { period: "7d", unexpected: true },
  ]) {
    assert.equal((await request(payload)).status, 400);
  }
  assert.equal(fetchCalls, 0);
});

test("handles Cloudflare HTTP, GraphQL and malformed response failures safely", async () => {
  configureAuth();
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  let response = await request({ period: "24h", refresh: true });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.deepEqual(await response.json(), { error: "Analytics is temporarily rate limited. Please try again shortly." });

  globalThis.fetch = async () => Response.json({ errors: [{ message: "upstream failed" }] });
  response = await request({ period: "7d", refresh: true });
  assert.equal(response.status, 502);

  globalThis.fetch = async () => Response.json(cloudflareBody({ totals: [{ count: "twenty" }] }));
  response = await request({ period: "30d", refresh: true });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Cloudflare analytics is temporarily unavailable." });
});

test("query fixes the production host, bot, private-route and booking-page filters", async () => {
  configureAuth();
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    const start = new Date(sent.variables.start);
    start.setUTCMinutes(0, 0, 0);
    return Response.json(cloudflareBody({
      totals: [row(55, 2, 1.25)],
      bookings: [row(6, 1, 2)],
      trend: [row(3, 1, 1.5, { datetimeHour: start.toISOString() })],
    }));
  };

  const response = await request({ period: "24h", refresh: true });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(sent.variables.host, "reachamandabeach.com");
  assert.match(sent.query, /requestHost:\s*\$host/);
  assert.match(sent.query, /bot:\s*0/);
  assert.equal((sent.query.match(/requestPath_neq:\s*"\/admin"/g) || []).length, 4);
  assert.equal((sent.query.match(/requestPath_notlike:\s*"\/admin\/%"/g) || []).length, 4);
  assert.doesNotMatch(sent.query, /requestPath_notlike:\s*"\/admin%"/);
  assert.equal((sent.query.match(/requestPath_neq:\s*"\/reset-password"/g) || []).length, 4);
  assert.match(sent.query, /requestPath_like:\s*"\/services\/%\/book"/);
  assert.match(sent.query, /requestPath_like:\s*"\/services\/%\/request"/);
  assert.deepEqual(report.totals, { visits: 2, publicPageviews: 55, bookingPageviews: 6 });
  assert.deepEqual(report.sampling, { sampled: true, maxSampleInterval: 2 });
});

test("uses exact UTC bucket counts without adding a boundary bucket", async () => {
  configureAuth();
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    const timestamp = new Date(sent.variables.start);
    const hourly = sent.query.includes("datetimeHour");
    return Response.json(cloudflareBody({
      trend: [row(3, 1, 1, hourly
        ? { datetimeHour: timestamp.toISOString() }
        : { date: timestamp.toISOString().slice(0, 10) })],
    }));
  };
  for (const [period, expectedCount, unitMs] of [
    ["24h", 24, 60 * 60 * 1000],
    ["7d", 7, 24 * 60 * 60 * 1000],
    ["30d", 30, 24 * 60 * 60 * 1000],
    ["90d", 90, 24 * 60 * 60 * 1000],
  ]) {
    const response = await request({ period, refresh: true });
    const report = await response.json();
    assert.equal(report.trend.length, expectedCount);
    assert.equal(report.trend[0].pageviews, 3);
    assert.ok(report.trend.slice(1).every((bucket) => bucket.pageviews === 0 && bucket.visits === 0));
    assert.equal(report.window.start, sent.variables.start);
    assert.equal(report.window.end, sent.variables.end);
    assert.equal(new Date(report.window.start).getTime() % unitMs, 0);
    assert.equal(
      new Date(report.trend.at(-1).timestamp).getTime() - new Date(report.trend[0].timestamp).getTime(),
      (expectedCount - 1) * unitMs,
    );
  }
});
