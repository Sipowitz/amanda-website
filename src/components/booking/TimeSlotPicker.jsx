import { motion } from "framer-motion";

export default function TimeSlotPicker({ slots, selectedSlot, onSelectSlot }) {
  if (!slots.length) {
    return (
      <div className="rounded-[2rem] border border-[#f1e8ca]/16 bg-white/[0.06] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl">
        <p className="text-[#f1e8ca]/60">No available times for this date.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {slots.map((slot) => {
        const isActive = selectedSlot?.id === slot.id;

        return (
          <motion.button
            key={slot.id}
            whileHover={{
              y: -3,
            }}
            whileTap={{
              scale: 0.985,
            }}
            transition={{
              duration: 0.18,
            }}
            onClick={() => onSelectSlot(slot)}
            className={`group relative overflow-hidden rounded-[1.6rem] border px-4 py-5 text-center backdrop-blur-xl transition-all duration-300 ${
              isActive
                ? "border-[#f1e8ca]/45 bg-[#f1e8ca]/16 shadow-[0_0_35px_rgba(241,232,202,0.12)]"
                : "border-[#f1e8ca]/16 bg-white/[0.06] shadow-[0_12px_30px_rgba(0,0,0,0.10)] hover:border-[#f1e8ca]/28 hover:bg-[#f1e8ca]/08 hover:shadow-[0_18px_40px_rgba(0,0,0,0.14)]"
            }`}
          >
            {/* Soft glow */}
            <div
              className={`absolute inset-0 transition-opacity duration-300 ${
                isActive
                  ? "bg-[radial-gradient(circle_at_center,rgba(241,232,202,0.12),transparent_72%)] opacity-100"
                  : "bg-[radial-gradient(circle_at_center,rgba(241,232,202,0.08),transparent_72%)] opacity-0 group-hover:opacity-100"
              }`}
            />

            <div className="relative flex flex-col items-center justify-center">
              <span
                className={`text-base tracking-[0.08em] transition-colors duration-300 sm:text-lg ${
                  isActive
                    ? "font-medium text-[#fff7df]"
                    : "font-light text-[#f1e8ca]"
                }`}
              >
                {slot.slot_time}
              </span>

              <span
                className={`mt-3 h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                  isActive
                    ? "bg-[#fff7df] shadow-[0_0_10px_rgba(255,247,223,0.9)]"
                    : "bg-[#f1e8ca]/45 group-hover:bg-[#f1e8ca]/75"
                }`}
              />
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
