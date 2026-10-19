import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { rolldown } from "rolldown";

const bundle = await rolldown({
  input: new URL("../supabase/functions/process-booking-emails/index.ts", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "email-processor-edge-boundaries",
    resolveId(source) {
      if (source.startsWith("jsr:")) return "\0runtime";
      if (source.startsWith("npm:")) return "\0supabase";
    },
    load(id) {
      if (id === "\0runtime") return "";
      if (id === "\0supabase") {
        return "export const createClient = (...args) => globalThis.emailProcessorEdge.createClient(...args);";
      }
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();

let handler;
const environment = {
  SUPABASE_URL: "https://supabase.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  RESEND_API_KEY: "resend-test-key",
  BOOKING_FROM_EMAIL: "bookings@example.test",
  BOOKING_REPLY_TO_EMAIL: "reply@example.test",
  SITE_URL: "https://example.test",
  EMAIL_PROCESSOR_SECRET: "correct-email-processor-secret",
};
globalThis.Deno = {
  serve: (callback) => { handler = callback; },
  env: { get: (key) => environment[key] },
};
globalThis.emailProcessorEdge = {
  client: {},
  createClient: () => ({
    schema: (...args) => globalThis.emailProcessorEdge.client.schema(...args),
  }),
};
await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);

function configureClient() {
  let queueReads = 0;
  globalThis.emailProcessorEdge.client = {
    schema: () => ({
      rpc: async () => {
        queueReads += 1;
        return { data: [], error: null };
      },
    }),
  };
  return () => queueReads;
}

function request(secret) {
  const headers = {};
  if (secret !== undefined) headers["X-Email-Processor-Secret"] = secret;
  return handler(new Request("https://edge.example.test/process-booking-emails", {
    method: "POST", headers,
  }));
}

test("rejects missing and incorrect processor secrets before queue access", async () => {
  const queueReads = configureClient();

  for (const secret of [undefined, "incorrect-email-processor-secret"]) {
    const response = await request(secret);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }

  assert.equal(queueReads(), 0);
});

test("fails closed when the processor secret is not configured", async () => {
  const queueReads = configureClient();
  const configuredSecret = environment.EMAIL_PROCESSOR_SECRET;
  delete environment.EMAIL_PROCESSOR_SECRET;
  try {
    const response = await request(configuredSecret);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Email processor authentication is not configured",
    });
    assert.equal(queueReads(), 0);
  } finally {
    environment.EMAIL_PROCESSOR_SECRET = configuredSecret;
  }
});

test("accepts the scheduler secret and retains empty-queue processing", async () => {
  const queueReads = configureClient();

  const response = await request(environment.EMAIL_PROCESSOR_SECRET);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "No booking emails are waiting",
    messagesRead: 0,
    sent: 0,
    retrying: 0,
    permanentlyFailed: 0,
  });
  assert.equal(queueReads(), 1);
});
