import { useEffect, useMemo, useState } from "react";

import { format } from "date-fns";

import { motion } from "framer-motion";

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
    <div className="min-h-screen text-[#f1e8ca]">
      <section className="px-6 pb-12 pt-3">
        <div className="mx-auto w-full max-w-7xl">
          <motion.div
            initial={{
              opacity: 0,
              y: 30,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 1,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="max-w-5xl"
          >
            <p className="mb-8 text-sm font-medium uppercase tracking-[0.35em] text-[#f1e8ca]/65">
              Reservations
            </p>

            <h1 className="max-w-5xl text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">
              Book an Experience
            </h1>

            <div className="mt-12 max-w-4xl text-xl leading-[2] text-[#f1e8ca]/88 md:text-2xl">
              <p>
                Select a date and time for your visit. A quiet and considered
                booking experience designed to feel calm, personal, and
                effortless.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-10">
          <div>
            <div className="mb-5 flex min-h-5 justify-end">
              <p
                className={`text-xs uppercase tracking-[0.22em] text-[#f1e8ca]/40 transition-opacity duration-300 ${
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
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
              <div className="text-left">
                <p className="mb-3 text-xs uppercase tracking-[0.28em] text-[#f1e8ca]/45">
                  Selected Date
                </p>

                <h2 className="text-3xl font-light leading-tight text-[#f1e8ca] sm:text-4xl">
                  {formattedSelectedDate}
                </h2>
              </div>

              <TimeSlotPicker
                slots={filteredSlots}
                selectedSlot={selectedSlot}
                onSelectSlot={setSelectedSlot}
              />

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
        </div>
      </section>
    </div>
  );
}