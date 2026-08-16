import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const services = [
  {
    title: "Private Readings",
    description:
      "One-to-one intuitive sessions offering insight, clarity and a fresh perspective on the questions and situations that matter to you.",
  },
  {
    title: "Parties & Gatherings",
    description:
      "Intuitive readings for private parties, celebrations and gatherings, creating a memorable and engaging experience for your guests.",
  },
  {
    title: "Corporate & Public Events",
    description:
      "Professional intuitive services for corporate functions, public events, festivals and other larger gatherings.",
  },
];

export default function Services() {
  return (
    <section className="px-6 pb-24">
      <div className="mx-auto w-full max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.8,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="max-w-5xl"
        >
          <p className="mb-4 text-sm uppercase tracking-[0.35em] text-[#f1e8ca]/60">
            Services
          </p>

          <h1 className="mb-8 text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">
            Ways to Work Together
          </h1>

          <p className="mb-16 max-w-4xl text-lg leading-[1.9] text-[#f1e8ca]/80">
            From private intuitive readings to parties and larger events,
            sessions can be tailored to create a personal, engaging and
            memorable experience.
          </p>

          <div className="space-y-6">
            {services.map((service, index) => (
              <motion.div
                key={service.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.7,
                  delay: 0.1 + index * 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md md:p-10"
              >
                <h2 className="mb-4 text-3xl font-light text-[#f1e8ca]">
                  {service.title}
                </h2>

                <p className="max-w-3xl text-lg leading-[1.8] text-[#f1e8ca]/75">
                  {service.description}
                </p>
              </motion.div>
            ))}

            <div className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md md:p-10">
              <p className="mb-3 text-sm uppercase tracking-[0.28em] text-[#f1e8ca]/55">
                Private Readings
              </p>

              <h2 className="mb-4 text-3xl font-light text-[#f1e8ca]">
                Ready to Book?
              </h2>

              <p className="mb-7 max-w-3xl text-lg leading-[1.8] text-[#f1e8ca]/75">
                View available dates and request a private reading with Amanda.
              </p>

              <Link
                to="/booking"
                className="inline-flex items-center gap-3 rounded-full border border-[#f1e8ca]/30 px-6 py-3 text-sm font-medium uppercase tracking-[0.18em] text-[#f1e8ca] transition-all duration-300 hover:border-[#f1e8ca]/60 hover:bg-white/10"
              >
                Book a Reading
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}