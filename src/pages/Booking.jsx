import { useEffect, useMemo, useState } from "react";

import { format } from "date-fns";
import { motion } from "framer-motion";
import { Link, useParams } from "react-router-dom";

import DateSelector from "../components/booking/DateSelector";
import TimeSlotPicker from "../components/booking/TimeSlotPicker";
import BookingForm from "../components/booking/BookingForm";
import BookingSuccess from "../components/booking/BookingSuccess";

import {
  createBooking,
  getAvailableSlots,
  getServiceBySlug,
} from "../services/bookingService";

function formatServicePrice(service) {
  return (service.price_amount / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function Booking({ expectedMode }) {
  const { serviceSlug } = useParams();
  const [service, setService] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadBookingPage() {
      try {
        setLoading(true);
        setError("");
        setService(null);
        setSlots([]);
        setSelectedDate(null);
        setSelectedSlot(null);
        setSuccess(false);

        const resolvedService = await getServiceBySlug(serviceSlug);

        if (resolvedService.booking_mode !== expectedMode) {
          throw new Error("This booking route does not match the selected service.");
        }

        const availableSlots = expectedMode === "timed"
          ? await getAvailableSlots()
          : [];

        if (active) {
          setService(resolvedService);
          setSlots(availableSlots);
        }
      } catch (loadError) {
        console.error("Failed to load booking service:", loadError);

        if (active) {
          setError(loadError.message || "This service is not available.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadBookingPage();

    return () => {
      active = false;
    };
  }, [expectedMode, serviceSlug]);

  const uniqueDates = useMemo(
    () => [...new Set(slots.map((slot) => slot.slot_date))],
    [slots],
  );

  const filteredSlots = useMemo(
    () => slots.filter((slot) => slot.slot_date === selectedDate),
    [slots, selectedDate],
  );

  const formattedSelectedDate = useMemo(() => {
    if (!selectedDate) {
      return "";
    }

    return format(new Date(selectedDate), "EEEE, MMMM d");
  }, [selectedDate]);

  async function handleBookingSubmit(formData) {
    if (!service || (service.booking_mode === "timed" && !selectedSlot)) {
      return;
    }

    try {
      setSubmitting(true);

      await createBooking({
        serviceId: service.id,
        slotId: selectedSlot?.id || null,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        message: formData.message,
      });

      setSuccess(true);

      if (selectedSlot) {
        setSlots((previousSlots) =>
          previousSlots.filter((slot) => slot.id !== selectedSlot.id)
        );
      }
    } catch (bookingError) {
      console.error("Booking failed:", bookingError);
      setError(
        bookingError.message || "Something went wrong while creating the booking.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!loading && !service) {
    return (
      <section className="px-6 pb-24 pt-8 text-[#f1e8ca]">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-white/10 bg-white/[0.04] p-10">
          <h1 className="text-4xl font-light">Service unavailable</h1>
          <p className="mt-4 text-[#f1e8ca]/70">{error}</p>
          <Link
            to="/services"
            className="mt-8 inline-flex rounded-full border border-[#f1e8ca]/30 px-6 py-3 uppercase tracking-[0.18em]"
          >
            View Services
          </Link>
        </div>
      </section>
    );
  }

  const isTimed = service?.booking_mode === "timed";

  return (
    <div className="min-h-screen text-[#f1e8ca]">
      <section className="px-6 pb-12 pt-3">
        <div className="mx-auto w-full max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-5xl"
          >
            <p className="mb-8 text-sm font-medium uppercase tracking-[0.35em] text-[#f1e8ca]/65">
              {isTimed ? "Reservations" : "Reading Request"}
            </p>

            <h1 className="max-w-5xl text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">
              {service?.name || "Loading service..."}
            </h1>

            {service && (
              <div className="mt-8 flex flex-wrap items-center gap-4 text-xl text-[#f1e8ca]/80">
                <span>{formatServicePrice(service)}</span>
                {service.duration_minutes && (
                  <span>{service.duration_minutes} minutes</span>
                )}
              </div>
            )}

            <div className="mt-8 max-w-4xl text-xl leading-[2] text-[#f1e8ca]/88 md:text-2xl">
              <p>
                {isTimed
                  ? "Select a date and time from the shared availability calendar."
                  : "Share your contact details and the topic you would like Amanda to explore. No appointment is required."}
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-10">
          {loading && (
            <p className="text-xs uppercase tracking-[0.22em] text-[#f1e8ca]/40">
              Loading service...
            </p>
          )}

          {!loading && service && isTimed && (
            <>
              <DateSelector
                availableDates={uniqueDates}
                selectedDate={selectedDate}
                onSelectDate={(date) => {
                  setSelectedDate(date);
                  setSelectedSlot(null);
                  setSuccess(false);
                  setError("");
                }}
              />

              {selectedDate && (
                <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
                  <div className="text-left">
                    <p className="mb-3 text-xs uppercase tracking-[0.28em] text-[#f1e8ca]/45">
                      Selected Date
                    </p>
                    <h2 className="text-3xl font-light text-[#f1e8ca] sm:text-4xl">
                      {formattedSelectedDate}
                    </h2>
                  </div>

                  <TimeSlotPicker
                    slots={filteredSlots}
                    selectedSlot={selectedSlot}
                    onSelectSlot={(slot) => {
                      setSelectedSlot(slot);
                      setSuccess(false);
                      setError("");
                    }}
                  />

                  {selectedSlot && !success && (
                    <BookingForm
                      service={service}
                      selectedSlot={selectedSlot}
                      onSubmit={handleBookingSubmit}
                      onCancel={() => {
                        setSelectedSlot(null);
                        setSuccess(false);
                      }}
                      loading={submitting}
                    />
                  )}

                  {success && <BookingSuccess service={service} />}
                </div>
              )}
            </>
          )}

          {!loading && service && !isTimed && (
            <div className="mx-auto w-full max-w-5xl">
              {success ? (
                <BookingSuccess service={service} />
              ) : (
                <BookingForm
                  service={service}
                  onSubmit={handleBookingSubmit}
                  loading={submitting}
                />
              )}
            </div>
          )}

          {error && service && (
            <p className="mx-auto w-full max-w-5xl rounded-xl border border-red-200/20 bg-red-950/10 px-5 py-4 text-red-100">
              {error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
