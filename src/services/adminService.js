import { supabase } from "../lib/supabase";
import { isSlotPast, visibleAdminSlots } from "../utils/slotTime";

export async function generateSlots({
  startDate,
  endDate,
  selectedDays,
  startTime,
  endTime,
  interval,
}) {
  const slots = [];

  const currentDate = new Date(startDate);

  const finalDate = new Date(endDate);

  while (currentDate <= finalDate) {
    const dayOfWeek = currentDate.getUTCDay();

    if (selectedDays.includes(dayOfWeek)) {
      const [startHour, startMinute] = startTime.split(":").map(Number);

      const [endHour, endMinute] = endTime.split(":").map(Number);

      const slotTime = new Date(currentDate);

      slotTime.setUTCHours(startHour, startMinute, 0, 0);

      const slotEndTime = new Date(currentDate);

      slotEndTime.setUTCHours(endHour, endMinute, 0, 0);

      while (slotTime < slotEndTime) {
        const formattedDate = currentDate.toISOString().split("T")[0];

        const formattedTime = slotTime.toLocaleTimeString("en-GB", {
          timeZone: "UTC",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        });

        slots.push({
          slot_date: formattedDate,
          slot_time: formattedTime,
        });

        slotTime.setUTCMinutes(slotTime.getUTCMinutes() + Number(interval));
      }
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  if (slots.length === 0) {
    return;
  }

  const { error } = await supabase.rpc("create_availability_slots", {
    p_slots: slots,
  });

  if (error) {
    throw error;
  }
}

// Phase 4 period administration. Date/time values are intentionally sent as
// business-local wall-time strings; PostgreSQL owns timezone/DST validation.
export async function getAdminAvailabilityPeriods() {
  const { data, error } = await supabase.rpc("get_admin_availability_period_overview");
  if (error) throw error;
  return data || [];
}

export async function previewAvailabilityPeriods(periods, excludePeriodId = null) {
  const { data, error } = await supabase.rpc("preview_availability_period_batch", {
    p_periods: periods,
    p_exclude_period_id: excludePeriodId,
  });
  if (error) throw error;
  return data;
}

export async function createAvailabilityPeriods(periods) {
  const { data, error } = await supabase.rpc("create_availability_period_batch", {
    p_periods: periods,
  });
  if (error) throw error;
  return data;
}

export async function updateAvailabilityPeriod({ periodId, startLocal, endLocal }) {
  const { data, error } = await supabase.rpc("update_availability_period", {
    p_period_id: periodId,
    p_start_local: startLocal,
    p_end_local: endLocal,
  });
  if (error) throw error;
  return data;
}

export async function deleteAvailabilityPeriod(periodId) {
  const { data, error } = await supabase.rpc("delete_availability_period", {
    p_period_id: periodId,
  });
  if (error) throw error;
  return data;
}

export async function getLegacyAvailabilityCount() {
  const { count, error } = await supabase
    .from("availability_slots")
    .select("id", { count: "exact", head: true })
    .eq("availability_source", "legacy");
  if (error) throw error;
  return count || 0;
}

export async function getAdminSlots() {
  const { data, error } = await supabase
    .from("availability_slots")
    .select(
      `
      id,
      slot_date,
      slot_time,
      starts_at,
      is_available,
      bookings (
        id,
        status
      )
    `,
    )
    .order("slot_date", {
      ascending: true,
    })
    .order("slot_time", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return visibleAdminSlots(data || []);
}

export async function deletePastAvailabilitySlots() {
  const { data, error } = await supabase.rpc(
    "delete_past_availability_slots",
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function getAdminBookings() {
  const [bookingsResult, paymentStatesResult] = await Promise.all([
    supabase.from("bookings").select(`
        *,
        availability_slots (
          id,
          slot_date,
          slot_time,
          is_available,
          starts_at
        )
      `).order("created_at", {
      ascending: false,
    }),
    supabase.rpc("get_admin_direct_payment_states"),
  ]);

  if (bookingsResult.error) {
    throw bookingsResult.error;
  }
  if (paymentStatesResult.error) {
    throw paymentStatesResult.error;
  }

  const paymentStateByBooking = new Map(
    (paymentStatesResult.data || []).map((state) => [state.booking_id, state]),
  );

  return (bookingsResult.data || []).map((booking) => ({
    ...booking,
    payment_provider: paymentStateByBooking.get(booking.id)?.provider || null,
    payment_attempt_status:
      paymentStateByBooking.get(booking.id)?.attempt_status || null,
  }));
}

export async function getAdminBookingPricing() {
  const { data, error } = await supabase.rpc("get_admin_booking_pricing");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function getAdminStats() {
  const { data, error } = await supabase.rpc("get_admin_stats");

  if (error) {
    throw error;
  }

  return data;
}

function analyticsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isAdminAnalyticsResponse(data, period) {
  return Boolean(
    data && typeof data === "object" && !Array.isArray(data) &&
    data.period === period &&
    data.totals && typeof data.totals === "object" &&
    isNonNegativeNumber(data.totals.visits) &&
    isNonNegativeNumber(data.totals.publicPageviews) &&
    isNonNegativeNumber(data.totals.bookingPageviews) &&
    Array.isArray(data.trend) && data.trend.every((bucket) =>
      bucket && typeof bucket.timestamp === "string" &&
      isNonNegativeNumber(bucket.visits) && isNonNegativeNumber(bucket.pageviews)) &&
    Array.isArray(data.pages) && data.pages.every((page) =>
      page && typeof page.path === "string" && isNonNegativeNumber(page.pageviews)) &&
    data.sampling && typeof data.sampling.sampled === "boolean" &&
    isNonNegativeNumber(data.sampling.maxSampleInterval)
  );
}

export function describeAdminAnalyticsError(error) {
  if (error?.name === "FunctionsFetchError") {
    return analyticsError(
      "ANALYTICS_NETWORK",
      "The browser could not reach the analytics service. Check the current site address, connection, and browser privacy or network blocking, then try again.",
    );
  }

  if (error?.name === "FunctionsRelayError") {
    return analyticsError(
      "ANALYTICS_RELAY",
      "Supabase could not reach the analytics function. Please try again shortly.",
    );
  }

  if (error?.name === "FunctionsHttpError") {
    const status = Number(error.context?.status);
    if (status === 401) {
      return analyticsError(
        "ANALYTICS_AUTH",
        "Your admin session is no longer valid. Sign in again and retry.",
      );
    }
    if (status === 403) {
      return analyticsError(
        "ANALYTICS_FORBIDDEN",
        "This session or site address is not authorized to access analytics.",
      );
    }
    if (status === 429) {
      return analyticsError(
        "ANALYTICS_RATE_LIMITED",
        "Analytics is temporarily rate limited. Please try again shortly.",
      );
    }
    if ([502, 503, 504].includes(status)) {
      return analyticsError(
        "ANALYTICS_UPSTREAM",
        "The analytics service is temporarily unavailable. Please try again shortly.",
      );
    }
    return analyticsError(
      "ANALYTICS_HTTP",
      `The analytics service returned an HTTP error${Number.isInteger(status) ? ` (${status})` : ""}.`,
    );
  }

  return analyticsError(
    "ANALYTICS_UNKNOWN",
    "Unable to load analytics. Please try again.",
  );
}

export async function getAdminAnalytics(period, { refresh = false } = {}) {
  let result;
  try {
    result = await supabase.functions.invoke("admin-analytics", {
      body: { period, refresh },
    });
  } catch (error) {
    throw describeAdminAnalyticsError(error);
  }

  if (result.error) {
    throw describeAdminAnalyticsError(result.error);
  }

  if (!isAdminAnalyticsResponse(result.data, period)) {
    throw analyticsError(
      "ANALYTICS_INVALID_RESPONSE",
      "The analytics service returned an invalid response. Please try again.",
    );
  }

  return result.data;
}

export async function getAdminServices() {
  const { data, error } = await supabase.rpc("get_admin_services");
  if (error) throw error;
  return data || [];
}

export async function createAdminService({ name, publicSummary, bookingMode, priceAmount }) {
  const { data, error } = await supabase.rpc("create_admin_service", {
    p_name: name,
    p_public_summary: publicSummary,
    p_booking_mode: bookingMode,
    p_price_amount: priceAmount,
  });
  if (error) throw error;
  return data;
}

export async function updateAdminService({ serviceId, name, publicSummary, priceAmount }) {
  const { data, error } = await supabase.rpc("update_admin_service", {
    p_service_id: serviceId,
    p_name: name,
    p_public_summary: publicSummary,
    p_price_amount: priceAmount,
  });
  if (error) throw error;
  return data;
}

export async function setAdminServiceActive(serviceId, isActive) {
  const { data, error } = await supabase.rpc("set_admin_service_active", {
    p_service_id: serviceId,
    p_is_active: isActive,
  });
  if (error) throw error;
  return data;
}

export async function moveAdminService(serviceId, direction) {
  const { data, error } = await supabase.rpc("move_admin_service", {
    p_service_id: serviceId,
    p_direction: direction,
  });
  if (error) throw error;
  return data;
}

export async function getAdminDiscountCodes() {
  const { data, error } = await supabase.rpc("get_admin_discount_codes");

  if (error) throw error;

  return data || [];
}

export async function createAdminDiscountCode({
  code,
  percentageOff,
  scope,
  selectedServiceIds,
  enabled,
  expiresAt,
}) {
  const { data, error } = await supabase.rpc("create_admin_discount_code", {
    p_code: code,
    p_percentage_off: percentageOff,
    p_scope: scope,
    p_selected_service_ids: selectedServiceIds,
    p_enabled: enabled,
    p_expires_at: expiresAt,
  });

  if (error) throw error;

  return data;
}

export async function updateAdminDiscountCode({
  discountCodeId,
  percentageOff,
  scope,
  selectedServiceIds,
  enabled,
  expiresAt,
}) {
  const { data, error } = await supabase.rpc("update_admin_discount_code", {
    p_discount_code_id: discountCodeId,
    p_percentage_off: percentageOff,
    p_scope: scope,
    p_selected_service_ids: selectedServiceIds,
    p_enabled: enabled,
    p_expires_at: expiresAt,
  });

  if (error) throw error;

  return data;
}

export async function setAdminDiscountCodeEnabled(discountCodeId, enabled) {
  const { data, error } = await supabase.rpc("set_admin_discount_code_enabled", {
    p_discount_code_id: discountCodeId,
    p_enabled: enabled,
  });

  if (error) throw error;

  return data;
}

export async function getEligibleDiscountServices() {
  const { data, error } = await supabase.rpc("get_active_services");

  if (error) throw error;

  // get_active_services is the reusable catalogue projection and returns only
  // active services. The remaining conditions mirror the customer quote API.
  return (data || []).filter((service) =>
    service.payment_required === true &&
    service.payment_flow === "direct_payment" &&
    Number(service.price_amount) > 0 &&
    service.currency === "USD",
  );
}

export async function getAvailableAdminSlots() {
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

  return (data || []).filter((slot) => !isSlotPast(slot));
}

export async function createAdminBooking({
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

export async function updateBookingStatus(bookingId, status) {
  const { data, error } = await supabase.rpc("update_booking_status", {
    p_booking_id: bookingId,
    p_status: status,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function setBookingTestClassification({ bookingId, isTest }) {
  const { data, error } = await supabase.rpc(
    "set_booking_test_classification",
    {
      p_booking_id: bookingId,
      p_is_test: isTest,
    },
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function updateBookingPayment({
  bookingId,
  paymentStatus,
  amountDue,
  amountPaid,
  paymentMethod,
  paymentReference,
}) {
  const { data, error } = await supabase.rpc("update_booking_payment", {
    p_booking_id: bookingId,
    p_payment_status: paymentStatus,
    p_amount_due: amountDue,
    p_amount_paid: amountPaid,
    p_payment_method: paymentMethod || null,
    p_payment_reference: paymentReference || null,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function cancelBooking(bookingId) {
  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function deleteSlot(slotId) {
  const { error } = await supabase.rpc("delete_availability_slot", {
    p_slot_id: slotId,
  });

  if (error) {
    throw error;
  }
}

export async function getEmailSettings() {
  const { data, error } = await supabase.rpc("get_email_settings");

  if (error) {
    throw error;
  }

  return data;
}

export async function updateEmailSettings({
  adminNotificationEmail,
  bookingRemindersEnabled,
  bookingReminderHoursList,
  sendAdminReminders,
  sendWindowStart,
  sendWindowEnd,
  timezone,
  confirmedBookingsOnly,
  sendForUnpaid,
  sendForPartPaid,
  sendForPaid,
}) {
  const { data, error } = await supabase.rpc("update_email_settings", {
    p_admin_notification_email: adminNotificationEmail,
    p_booking_reminders_enabled: bookingRemindersEnabled,
    p_booking_reminder_hours_list: bookingReminderHoursList,
    p_send_admin_reminders: sendAdminReminders,
    p_send_window_start: sendWindowStart,
    p_send_window_end: sendWindowEnd,
    p_timezone: timezone,
    p_confirmed_bookings_only: confirmedBookingsOnly,
    p_send_for_unpaid: sendForUnpaid,
    p_send_for_part_paid: sendForPartPaid,
    p_send_for_paid: sendForPaid,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function getServicePaymentSettings() {
  const { data, error } = await supabase.rpc("get_service_payment_settings");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function updateServicePaymentSetting({ serviceId, paymentLinkUrl }) {
  const { data, error } = await supabase.rpc(
    "update_service_payment_setting",
    {
      p_service_id: serviceId,
      p_stripe_payment_link_url: paymentLinkUrl || null,
    },
  );

  if (error) {
    throw error;
  }

  return data;
}
