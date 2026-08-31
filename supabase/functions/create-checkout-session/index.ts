import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@^22";

const jsonHeaders = { "Content-Type": "application/json" };
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accessTokenPattern = /^[0-9a-f]{64}$/i;

function corsHeaders(request: Request) {
  const configuredOrigin = Deno.env.get("PUBLIC_SITE_URL");
  const requestOrigin = request.headers.get("Origin");
  const allowedOrigin = configuredOrigin && requestOrigin === configuredOrigin
    ? configuredOrigin
    : configuredOrigin || requestOrigin || "*";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...corsHeaders(request) },
  });
}

function isValidRequest(payload: unknown): payload is {
  action: "initialize" | "status";
  bookingId: string;
  paymentAccessToken: string;
} {
  if (!payload || typeof payload !== "object") return false;

  const value = payload as Record<string, unknown>;
  const keys = Object.keys(value).sort();

  return keys.join(",") === "action,bookingId,paymentAccessToken" &&
    (value.action === "initialize" || value.action === "status") &&
    typeof value.bookingId === "string" &&
    uuidPattern.test(value.bookingId) &&
    typeof value.paymentAccessToken === "string" &&
    accessTokenPattern.test(value.paymentAccessToken);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return response(request, { error: "Method not allowed" }, 405);
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
    return response(request, { error: "Embedded payment is not configured." }, 503);
  }

  try {
    const payload: unknown = await request.json();
    if (!isValidRequest(payload)) {
      return response(request, { error: "Valid payment access is required." }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (payload.action === "status") {
      const { data, error } = await supabase.rpc("get_stripe_payment_status", {
        p_booking_id: payload.bookingId,
        p_payment_access_token: payload.paymentAccessToken,
      });
      if (error) {
        console.error("Unable to load Stripe payment status", error.message);
        return response(request, { error: "Payment status is unavailable." }, 403);
      }
      return response(request, data);
    }

    const { data: attempt, error: attemptError } = await supabase.rpc(
      "begin_stripe_checkout_attempt",
      {
        p_booking_id: payload.bookingId,
        p_payment_access_token: payload.paymentAccessToken,
      },
    );

    if (attemptError) {
      console.error("Unable to reserve Checkout attempt", attemptError.message);
      return response(request, { error: "This payment cannot be started." }, 409);
    }

    if (attempt?.action === "paid") {
      return response(request, {
        paid: true,
        bookingStatus: attempt.booking_status,
        paymentStatus: attempt.payment_status,
        serviceName: attempt.service_name,
        amountTotal: attempt.amount_total,
        currency: attempt.currency,
      });
    }

    const stripe = new Stripe(stripeSecretKey, {
      httpClient: Stripe.createFetchHttpClient(),
    });

    let session: Stripe.Checkout.Session;

    if (attempt.action === "reuse") {
      session = await stripe.checkout.sessions.retrieve(attempt.session_id);

      if (
        session.status !== "open" ||
        !session.client_secret ||
        getSessionBookingId(session) !== attempt.booking_id ||
        session.amount_total !== attempt.amount_total ||
        session.currency !== attempt.currency
      ) {
        return response(request, {
          error: "The previous payment session is no longer available. Please check its status and try again.",
          checkoutUnavailable: true,
        }, 409);
      }
    } else {
      // Stay safely above Stripe's 30-minute minimum despite request latency,
      // integer truncation and small clock differences.
      const expiresAt = Math.floor(Date.now() / 1000) + (35 * 60);

      session = await stripe.checkout.sessions.create({
        mode: "payment",
        ui_mode: "embedded",
        redirect_on_completion: "never",
        expires_at: expiresAt,
        // Phase one intentionally permits immediately settled card payments
        // only. Async payment-method webhook states are out of scope.
        payment_method_types: ["card"],
        client_reference_id: attempt.booking_id,
        customer_email: attempt.customer_email,
        metadata: {
          booking_id: attempt.booking_id,
          service_id: attempt.service_id,
          checkout_attempt_id: attempt.attempt_id,
        },
        payment_intent_data: {
          metadata: {
            booking_id: attempt.booking_id,
            checkout_attempt_id: attempt.attempt_id,
          },
        },
        line_items: [{
          quantity: 1,
          price_data: {
            currency: attempt.currency,
            unit_amount: attempt.amount_total,
            product_data: { name: attempt.service_name },
          },
        }],
      }, {
        // A retry after Stripe accepted the request but before database
        // registration receives the exact same Session.
        idempotencyKey: `embedded-checkout-${attempt.attempt_id}`,
      });

      if (!session.client_secret || !session.expires_at) {
        throw new Error("Stripe returned an incomplete Checkout Session.");
      }

      if (
        getSessionBookingId(session) !== attempt.booking_id ||
        session.amount_total !== attempt.amount_total ||
        session.currency !== attempt.currency
      ) {
        throw new Error("Stripe returned inconsistent Checkout Session details.");
      }

      const { error: registerError } = await supabase.rpc(
        "register_stripe_checkout_session",
        {
          p_attempt_id: attempt.attempt_id,
          p_booking_id: attempt.booking_id,
          p_session_id: session.id,
          p_amount_total: session.amount_total,
          p_currency: session.currency,
          p_expires_at: new Date(session.expires_at * 1000).toISOString(),
        },
      );

      if (registerError) {
        // Do not expire here. The reserved attempt plus Stripe idempotency key
        // lets the next request recover and register this same Session.
        console.error("Unable to register Checkout Session", registerError.message);
        throw new Error("Payment initialization was interrupted. Please retry.");
      }
    }

    return response(request, {
      clientSecret: session.client_secret,
      sessionId: session.id,
      amountTotal: attempt.amount_total,
      currency: attempt.currency,
      serviceName: attempt.service_name,
      expiresAt: session.expires_at,
      reused: attempt.action === "reuse",
    });
  } catch (error) {
    console.error("Checkout request failed", error);
    return response(request, {
      error: error instanceof Error
        ? error.message
        : "Unable to process the payment request.",
    }, 500);
  }
});

function getSessionBookingId(session: Stripe.Checkout.Session) {
  const bookingId = session.client_reference_id;
  return bookingId && session.metadata?.booking_id === bookingId
    ? bookingId
    : null;
}
