import { motion } from "framer-motion";

export default function BookingHero() {
  return (
    <section className="border-b border-stone-300/40 pb-12">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="max-w-3xl"
      >
        <p className="mb-4 text-sm uppercase tracking-[0.3em] text-stone-500">
          Reservations
        </p>

        <h1 className="mb-6 text-5xl leading-tight text-stone-800 md:text-7xl">
          Book an Experience
        </h1>

        <p className="max-w-xl text-lg leading-relaxed text-stone-600">
          Select a date and time for your visit. A quiet and considered booking
          experience designed to feel calm, minimal, and effortless.
        </p>
      </motion.div>
    </section>
  );
}
