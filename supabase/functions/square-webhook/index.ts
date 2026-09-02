import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function verifySquareSignature(
  signature: string,
  rawBody: string,
  notificationUrl: string,
  signatureKey: string,
) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(notificationUrl + rawBody),
  ));
  const expected = btoa(String.fromCharCode(...digest));
  const supplied = signature.trim();
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const signatureKey = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY");
  const notificationUrl = Deno.env.get("SQUARE_WEBHOOK_NOTIFICATION_URL");
  const locationId = Deno.env.get("SQUARE_LOCATION_ID");
  const expectedEnvironment = Deno.env.get("SQUARE_ENVIRONMENT");
  const expectedMerchantId = Deno.env.get("SQUARE_MERCHANT_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!signatureKey || !notificationUrl || !locationId || !expectedMerchantId ||
    !supabaseUrl || !serviceRoleKey ||
    !["sandbox", "production"].includes(expectedEnvironment || "")) {
    return new Response("Webhook is not configured", { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature") || "";
  if (!signature || !await verifySquareSignature(
    signature, rawBody, notificationUrl, signatureKey
  )) return new Response("Invalid Square signature", { status: 403 });

  let event: Record<string, unknown>;
  try { event = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!event || typeof event.event_id !== "string" ||
    !["payment.created", "payment.updated"].includes(String(event.type))) {
    return Response.json({ received: true, handled: false });
  }
  const environmentHeader = request.headers.get("square-environment")?.toLowerCase();
  if (environmentHeader !== expectedEnvironment || event.merchant_id !== expectedMerchantId) {
    return new Response("Square account identity is invalid", { status: 403 });
  }

  const data = event.data as Record<string, unknown> | undefined;
  const object = data?.object as Record<string, unknown> | undefined;
  const payment = object?.payment as Record<string, unknown> | undefined;
  const money = payment?.amount_money as Record<string, unknown> | undefined;
  const attemptId = payment?.reference_id;
  if (!payment || typeof payment.id !== "string" ||
    typeof attemptId !== "string" || !uuidPattern.test(attemptId) ||
    payment.location_id !== locationId || !Number.isInteger(money?.amount) ||
    typeof money?.currency !== "string") {
    return Response.json({ received: true, handled: false });
  }

  // Resolve only a known attempt. Unrelated seller payments are acknowledged
  // without any booking mutation.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: bookingId, error: lookupError } = await supabase.rpc(
    "get_payment_attempt_booking", { p_attempt_id: attemptId, p_provider: "square" },
  );
  if (lookupError || !bookingId) return Response.json({ received: true, handled: false });

  if (!["COMPLETED", "FAILED", "CANCELED"].includes(String(payment.status))) {
    const { data: recorded, error: recordError } = await supabase.rpc(
      "record_nonterminal_payment_webhook_event",
      {
        p_provider: "square", p_event_id: event.event_id,
        p_event_type: event.type, p_provider_payment_id: payment.id,
      },
    );
    if (recordError) return new Response("Unable to record event", { status: 500 });
    return Response.json({ received: true, handled: false, recorded });
  }
  const { data: changed, error } = await supabase.rpc("record_provider_payment_result", {
    p_provider: "square", p_event_id: event.event_id, p_event_type: event.type,
    p_booking_id: bookingId, p_attempt_id: attemptId,
    p_provider_payment_id: payment.id,
    p_provider_location_id: payment.location_id,
    p_provider_status: payment.status,
    p_amount_minor: money.amount, p_currency: money.currency,
  });
  if (error) {
    console.error("Square webhook payment validation failed", {
      eventId: event.event_id, paymentId: payment.id, error: error.message,
    });
    return new Response("Unable to record payment", { status: 400 });
  }
  return Response.json({ received: true, handled: true, changed });
});
