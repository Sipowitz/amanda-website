import { motion } from "framer-motion";
import { format } from "date-fns";
import { formatSlotTime } from "../../utils/slotTime";

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
  submitLabel,
  formData,
  onFormDataChange,
  showDiscountCode = false,
  discountCode = "",
  appliedDiscountQuote = null,
  discountState = "idle",
  discountMessage = "",
  onDiscountCodeChange,
  onApplyDiscount,
  onRemoveDiscount,
}) {
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
    onFormDataChange((previous) => ({ ...previous, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(formData);
  }

  function handleDiscountKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!loading && !disabled && discountCode.trim()) onApplyDiscount?.();
    }
  }

  const readableDate = selectedSlot
    ? format(new Date(`${selectedSlot.slot_date}T12:00:00`), "EEEE, MMMM d")
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
              {readableDate} - {formatSlotTime(selectedSlot.slot_time)}
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

      {showDiscountCode && (
        <section aria-labelledby="discount-code-heading" className="rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label id="discount-code-heading" htmlFor="discount-code" className="text-sm font-medium text-[#f1e8ca]">
                Discount code <span className="text-[#f1e8ca]/55">(optional)</span>
              </label>
              <input
                id="discount-code"
                name="discount-code"
                type="text"
                autoComplete="off"
                value={discountCode}
                onChange={(event) => onDiscountCodeChange?.(event.target.value)}
                onKeyDown={handleDiscountKeyDown}
                disabled={loading || disabled}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-[#f1e8ca] placeholder:text-[#f1e8ca]/35 outline-none transition focus:border-[#f1e8ca]/40 disabled:opacity-55"
                placeholder="Enter code"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onApplyDiscount}
                disabled={loading || disabled || discountState === "applying" || !discountCode.trim()}
                className="min-h-11 rounded-xl border border-[#f1e8ca]/25 px-5 py-2.5 text-sm font-medium text-[#f1e8ca] transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-55"
              >
                {discountState === "applying" ? "Applying…" : "Apply"}
              </button>
              {appliedDiscountQuote && (
                <button type="button" onClick={onRemoveDiscount} disabled={loading || disabled} className="min-h-11 rounded-xl px-3 py-2 text-sm text-[#f1e8ca]/70 transition hover:text-[#f1e8ca] disabled:opacity-55">
                  Remove
                </button>
              )}
            </div>
          </div>

          {discountMessage && <p role="status" className="mt-3 text-sm text-[#f1e8ca]/75">{discountMessage}</p>}
          {appliedDiscountQuote && (
            <div className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-sm text-[#f1e8ca]/80">
              <div className="flex items-center justify-between gap-4"><span>Original price</span><span>{(appliedDiscountQuote.original_amount_minor / 100).toLocaleString("en-US", { style: "currency", currency: appliedDiscountQuote.currency })}</span></div>
              <div className="flex items-center justify-between gap-4 text-[#f1e8ca]"><span>Discount ({appliedDiscountQuote.canonical_code})</span><span>−{(appliedDiscountQuote.discount_amount_minor / 100).toLocaleString("en-US", { style: "currency", currency: appliedDiscountQuote.currency })}</span></div>
              <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2 font-medium text-[#f1e8ca]"><span>Final amount due</span><span>{(appliedDiscountQuote.final_amount_minor / 100).toLocaleString("en-US", { style: "currency", currency: appliedDiscountQuote.currency })}</span></div>
            </div>
          )}
        </section>
      )}

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
            ? submitLabel || "Confirm Booking"
            : submitLabel || "Request Voice Memo Reading"}
      </button>
    </motion.form>
  );
}
