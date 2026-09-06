import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";

const SQUARE_API_VERSION = "2026-08-19";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recoveryTokenPattern = /^[0-9a-f]{64}$/i;
const sourceTokenPattern = /^[\x21-\x7e]{1,2048}$/;

type BasePayload = {
  action: "initialize" | "status";
  bookingId: string;
  paymentAccessToken: string;
};
type AbandonPayload = {
  action: "abandon";
  bookingId: string;
  paymentAccessToken: string;
  attemptId: string;
};
type LeasePayload = {
  action: "lease";
  bookingId: string;
  attemptId: string;
  paymentAccessToken: string;
  cleanupCapability: string | null;
};
type CleanupPayload = {
  action: "cleanup";
  bookingId: string;
  attemptId: string;
  cleanupCapability: string;
};
type SubmitPayload = {
  action: "submit";
  bookingId: string;
  paymentAccessToken: string;
  attemptId: string;
  sourceToken: string;
};

function allowedOrigin(request: Request) {
  const configured = Deno.env.get("PUBLIC_SITE_URL")?.replace(/\/$/, "");
  const origin = request.headers.get("Origin")?.replace(/\/$/, "");
  return configured && origin === configured ? configured : null;
}

function corsHeaders(request: Request) {
  const origin = allowedOrigin(request);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function validBase(value: Record<string, unknown>) {
  return typeof value.bookingId === "string" && uuidPattern.test(value.bookingId) &&
    typeof value.paymentAccessToken === "string" &&
    recoveryTokenPattern.test(value.paymentAccessToken);
}

function parsePayload(value: unknown): BasePayload | AbandonPayload | SubmitPayload | LeasePayload | CleanupPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.action === "cleanup") {
    if (Object.keys(payload).sort().join(",") !== "action,attemptId,bookingId,cleanupCapability" ||
      typeof payload.bookingId !== "string" || !uuidPattern.test(payload.bookingId) ||
      typeof payload.attemptId !== "string" || !uuidPattern.test(payload.attemptId) ||
      typeof payload.cleanupCapability !== "string" || !recoveryTokenPattern.test(payload.cleanupCapability)) return null;
    return payload as CleanupPayload;
  }
  if (!validBase(payload)) return null;
  if (payload.action === "lease") {
    if (Object.keys(payload).sort().join(",") !== "action,attemptId,bookingId,cleanupCapability,paymentAccessToken" ||
      typeof payload.attemptId !== "string" || !uuidPattern.test(payload.attemptId) ||
      (payload.cleanupCapability !== null && (typeof payload.cleanupCapability !== "string" ||
        !recoveryTokenPattern.test(payload.cleanupCapability)))) return null;
    return payload as LeasePayload;
  }
  if (payload.action === "initialize" || payload.action === "status") {
    if (Object.keys(payload).sort().join(",") !==
      "action,bookingId,paymentAccessToken") return null;
    return payload as BasePayload;
  }
  if (payload.action === "abandon" &&
    Object.keys(payload).sort().join(",") === "action,attemptId,bookingId,paymentAccessToken" &&
    typeof payload.attemptId === "string" && uuidPattern.test(payload.attemptId)) {
    return payload as AbandonPayload;
  }
  if (payload.action === "submit" &&
    Object.keys(payload).sort().join(",") ===
      "action,attemptId,bookingId,paymentAccessToken,sourceToken" &&
    typeof payload.attemptId === "string" && uuidPattern.test(payload.attemptId) &&
    typeof payload.sourceToken === "string" &&
    sourceTokenPattern.test(payload.sourceToken)) {
    return payload as SubmitPayload;
  }
  return null;
}

function publicAttempt(attempt: Record<string, unknown>) {
  return {
    paid: attempt.action === "paid",
    action: attempt.action,
    attemptId: attempt.attempt_id,
    attemptStatus: attempt.attempt_status,
    bookingStatus: attempt.booking_status,
    paymentStatus: attempt.payment_status,
    serviceName: attempt.service_name,
    amountMinor: attempt.amount_minor,
    currency: attempt.currency,
  };
}

function publicBookingContext(booking: Record<string, unknown>) {
  const relatedSlot = Array.isArray(booking.availability_slots)
    ? booking.availability_slots[0]
    : booking.availability_slots;
  const slot = relatedSlot && typeof relatedSlot === "object"
    ? relatedSlot as Record<string, unknown>
    : null;
  const bookingMode = booking.service_booking_mode_snapshot;
  const appointmentDate = bookingMode === "timed" ? slot?.slot_date ?? null : null;
  const appointmentTime = bookingMode === "timed" ? slot?.slot_time ?? null : null;

  return {
    serviceId: booking.service_id,
    serviceName: booking.service_name_snapshot,
    bookingMode,
    slotId: bookingMode === "timed" ? booking.slot_id : null,
    appointmentDate,
    appointmentTime,
    buyerContact: {
      givenName: booking.customer_name,
      email: booking.customer_email,
      ...(booking.customer_phone ? { phone: booking.customer_phone } : {}),
    },
    bookingDetails: {
      name: booking.customer_name,
      email: booking.customer_email,
      phone: booking.customer_phone || "",
      message: booking.customer_message,
      serviceId: booking.service_id,
      serviceName: booking.service_name_snapshot,
      bookingMode,
      slotId: bookingMode === "timed" ? booking.slot_id : null,
      appointmentDate,
      appointmentTime,
    },
  };
}

const bookingContextSelection = [
  "service_id",
  "service_name_snapshot",
  "service_booking_mode_snapshot",
  "slot_id",
  "customer_name",
  "customer_email",
  "customer_phone",
  "customer_message",
  "availability_slots!bookings_slot_id_fkey(slot_date,slot_time)",
].join(",");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    if (!allowedOrigin(request)) return new Response(null, { status: 403 });
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (!allowedOrigin(request)) return json(request, { error: "Origin is not allowed" }, 403);

  const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
  const locationId = Deno.env.get("SQUARE_LOCATION_ID");
  const squareEnvironment = Deno.env.get("SQUARE_ENVIRONMENT");
  const configuredVersion = Deno.env.get("SQUARE_API_VERSION");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!accessToken || !locationId || !supabaseUrl || !serviceRoleKey ||
    !["sandbox", "production"].includes(squareEnvironment || "") ||
    configuredVersion !== SQUARE_API_VERSION) {
    return json(request, { error: "Direct payment is not configured." }, 503);
  }

  try {
    const payload = parsePayload(await request.json());
    if (!payload) return json(request, { error: "Valid payment access is required." }, 400);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (payload.action === "cleanup") {
      if (!allowedOrigin(request)) return json(request, { abandoned: false }, 403);
      const { data, error } = await supabase.rpc("cleanup_timed_checkout", {
        p_booking_id: payload.bookingId, p_attempt_id: payload.attemptId,
        p_cleanup_capability: payload.cleanupCapability,
      });
      // Never return RPC errors, booking status, customer context or payment data.
      return json(request, { abandoned: !error && data === true }, error || data !== true ? 409 : 200);
    }
    if (payload.action === "lease") {
      const { data, error } = await supabase.rpc("renew_timed_checkout_lease", {
        p_booking_id: payload.bookingId, p_attempt_id: payload.attemptId,
        p_payment_access_token: payload.paymentAccessToken,
        p_cleanup_capability: payload.cleanupCapability,
      });
      if (error || !data) return json(request, { error: "Checkout lease cannot be renewed." }, 409);
      return json(request, {
        cleanupCapability: data.cleanupCapability, expiresAt: data.expiresAt,
        renewAfterSeconds: data.renewAfterSeconds,
      });
    }

    if (payload.action === "abandon") {
      const { data, error } = await supabase.rpc("abandon_timed_payment_booking", {
        p_attempt_id: payload.attemptId,
        p_booking_id: payload.bookingId,
        p_payment_access_token: payload.paymentAccessToken,
      });
      if (error || data !== true) {
        return json(request, { error: "Checkout could not be safely abandoned. Recover payment status." }, 409);
      }
      return json(request, { abandoned: true });
    }

    if (payload.action === "status") {
      const { data, error } = await supabase.rpc("get_payment_status", {
        p_booking_id: payload.bookingId,
        p_payment_access_token: payload.paymentAccessToken,
      });
      if (error) return json(request, { error: "Payment status is unavailable." }, 403);
      // The recovery token has already been verified by get_payment_status.
      // Appointment data comes from the booking's protected slot relationship,
      // never from browser recovery storage.
      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(bookingContextSelection)
        .eq("id", payload.bookingId)
        .single();
      if (bookingError || !booking) {
        return json(request, { error: "Payment status is unavailable." }, 403);
      }
      return json(request, {
        paid: data.paid,
        canRestart: data.can_restart,
        attemptId: data.attempt_id,
        attemptStatus: data.attempt_status,
        providerStatus: data.provider_status,
        bookingStatus: data.booking_status,
        paymentStatus: data.payment_status,
        serviceName: data.service_name,
        amountMinor: data.amount_minor,
        currency: data.currency,
        ...publicBookingContext(booking),
      });
    }

    if (payload.action === "initialize") {
      const { data, error } = await supabase.rpc("begin_payment_attempt", {
        p_booking_id: payload.bookingId,
        p_payment_access_token: payload.paymentAccessToken,
        p_provider: "square",
      });
      if (error) return json(request, { error: "This payment cannot be started." }, 409);
      // begin_payment_attempt verifies the same recovery token before this
      // service-role lookup exposes the booking's trusted display context.
      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(bookingContextSelection)
        .eq("id", payload.bookingId)
        .single();
      if (bookingError || !booking) {
        return json(request, { error: "This payment cannot be started." }, 409);
      }
      return json(request, {
        ...publicAttempt(data),
        ...publicBookingContext(booking),
      });
    }

    // Validate recovery access immediately before the privileged state change.
    const { data: status, error: statusError } = await supabase.rpc("get_payment_status", {
      p_booking_id: payload.bookingId,
      p_payment_access_token: payload.paymentAccessToken,
    });
    if (statusError || status.attempt_id !== payload.attemptId) {
      return json(request, { error: "Payment access is invalid." }, 403);
    }

    const { data: submission, error: submissionError } = await supabase.rpc(
      "mark_payment_attempt_processing",
      {
        p_booking_id: payload.bookingId,
        p_attempt_id: payload.attemptId,
        p_provider_location_id: locationId,
      },
    );
    if (submissionError || !submission?.should_submit) {
      return json(request, {
        error: "This payment is already being verified. Do not pay again.",
        verifying: true,
      }, 409);
    }

    const endpoint = squareEnvironment === "sandbox"
      ? "https://connect.squareupsandbox.com/v2/payments"
      : "https://connect.squareup.com/v2/payments";
    const squareRequest = {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Square-Version": SQUARE_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_id: payload.sourceToken,
        idempotency_key: submission.idempotency_key,
        amount_money: {
          amount: submission.amount_minor,
          currency: submission.currency,
        },
        location_id: locationId,
        autocomplete: true,
        reference_id: payload.attemptId,
      }),
    };
    let squareResponse: Response;
    try {
      squareResponse = await fetch(endpoint, squareRequest);
    } catch {
      // Retry this exact submission once. Both the source token and stable
      // database idempotency key are reused; no new attempt is created.
      try {
        squareResponse = await fetch(endpoint, squareRequest);
      } catch {
        await supabase.rpc("mark_payment_attempt_unknown", {
          p_booking_id: payload.bookingId,
          p_attempt_id: payload.attemptId,
          p_failure_detail: "Square request outcome is unknown.",
        });
        return json(request, {
          error: "Payment confirmation is delayed. Do not pay again.",
          verifying: true,
        }, 202);
      }
    }

    const result = await squareResponse.json().catch(() => ({}));
    if (!squareResponse.ok) {
      if (squareResponse.status >= 500 ||
        [408, 409, 429].includes(squareResponse.status)) {
        await supabase.rpc("mark_payment_attempt_unknown", {
          p_booking_id: payload.bookingId, p_attempt_id: payload.attemptId,
          p_failure_detail: "Square returned an indeterminate response.",
        });
        return json(request, {
          error: "Payment confirmation is delayed. Do not pay again.",
          verifying: true,
        }, 202);
      }
      const providerError = Array.isArray(result.errors) ? result.errors[0] : null;
      await supabase.rpc("fail_payment_attempt", {
        p_booking_id: payload.bookingId, p_attempt_id: payload.attemptId,
        p_provider_status: "FAILED",
        p_failure_code: String(providerError?.code || "PAYMENT_REJECTED"),
        p_failure_detail: String(providerError?.detail || "Payment was declined."),
      });
      return json(request, { error: "Payment was declined. Please try another card.", declined: true }, 402);
    }

    const payment = result.payment;
    const validPayment = payment && typeof payment.id === "string" &&
      payment.reference_id === payload.attemptId && payment.location_id === locationId &&
      payment.amount_money?.amount === submission.amount_minor &&
      payment.amount_money?.currency === submission.currency &&
      ["COMPLETED", "FAILED", "CANCELED"].includes(payment.status);
    if (!validPayment) {
      await supabase.rpc("mark_payment_attempt_unknown", {
        p_booking_id: payload.bookingId, p_attempt_id: payload.attemptId,
        p_failure_detail: "Square returned an inconsistent payment result.",
      });
      return json(request, {
        error: "Payment confirmation is delayed. Do not pay again.", verifying: true,
      }, 202);
    }

    const { error: recordError } = await supabase.rpc("record_provider_payment_result", {
      p_provider: "square", p_event_id: null, p_event_type: "api.create_payment",
      p_booking_id: payload.bookingId, p_attempt_id: payload.attemptId,
      p_provider_payment_id: payment.id,
      p_provider_location_id: payment.location_id,
      p_provider_status: payment.status,
      p_amount_minor: payment.amount_money.amount,
      p_currency: payment.amount_money.currency,
    });
    if (recordError) {
      await supabase.rpc("mark_payment_attempt_unknown", {
        p_booking_id: payload.bookingId,
        p_attempt_id: payload.attemptId,
        p_failure_detail: "Square payment was accepted but database confirmation is pending.",
      });
      return json(request, {
        error: "Payment is being verified. Do not pay again.", verifying: true,
      }, 202);
    }
    return json(request, {
      accepted: true, verifying: payment.status === "COMPLETED",
      declined: payment.status !== "COMPLETED",
    });
  } catch (error) {
    console.error("Square payment request failed", error instanceof Error ? error.message : "unknown");
    return json(request, { error: "Unable to process the payment request." }, 500);
  }
});
