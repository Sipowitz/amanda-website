import { useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";

export default function BookingForm({
  service,
  selectedSlot = null,
  onSubmit,
  onCancel,
  loading,
  disabled = false,
  bookingMode,
  presentation,
  animateOnMount = true,
}) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });

  const isTimed = (service?.booking_mode || bookingMode) === "timed";
  const displayName = service?.name || presentation?.name;
  const displayPriceAmount = service
    ? service.price_amount
    : presentation?.displayPriceAmount;
  const displayCurrency = service
    ? service.currency
    : presentation?.displayCurrency;
  const displayDurationMinutes = service
    ? service.duration_minutes
    : presentation?.displayDurationMinutes;

  if (isTimed && !selectedSlot) {
    return null;
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(formData);
  }

  const readableDate = selectedSlot
    ? format(new Date(selectedSlot.slot_date), "EEEE, MMMM d")
    : null;

  return (
    <motion.form
      initial={animateOnMount ? { opacity: 0, y: 16 } : false}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-[#f1e8ca]/55">
            {isTimed ? "Confirm Booking" : "Send Request"}
          </p>

          <h3 className="mt-2 text-2xl text-[#f1e8ca]">{displayName}</h3>

          <p className="mt-2 flex min-h-7 gap-2 text-lg text-[#f1e8ca]/70">
            <span>
              {displayPriceAmount != null && displayCurrency
                ? (displayPriceAmount / 100).toLocaleString("en-US", {
                    style: "currency",
                    currency: displayCurrency,
                  })
                : ""}
            </span>
            <span>
              {displayDurationMinutes
                ? `- ${displayDurationMinutes} minutes`
                : ""}
            </span>
          </p>

          {selectedSlot && (
            <p className="mt-3 text-[#f1e8ca]/70">
              {readableDate} - {selectedSlot.slot_time}
            </p>
          )}
        </div>

        {isTimed && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55 transition hover:text-[#f1e8ca]"
          >
            Change Selection
          </button>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <input
          type="text"
          name="name"
          placeholder="Your name"
          required
          value={formData.name}
          onChange={handleChange}
          className="rounded-2xl border border-white/10 bg-black/10 px-5 py-4 text-[#f1e8ca] placeholder:text-[#f1e8ca]/35 outline-none transition focus:border-[#f1e8ca]/40"
        />

        <input
          type="email"
          name="email"
          placeholder="Email address"
          required
          value={formData.email}
          onChange={handleChange}
          className="rounded-2xl border border-white/10 bg-black/10 px-5 py-4 text-[#f1e8ca] placeholder:text-[#f1e8ca]/35 outline-none transition focus:border-[#f1e8ca]/40"
        />

        <input
          type="tel"
          name="phone"
          placeholder="Phone number"
          required
          value={formData.phone}
          onChange={handleChange}
          className="rounded-2xl border border-white/10 bg-black/10 px-5 py-4 text-[#f1e8ca] placeholder:text-[#f1e8ca]/35 outline-none transition focus:border-[#f1e8ca]/40"
        />
      </div>

      <textarea
        name="message"
        placeholder={
          isTimed
            ? "Optional message"
            : "Tell Amanda the topic or question for your voice memo reading"
        }
        rows="5"
        required={!isTimed}
        value={formData.message}
        onChange={handleChange}
        className="rounded-2xl border border-white/10 bg-black/10 px-5 py-4 text-[#f1e8ca] placeholder:text-[#f1e8ca]/35 outline-none transition focus:border-[#f1e8ca]/40"
      />

      <button
        type="submit"
        disabled={loading || disabled}
        className="rounded-2xl border border-[#f1e8ca]/20 bg-[#f1e8ca]/10 px-8 py-4 text-[#f1e8ca] transition duration-300 hover:bg-[#f1e8ca]/18 disabled:opacity-50"
      >
        {loading
          ? "Sending..."
          : isTimed
            ? "Confirm Booking"
            : "Request Voice Memo Reading"}
      </button>
    </motion.form>
  );
}
