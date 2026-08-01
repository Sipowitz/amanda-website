import { motion } from "framer-motion";

export default function SlotItem({ slot, onDelete, onDeleteBooking }) {
  const booked = slot.bookings?.length > 0;

  const booking = booked ? slot.bookings[0] : null;

  return (
    <motion.div
      layout
      initial={{
        opacity: 0,
        y: 12,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      className={`overflow-hidden rounded-[1.8rem] border p-5 transition-all duration-300 ${
        booked
          ? "border-[#f1e8ca]/18 bg-[#f1e8ca]/06"
          : "border-white/8 bg-[#f7f8f5]"
      }`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3">
            {/* Time */}
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                  booked
                    ? "bg-[#f1e8ca] shadow-[0_0_14px_rgba(241,232,202,0.8)]"
                    : "bg-[#f1e8ca]/35"
                }`}
              />

              <p className="text-xl text-[#202620]">{slot.slot_time}</p>
            </div>

            {booked ? (
              <div className="flex min-w-0 flex-col gap-3 pl-5">
                {/* Customer */}
                <div className="min-w-0">
                  <p className="mb-2 text-sm uppercase tracking-[0.18em] text-[#202620]/45">
                    Reserved
                  </p>

                  <p className="break-words text-lg text-[#202620]">
                    {booking.customer_name}
                  </p>
                </div>

                {/* Contact */}
                <div className="flex min-w-0 flex-col gap-1 text-sm text-[#202620]/65">
                  <span className="break-all">{booking.customer_email}</span>

                  {booking.customer_phone && (
                    <span className="break-all">{booking.customer_phone}</span>
                  )}
                </div>

                {/* Message */}
                {booking.customer_message && (
                  <div className="max-w-full overflow-hidden rounded-2xl border border-[#d9dfd6] bg-[#f3f5f1] p-4">
                    <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[#202620]/40">
                      Message
                    </p>

                    <p className="break-words text-sm leading-relaxed text-[#202620]/60">
                      {booking.customer_message}
                    </p>
                  </div>
                )}

                <button
                  onClick={() => onDeleteBooking(booking.id, slot.id)}
                  className="mt-2 w-fit rounded-full border border-[#b9c9b7] bg-[#f1e8ca]/08 px-4 py-2 text-xs uppercase tracking-[0.18em] text-[#202620]/70 transition hover:border-[#789478] hover:bg-[#dce8da] hover:text-[#202620]"
                >
                  Cancel Booking
                </button>
              </div>
            ) : (
              <p className="pl-5 text-sm uppercase tracking-[0.18em] text-[#202620]/38">
                Available
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 items-start">
          <button
            onClick={() => onDelete(slot.id)}
            className="rounded-full border border-[#d9dfd6] bg-[#f7f8f5] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[#202620]/55 transition hover:border-red-300/20 hover:text-red-200"
          >
            Delete
          </button>
        </div>
      </div>
    </motion.div>
  );
}
