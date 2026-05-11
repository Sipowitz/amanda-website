import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import BookingHero from "../components/booking/BookingHero";
import DateSelector from "../components/booking/DateSelector";
import TimeSlotPicker from "../components/booking/TimeSlotPicker";
import BookingForm from "../components/booking/BookingForm";
import BookingSuccess from "../components/booking/BookingSuccess";

import { getAvailableSlots, createBooking } from "../services/bookingService";

export default function Booking() {
  const [slots, setSlots] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadSlots() {
      try {
        const data = await getAvailableSlots();

        setSlots(data);

        if (data.length > 0) {
          setSelectedDate(data[0].slot_date);
        }
      } catch (error) {
        console.error("Failed to load booking slots:", error);
      } finally {
        setLoading(false);
      }
    }

    loadSlots();
  }, []);

  const uniqueDates = useMemo(() => {
    return [...new Set(slots.map((slot) => slot.slot_date))];
  }, [slots]);

  const filteredSlots = useMemo(() => {
    return slots.filter((slot) => slot.slot_date === selectedDate);
  }, [slots, selectedDate]);

  async function handleBookingSubmit(formData) {
    if (!selectedSlot) {
      return;
    }

    try {
      setSubmitting(true);

      await createBooking({
        slotId: selectedSlot.id,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        message: formData.message,
      });

      setSuccess(true);

      setSlots((prev) => prev.filter((slot) => slot.id !== selectedSlot.id));
    } catch (error) {
      console.error("Booking failed:", error);
      alert("Something went wrong while creating the booking.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="px-6 pb-24 pt-10 text-[#f1e8ca]">
      <div className="mx-auto flex max-w-6xl flex-col gap-16">
        <BookingHero />

        {loading ? (
          <div className="py-20">
            <p className="text-[#f1e8ca]/70">Loading availability...</p>
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-10">
              <div>
                <p className="mb-5 text-sm uppercase tracking-[0.24em] text-[#f1e8ca]/50">
                  Select Date
                </p>

                <DateSelector
                  availableDates={uniqueDates}
                  selectedDate={selectedDate}
                  onSelectDate={(date) => {
                    setSelectedDate(date);
                    setSelectedSlot(null);
                    setSuccess(false);
                  }}
                />
              </div>

              {selectedDate && (
                <motion.div layout className="flex flex-col gap-8">
                  <div>
                    <p className="mb-4 text-sm uppercase tracking-[0.24em] text-[#f1e8ca]/50">
                      Available Times
                    </p>

                    <TimeSlotPicker
                      slots={filteredSlots}
                      selectedSlot={selectedSlot}
                      onSelectSlot={setSelectedSlot}
                    />
                  </div>

                  {selectedSlot && !success && (
                    <BookingForm
                      selectedSlot={selectedSlot}
                      onSubmit={handleBookingSubmit}
                      onCancel={() => {
                        setSelectedSlot(null);
                        setSuccess(false);
                      }}
                      loading={submitting}
                    />
                  )}

                  {success && <BookingSuccess />}
                </motion.div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
