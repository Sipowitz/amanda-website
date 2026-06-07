import { motion } from "framer-motion";

export default function Services() {
  const services = [
    {
      title: "Individual Readings",
      description:
        "Personal tarot and intuitive guidance sessions designed to provide clarity, insight, and confidence in your next steps.",
    },
    {
      title: "Private Parties",
      description:
        "Elegant and engaging readings for birthdays, celebrations, and intimate gatherings, creating memorable experiences for your guests.",
    },
    {
      title: "Public & Corporate Events",
      description:
        "Professional event readings for festivals, corporate functions, and public gatherings, bringing insight, entertainment, and connection to every occasion.",
    },
  ];

  return (
    <section id="services" className="px-6 pt-8 pb-32">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{
            duration: 1,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="mb-8"
        >
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/60">
            Services
          </p>

          <h2 className="text-4xl font-light md:text-5xl">What I Offer</h2>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-3">
          {services.map((service, index) => (
            <motion.div
              key={service.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{
                duration: 0.8,
                delay: index * 0.15,
                ease: [0.22, 1, 0.36, 1],
              }}
              whileHover={{
                y: -6,
              }}
              className="rounded-[2rem] border border-[#f1e8ca]/10 bg-[#6f876f]/20 p-8 backdrop-blur-md"
            >
              <h3 className="mb-4 text-2xl font-light">{service.title}</h3>

              <p className="leading-7 text-[#f1e8ca]/80">
                {service.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}