import { supabase } from "../lib/supabase";

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
    const dayOfWeek = currentDate.getDay();

    if (selectedDays.includes(dayOfWeek)) {
      const [startHour, startMinute] = startTime.split(":").map(Number);

      const [endHour, endMinute] = endTime.split(":").map(Number);

      const slotTime = new Date(currentDate);

      slotTime.setHours(startHour, startMinute, 0, 0);

      const slotEndTime = new Date(currentDate);

      slotEndTime.setHours(endHour, endMinute, 0, 0);

      while (slotTime < slotEndTime) {
        const formattedDate = currentDate.toISOString().split("T")[0];

        const formattedTime = slotTime.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

        slots.push({
          slot_date: formattedDate,
          slot_time: formattedTime,
          is_available: true,
        });

        slotTime.setMinutes(slotTime.getMinutes() + Number(interval));
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (slots.length === 0) {
    return;
  }

  const { error } = await supabase.from("availability_slots").upsert(slots, {
    onConflict: "slot_date,slot_time",
    ignoreDuplicates: true,
  });

  if (error) {
    throw error;
  }
}

export async function getAdminSlots() {
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("availability_slots")
    .select(
      `
      *,
      bookings (
        id,
        slot_id,
        service_id,
        service_name_snapshot,
        service_booking_mode_snapshot,
        service_duration_minutes_snapshot,
        service_price_amount_snapshot,
        service_currency_snapshot,
        customer_name,
        customer_email,
        customer_phone,
        customer_message,
        status,
        payment_status,
        amount_due,
        amount_paid,
        paid_at,
        payment_method,
        payment_reference,
        confirmed_at,
        cancelled_at,
        completed_at,
        created_at,
        updated_at
      )
    `,
    )
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
          is_available
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

export async function getAvailableAdminSlots() {
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
  const { error } = await supabase
    .from("availability_slots")
    .delete()
    .eq("id", slotId);

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
