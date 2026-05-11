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
  const { data, error } = await supabase
    .from("availability_slots")
    .select(
      `
      *,
      bookings (
        id,
        slot_id,
        customer_name,
        customer_email,
        customer_phone,
        customer_message
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

export async function deleteBooking(bookingId, slotId) {
  const { error: bookingError } = await supabase
    .from("bookings")
    .delete()
    .eq("id", bookingId);

  if (bookingError) {
    throw bookingError;
  }

  const { error: slotError } = await supabase
    .from("availability_slots")
    .update({
      is_available: true,
    })
    .eq("id", slotId);

  if (slotError) {
    throw slotError;
  }
}
