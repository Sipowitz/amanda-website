import { motion } from "framer-motion";

export default function SlotItem({ slot, onDelete }) {
  const booked = (slot.bookings || []).length > 0;
  const status = booked ? "Booked" : slot.is_available ? "Available" : "Unavailable";
  const canDelete = !booked && slot.is_available;

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
      className="overflow-hidden rounded-xl border border-[#dfe4dc] bg-[#fffefa] p-4 transition-all duration-200 hover:border-[#c7d3c6] sm:p-5"
    >
      <div className="flex items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${booked ? "bg-[#789478]" : slot.is_available ? "bg-[#b9c9b7]" : "bg-[#202620]/25"}`} aria-hidden="true" />
          <p className="text-xl text-[#202620]">{slot.slot_time}</p>
          <span className="text-sm text-[#202620]/55">{status}</span>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(slot.id)}
            className="admin-button-danger"
          >
            Delete
          </button>
        )}
      </div>
    </motion.div>
  );
}
