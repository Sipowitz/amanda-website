const fieldClass =
  "rounded-xl border border-[#d9d5ca] bg-white px-4 py-3 text-[#29332b] outline-none transition placeholder:text-[#9a9e98] focus:border-[#6f8c72] focus:ring-2 focus:ring-[#6f8c72]/10";

export default function CreateBookingPanel({
  availableSlots,
  formData,
  onChange,
  onSubmit,
  creating,
}) {
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
          name="slotId"
          value={formData.slotId}
          onChange={onChange}
          className={fieldClass}
        >
          <option value="">Select an available slot</option>
          {availableSlots.map((slot) => (
            <option key={slot.id} value={slot.id}>
              {slot.slot_date} — {slot.slot_time}
            </option>
          ))}
        </select>

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
          placeholder="Internal or customer notes..."
          value={formData.message}
          onChange={onChange}
          className={fieldClass}
        />

        <button
          type="submit"
          disabled={creating}
          className="w-fit rounded-xl bg-[#365d3c] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#2d5133] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create Booking"}
        </button>
      </form>
    </section>
  );
}
