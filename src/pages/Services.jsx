import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const services = [
  {
    slug: "private-readings",
    title: "Private Readings",
    price: "$85",
    description:
      "A full hour to dive into your quandary and get to the heart of the matter.",
    details:
      "In order to limit distractions, readings will take place via a phone call. Clients are welcome to record their readings.",
    action: "Book Private Readings",
    route: "/services/private-readings/book",
  },
  {
    slug: "wheel-of-the-year",
    title: "Wheel of the Year",
    price: "$60",
    description:
      "A 12-card predictive reading, perfect for birthdays, New Year or any new beginning. Typically lasts just under an hour.",
    details:
      "Choose from the shared appointment calendar and Amanda will confirm your session by email.",
    action: "Book Wheel of the Year",
    route: "/services/wheel-of-the-year/book",
  },
  {
    slug: "voice-memo-reading",
    title: "Voice Memo Reading",
    price: "$20",
    description:
      "This is a one-topic reading. A voice memo reading allows you to have the insight and clarity you want, with the flexibility to receive the reading in your own time.",
    details:
      "Be as detailed as you can when forming your request. No appointment time is needed.",
    action: "Request a Voice Memo",
    route: "/services/voice-memo-reading/request",
  },
  {
    slug: "parties-gatherings",
    title: "Parties & Gatherings",
    description:
      "Intuitive readings for private parties, celebrations and gatherings, creating a memorable and engaging experience for your guests.",
  },
  {
    slug: "corporate-public-events",
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
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-5xl"
        >
          <p className="mb-4 text-sm uppercase tracking-[0.35em] text-[#f1e8ca]/60">
            Services
          </p>

          <h1 className="mb-8 text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">
            Ways to Work Together
          </h1>

          <p className="mb-16 max-w-4xl text-lg leading-[1.9] text-[#f1e8ca]/80">
            Choose the service that fits what you need. Timed readings share
            one appointment calendar; voice memo requests need no appointment.
          </p>

          <div className="space-y-6">
            {services.map((service, index) => (
              <motion.div
                key={service.slug}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.7,
                  delay: 0.1 + index * 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md md:p-10"
              >
                <h2 className="text-3xl font-light text-[#f1e8ca]">
                  {service.title}
                </h2>

                {service.price && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-2xl font-light text-[#f1e8ca]">
                      {service.price}
                    </p>
                    {service.priceNote && (
                      <span className="text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/50">
                        {service.priceNote}
                      </span>
                    )}
                  </div>
                )}

                <p className="mt-5 max-w-3xl text-lg leading-[1.8] text-[#f1e8ca]/75">
                  {service.description}
                </p>

                {service.details && (
                  <p className="mt-5 max-w-3xl text-lg leading-[1.8] text-[#f1e8ca]/75">
                    {service.details}
                  </p>
                )}

                {service.route && (
                  <Link
                    to={service.route}
                    className="mt-10 inline-flex items-center gap-3 rounded-full border border-[#f1e8ca]/30 px-6 py-3 text-sm font-medium uppercase tracking-[0.18em] text-[#f1e8ca] transition-all duration-300 hover:border-[#f1e8ca]/60 hover:bg-white/10"
                  >
                    {service.action}
                    <span aria-hidden="true">-&gt;</span>
                  </Link>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
