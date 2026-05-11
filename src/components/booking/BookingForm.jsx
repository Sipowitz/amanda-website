import { useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";

export default function BookingForm({
  selectedSlot,
  onSubmit,
  onCancel,
  loading,
}) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });

  if (!selectedSlot) {
    return null;
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    onSubmit(formData);
  }

  const readableDate = format(new Date(selectedSlot.slot_date), "EEEE, MMMM d");

  return (
    <motion.form
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-[#f1e8ca]/55">
            Confirm Booking
          </p>

          <h3 className="mt-2 text-2xl text-[#f1e8ca]">{readableDate}</h3>

          <p className="mt-2 text-lg text-[#f1e8ca]/70">
            {selectedSlot.slot_time}
          </p>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55 transition hover:text-[#f1e8ca]"
        >
          Change Selection
        </button>
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

        <div />
      </div>

      <textarea
        name="message"
        placeholder="Optional message"
        rows="5"
        value={formData.message}
        onChange={handleChange}
        className="rounded-2xl border border-white/10 bg-black/10 px-5 py-4 text-[#f1e8ca] placeholder:text-[#f1e8ca]/35 outline-none transition focus:border-[#f1e8ca]/40"
      />

      <button
        type="submit"
        disabled={loading}
        className="rounded-2xl border border-[#f1e8ca]/20 bg-[#f1e8ca]/10 px-8 py-4 text-[#f1e8ca] transition duration-300 hover:bg-[#f1e8ca]/18 disabled:opacity-50"
      >
        {loading ? "Confirming..." : "Confirm Booking"}
      </button>
    </motion.form>
  );
}
