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

          <div className="space-y-6">
            {/* Contact Details */}
            <div className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md">
              <h2 className="mb-6 text-3xl font-light text-[#f1e8ca]">
                Contact Details
              </h2>

              <div className="space-y-4 text-lg">
                <p className="text-[#f1e8ca]/80">
                  <span className="font-medium text-[#f1e8ca]">Email:</span>{" "}
                  <a
                    href="mailto:reach.amanda.beach@gmail.com"
                    className="transition-colors duration-300 hover:text-[#f8f1d7]"
                  >
                    reach.amanda.beach@gmail.com
                  </a>
                </p>

                <p className="text-[#f1e8ca]/80">
                  <span className="font-medium text-[#f1e8ca]">Phone:</span>{" "}
                  <a
                    href="tel:+18314406599"
                    className="transition-colors duration-300 hover:text-[#f8f1d7]"
                  >
                    (831) 440-6599
                  </a>
                </p>

                <p className="text-[#f1e8ca]/80">
                  <span className="font-medium text-[#f1e8ca]">
                    Service Area:
                  </span>{" "}
                  Available for private sessions, parties, and public events.
                </p>
              </div>
            </div>

            {/* Socials */}
            <div className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md">
              <h2 className="mb-6 text-3xl font-light text-[#f1e8ca]">
                Socials
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <a
                  href="https://www.tiktok.com/@amandabeachintuitive?_r=1&_t=ZT-98vbapFjf37"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-5 py-4 transition-all duration-300 hover:border-white/20 hover:bg-white/10"
                >
                  <div>
                    <p className="text-sm uppercase tracking-[0.2em] text-[#f1e8ca]/60">
                      TikTok
                    </p>

                    <p className="mt-1 text-lg text-[#f1e8ca]">
                      @amandabeachintuitive
                    </p>
                  </div>

                  <span className="ml-4 text-xl text-[#f1e8ca]/60 transition-all duration-300 group-hover:translate-x-1 group-hover:text-[#f1e8ca]">
                    →
                  </span>
                </a>

                <a
                  href="https://www.instagram.com/herbeachness?igsh=cGRqN255Z2FhY3Nn&utm_source=qr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-5 py-4 transition-all duration-300 hover:border-white/20 hover:bg-white/10"
                >
                  <div>
                    <p className="text-sm uppercase tracking-[0.2em] text-[#f1e8ca]/60">
                      Instagram
                    </p>

                    <p className="mt-1 text-lg text-[#f1e8ca]">
                      @herbeachness
                    </p>
                  </div>

                  <span className="ml-4 text-xl text-[#f1e8ca]/60 transition-all duration-300 group-hover:translate-x-1 group-hover:text-[#f1e8ca]">
                    →
                  </span>
                </a>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}