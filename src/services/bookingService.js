import { supabase } from "../lib/supabase";

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
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("availability_slots")
    .select("*")
    .eq("is_available", true)
    .gte("slot_date", today)
    .order("slot_date", {
      ascending: true,
    })
    .order("slot_time", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return data;
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
  name,
  email,
  phone,
  message,
}) {
  const { data, error } = await supabase.rpc(
    "create_pending_payment_booking",
    {
      p_service_id: serviceId,
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

async function invokeCheckoutAction(action, bookingId, paymentAccessToken) {
  const { data, error } = await supabase.functions.invoke(
    "create-checkout-session",
    {
      body: { action, bookingId, paymentAccessToken },
    },
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function createCheckoutSession(bookingId, paymentAccessToken) {
  const data = await invokeCheckoutAction(
    "initialize",
    bookingId,
    paymentAccessToken,
  );

  if (!data?.clientSecret && !data?.paid) {
    throw new Error(data?.error || "Checkout Session was not created.");
  }

  return data;
}

export async function getCheckoutPaymentStatus(bookingId, paymentAccessToken) {
  const data = await invokeCheckoutAction(
    "status",
    bookingId,
    paymentAccessToken,
  );

  if (!data || typeof data.paid !== "boolean") {
    throw new Error(data?.error || "Payment status is unavailable.");
  }

  return data;
}
