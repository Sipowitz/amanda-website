import { motion } from "framer-motion";

import heroImage from "../assets/hero-image.jpg";

export default function About() {
  return (
    <section className="min-h-[75vh] px-6 pb-24 pt-3">
      <div className="mx-auto w-full max-w-7xl">
        <motion.div
          initial={{
            opacity: 0,
            y: 30,
          }}
          animate={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration: 1,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <p className="mb-8 text-sm font-medium uppercase tracking-[0.35em] text-[#f1e8ca]/65">
            About Amanda Beach
          </p>

          <div className="grid items-start gap-12 md:grid-cols-[1.1fr_0.9fr] md:gap-20">
            <div>
              <h1 className="text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">
                A thoughtful and personal approach.
              </h1>

              <div className="mt-12 max-w-3xl space-y-7 text-lg leading-[1.9] text-[#f1e8ca]/80">
                <p>
                  For more than twenty years, I’ve worked at the intersection of
                  intuition and strategy — helping people see what’s actually
                  happening beneath the surface and make decisions that create
                  real momentum.
                </p>

                <p>
                  My work isn’t just mystical. It’s tarot, pattern recognition,
                  emotional intelligence, and lived experience distilled into
                  clarity you can act on.
                </p>
              </div>
            </div>

            <motion.div
              initial={{
                opacity: 0,
                x: 30,
              }}
              animate={{
                opacity: 1,
                x: 0,
              }}
              transition={{
                duration: 1,
                delay: 0.2,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="flex w-full justify-center"
            >
              <img
                src={heroImage}
                alt="Portrait of Amanda Beach"
                className="h-auto w-full max-w-[340px] rounded-[8px] object-cover object-center shadow-[0_18px_44px_rgba(22,34,22,0.17),0_4px_12px_rgba(22,34,22,0.06),inset_0_1px_0_rgba(241,232,202,0.12)] ring-1 ring-inset ring-[#f1e8ca]/12"
              />
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
