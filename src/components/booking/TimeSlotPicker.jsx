import { motion } from "framer-motion";

export default function TimeSlotPicker({ slots, selectedSlot, onSelectSlot }) {
  if (!slots.length) {
    return (
      <div className="rounded-3xl border border-stone-300/40 bg-stone-100/40 p-8">
        <p className="text-stone-500">No available times for this date.</p>
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
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelectSlot(slot)}
            className={`rounded-2xl border px-4 py-5 text-center transition-all duration-300 ${
              isActive
                ? "border-stone-800 bg-stone-800 text-stone-100"
                : "border-stone-300/40 bg-stone-100/40 text-stone-700 hover:border-stone-500"
            }`}
          >
            <span className="text-lg">{slot.slot_time}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
