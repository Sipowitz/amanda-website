import { supabase } from "../lib/supabase";
import { isSlotWithinBookingCutoff } from "../utils/slotTime";

export async function getActiveServices() {
  const { data, error } = await supabase.rpc("get_active_services");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function getServiceBySlug(slug) {
  const services = await getActiveServices();
  const service = services.find((item) => item.slug === slug);

  if (!service) {
    throw new Error("This service is not currently available.");
  }

  return service;
}

export async function getAvailableSlots() {
  const { data, error } = await supabase
    .from("availability_slots")
    .select("*")
    .eq("is_available", true)
    .order("slot_date", {
      ascending: true,
    })
    .order("slot_time", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data || []).filter((slot) => !isSlotWithinBookingCutoff(slot));
}

export async function createBooking({
  serviceId,
  slotId,
  name,
  email,
  phone,
  message,
}) {
  const { data, error } = await supabase.rpc("create_booking_request", {
    p_service_id: serviceId,
    p_slot_id: slotId || null,
    p_customer_name: name,
    p_customer_email: email,
    p_customer_phone: phone || null,
    p_customer_message: message || null,
  });

  if (error) {
    throw error;
  }

  return {
    bookingId: data,
  };
}

export async function createPendingPaymentBooking({
  serviceId,
  slotId,
  name,
  email,
  phone,
  message,
}) {
  const { data, error } = await supabase.rpc(
    "create_pending_payment_booking",
    {
      p_service_id: serviceId,
      p_slot_id: slotId || null,
      p_customer_name: name,
      p_customer_email: email,
      p_customer_phone: phone || null,
      p_customer_message: message || null,
    },
  );

  if (error) {
    throw error;
  }

  return {
    bookingId: data.booking_id,
    paymentAccessToken: data.payment_access_token,
  };
}

export async function quoteDirectPaymentDiscount({ serviceId, discountCode }) {
  const { data, error } = await supabase.rpc("quote_direct_payment_discount", {
    p_service_id: serviceId,
    p_discount_code: discountCode,
  });

  if (error) {
    throw error;
  }

  // The RPC RETURNS TABLE, so PostgREST returns its single result as an array.
  const quote = Array.isArray(data) ? data[0] : data;
  if (!quote || typeof quote.accepted !== "boolean") {
    throw new Error("Discount pricing is unavailable.");
  }
  return quote;
}

export async function createDiscountedPendingPaymentBooking({
  serviceId,
  slotId,
  name,
  email,
  phone,
  message,
  discountCode,
  reviewGuard,
}) {
  const { data, error } = await supabase.rpc(
    "create_discounted_pending_payment_booking",
    {
      p_service_id: serviceId,
      p_slot_id: slotId || null,
      p_customer_name: name,
      p_customer_email: email,
      p_customer_phone: phone || null,
      p_customer_message: message || null,
      p_discount_code: discountCode,
      p_review_guard: reviewGuard,
    },
  );

  if (error) {
    throw error;
  }

  if (data?.created === false && data.code === "PRICE_REVIEW_REQUIRED") {
    return { created: false, code: data.code };
  }
  if (data?.created !== true || !data.booking_id || !data.payment_access_token) {
    throw new Error("Discounted booking could not be created.");
  }

  return {
    created: true,
    bookingId: data.booking_id,
    paymentAccessToken: data.payment_access_token,
  };
}

async function invokePaymentAction(action, bookingId, paymentAccessToken, extra = {}) {
  const { data, error } = await supabase.functions.invoke(
    "square-payment",
    {
      body: { action, bookingId, paymentAccessToken, ...extra },
    },
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function initializeDirectPayment(bookingId, paymentAccessToken) {
  const data = await invokePaymentAction(
    "initialize",
    bookingId,
    paymentAccessToken,
  );

  if (!data?.attemptId && !data?.paid) {
    throw new Error(data?.error || "Payment attempt was not created.");
  }

  return data;
}

export async function abandonTimedPaymentBooking(bookingId, paymentAccessToken, attemptId) {
  return invokePaymentAction("abandon", bookingId, paymentAccessToken, { attemptId });
}

export async function getDirectPaymentStatus(bookingId, paymentAccessToken) {
  const data = await invokePaymentAction(
    "status",
    bookingId,
    paymentAccessToken,
  );

  if (!data || typeof data.paid !== "boolean") {
    throw new Error(data?.error || "Payment status is unavailable.");
  }

  return data;
}

export async function submitSquarePayment({ bookingId, paymentAccessToken, attemptId, sourceToken }) {
  return invokePaymentAction("submit", bookingId, paymentAccessToken, { attemptId, sourceToken });
}


export async function renewTimedCheckoutLease(bookingId, paymentAccessToken, attemptId, cleanupCapability = null) {
  return invokePaymentAction("lease", bookingId, paymentAccessToken, { attemptId, cleanupCapability });
}

export async function cleanupTimedCheckout({ bookingId, attemptId, cleanupCapability }) {
  const { data, error } = await supabase.functions.invoke("square-payment", {
    body: { action: "cleanup", bookingId, attemptId, cleanupCapability },
  });
  if (error) throw error;
  return data;
}
