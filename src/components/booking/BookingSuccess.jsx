import { motion } from "framer-motion";

export default function BookingSuccess() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-10 backdrop-blur-sm"
    >
      <p className="mb-3 text-sm uppercase tracking-[0.2em] text-[#f1e8ca]/55">
        Reading Requested
      </p>

      <h2 className="mb-4 text-4xl text-[#f1e8ca]">Thank you.</h2>

      <p className="max-w-xl leading-relaxed text-[#f1e8ca]/70">
        Your booking request has been received and is awaiting confirmation. Amanda will review your request shortly and you'll receive an email as soon as your appointment has been confirmed..
      </p>
    </motion.div>
  );
}
