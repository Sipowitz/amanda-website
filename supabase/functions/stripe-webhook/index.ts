import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@^22";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function getBookingId(session: Stripe.Checkout.Session) {
  const referenceId = session.client_reference_id;
  return referenceId && session.metadata?.booking_id === referenceId
    ? referenceId
    : null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }
  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Stripe webhook secrets are not configured.");
    return new Response("Webhook is not configured", { status: 503 });
  }

  const signature = request.headers.get("Stripe-Signature");
  if (!signature) return new Response("Missing Stripe signature", { status: 400 });

  const stripe = new Stripe(stripeSecretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const rawBody = await request.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error);
    return new Response("Invalid Stripe signature", { status: 400 });
  }

  if (![
    "checkout.session.completed",
    "checkout.session.expired",
  ].includes(event.type)) {
    return Response.json({ received: true, handled: false });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const bookingId = getBookingId(session);
  if (!bookingId) {
    console.error("Checkout Session has inconsistent booking metadata", {
      eventId: event.id,
      sessionId: session.id,
    });
    return new Response("Checkout Session booking identity is invalid", {
      status: 400,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let data: unknown;
  let error: { message: string } | null;

  if (event.type === "checkout.session.expired") {
    ({ data, error } = await supabase.rpc("expire_stripe_checkout_payment", {
      p_event_id: event.id,
      p_booking_id: bookingId,
      p_session_id: session.id,
    }));
  } else {
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

    // Phase one creates card-only Sessions. Completion is accepted only after
    // Stripe says the payment is settled; the browser cannot cause this call.
    if (
      session.status !== "complete" ||
      session.payment_status !== "paid" ||
      !Number.isInteger(session.amount_total) ||
      session.amount_total === null ||
      session.amount_total <= 0 ||
      session.currency !== "usd"
    ) {
      console.error("Completed Checkout Session failed payment validation", {
        eventId: event.id,
        sessionId: session.id,
      });
      return new Response("Checkout Session is not a settled eligible payment", {
        status: 400,
      });
    }

    ({ data, error } = await supabase.rpc(
      "complete_stripe_checkout_payment",
      {
        p_event_id: event.id,
        p_booking_id: bookingId,
        p_session_id: session.id,
        p_payment_intent_id: paymentIntentId,
        p_amount_total: session.amount_total,
        p_currency: session.currency,
      },
    ));
  }

  if (error) {
    console.error("Stripe checkout lifecycle update failed", {
      eventId: event.id,
      sessionId: session.id,
      eventType: event.type,
      error: error.message,
    });
    return new Response("Unable to record Stripe checkout state", { status: 500 });
  }

  return Response.json({
    received: true,
    handled: true,
    eventType: event.type,
    changed: data,
  });
});
