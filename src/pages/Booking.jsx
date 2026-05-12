import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";

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

  const formattedSelectedDate = useMemo(() => {
    if (!selectedDate) {
      return "";
    }

    return format(new Date(selectedDate), "EEEE, MMMM d");
  }, [selectedDate]);

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
    <section className="px-6 pb-24 text-[#f1e8ca]">
      <div className="mx-auto flex max-w-6xl flex-col gap-16">
        <BookingHero />

        <section className="flex flex-col gap-10">
          <div className="min-h-[520px]">
            <div className="mb-5 flex h-5 justify-end">
              <p
                className={`text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/35 transition-opacity duration-300 ${
                  loading ? "opacity-100" : "opacity-0"
                }`}
              >
                Loading availability...
              </p>
            </div>

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

          {!loading && selectedDate && (
            <div className="flex flex-col gap-8">
              <div>
                <div className="mb-6">
                  <h3 className="text-xl font-light leading-tight text-[#f3efe7] sm:text-3xl">
                    Availability for {formattedSelectedDate}
                  </h3>
                </div>

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
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
