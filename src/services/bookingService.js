import { supabase } from "../lib/supabase";

export async function getAvailableSlots() {
  const { data, error } = await supabase
    .from("availability_slots")
    .select("*")
    .eq("is_available", true)
    .order("slot_date", { ascending: true })
    .order("slot_time", { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}

export async function createBooking({ slotId, name, email, phone, message }) {
  const { error: bookingError } = await supabase.from("bookings").insert([
    {
      slot_id: slotId,
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      customer_message: message,
    },
  ]);

  if (bookingError) {
    throw bookingError;
  }

  const { error: slotError } = await supabase
    .from("availability_slots")
    .update({
      is_available: false,
    })
    .eq("id", slotId);

  if (slotError) {
    throw slotError;
  }

  return true;
}
