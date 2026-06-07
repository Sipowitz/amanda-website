import { motion } from "framer-motion";

export default function Contact() {
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
            Contact
          </p>

          <h1 className="mb-8 text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">
            Get in Touch
          </h1>

          <p className="mb-16 max-w-4xl text-lg leading-[1.9] text-[#f1e8ca]/80">
            Whether you're interested in a private reading, booking an event, or
            simply have a question, I'd love to hear from you.
          </p>

          <div className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md">
            <h2 className="mb-6 text-3xl font-light text-[#f1e8ca]">
              Contact Details
            </h2>

            <div className="space-y-4 text-lg">
              <p className="text-[#f1e8ca]/80">
                <span className="font-medium text-[#f1e8ca]">Email:</span>{" "}
                hello@example.com
              </p>

              <p className="text-[#f1e8ca]/80">
                <span className="font-medium text-[#f1e8ca]">Phone:</span> (555)
                123-4567
              </p>

              <p className="text-[#f1e8ca]/80">
                <span className="font-medium text-[#f1e8ca]">
                  Service Area:
                </span>{" "}
                Available for private sessions, parties, public events, and
                corporate bookings.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
