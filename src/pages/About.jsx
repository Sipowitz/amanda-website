import { motion } from "framer-motion";

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
          className="max-w-5xl"
        >
          <p className="mb-8 text-sm font-medium uppercase tracking-[0.35em] text-[#f1e8ca]/65">
            About Amanda Beach
          </p>

          <h1 className="max-w-5xl text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">
            A thoughtful and personal approach.
          </h1>

          <div className="mt-12 max-w-4xl space-y-8 text-xl leading-[2] text-[#f1e8ca]/88 md:text-2xl">
            <p>
              For more than twenty years, I’ve worked at the intersection of
              intuition and strategy — helping people see what’s actually
              happening beneath the surface and make decisions that create real
              momentum.
            </p>

            <p>
              My work isn’t just mystical. It’s tarot, pattern recognition,
              emotional intelligence, and lived experience distilled into
              clarity you can act on.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}