import { motion } from "framer-motion";

export default function BookingSuccess({ service }) {
  const isTimed = service.booking_mode === "timed";
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-10 backdrop-blur-sm"
    >
      <p className="mb-3 text-sm uppercase tracking-[0.2em] text-[#f1e8ca]/55">
        Request Received
      </p>

      <h2 className="mb-4 text-4xl text-[#f1e8ca]">Thank you.</h2>

      <p className="max-w-xl leading-relaxed text-[#f1e8ca]/70">
        {isTimed
          ? "Your " + service.name + " booking request has been received. Amanda will review it and email you when the appointment is confirmed."
          : "Your " + service.name + " request has been received. Amanda will review your message and follow up by email."}
      </p>
    </motion.div>
  );
}
