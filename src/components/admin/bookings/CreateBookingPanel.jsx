const fieldClass =
  "rounded-xl border border-[#d9d5ca] bg-white px-4 py-3 text-[#29332b] outline-none transition placeholder:text-[#9a9e98] focus:border-[#6f8c72] focus:ring-2 focus:ring-[#6f8c72]/10";

export default function CreateBookingPanel({
  services,
  availableSlots,
  formData,
  onChange,
  onSubmit,
  creating,
}) {
  const selectedService = services.find(
    (service) => service.id === formData.serviceId,
  );
  const isTimed = selectedService?.booking_mode === "timed";

  return (
    <section className="rounded-[1.35rem] border border-[#ddd9cf] bg-white/90 p-5 shadow-[0_10px_35px_rgba(45,55,45,0.08)] sm:p-6">
      <div className="mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7b827a]">
          Manual entry
        </p>
        <h2 className="mt-2 text-2xl font-medium text-[#283128]">
          Create booking
        </h2>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <select
          required
          name="serviceId"
          value={formData.serviceId}
          onChange={onChange}
          className={fieldClass}
        >
          <option value="">Select a service</option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name} - {(service.price_amount / 100).toLocaleString(
                "en-US",
                { style: "currency", currency: "USD" },
              )}
            </option>
          ))}
        </select>

        {isTimed && (
          <select
            required
            name="slotId"
            value={formData.slotId}
            onChange={onChange}
            className={fieldClass}
          >
            <option value="">Select an available slot</option>
            {availableSlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.slot_date} - {slot.slot_time}
              </option>
            ))}
          </select>
        )}

        {selectedService?.booking_mode === "untimed" && (
          <p className="rounded-xl border border-[#d9d5ca] bg-[#f8f6f0] px-4 py-3 text-sm text-[#606a62]">
            This is an untimed request and does not require an appointment slot.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <input
            required
            name="name"
            placeholder="Customer name"
            value={formData.name}
            onChange={onChange}
            className={fieldClass}
          />
          <input
            required
            type="email"
            name="email"
            placeholder="Customer email"
            value={formData.email}
            onChange={onChange}
            className={fieldClass}
          />
          <input
            name="phone"
            placeholder="Phone number"
            value={formData.phone}
            onChange={onChange}
            className={fieldClass}
          />
        </div>

        <textarea
          rows="3"
          name="message"
          placeholder={
            selectedService?.booking_mode === "untimed"
              ? "Voice memo topic or question..."
              : "Internal or customer notes..."
          }
          value={formData.message}
          onChange={onChange}
          className={fieldClass}
        />

        <button
          type="submit"
          disabled={creating || !selectedService}
          className="w-fit rounded-xl bg-[#365d3c] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#2d5133] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create Booking"}
        </button>
      </form>
    </section>
  );
}
