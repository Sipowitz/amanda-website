import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section className="flex min-h-screen items-center px-6 pt-32">
      <div className="mx-auto grid max-w-7xl gap-16 md:grid-cols-2 md:items-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 1.2,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <p className="mb-6 text-sm uppercase tracking-[0.35em] text-[#f1e8ca]/60">
            Personal Brand
          </p>

          <h1 className="mb-8 text-6xl leading-[1.05] font-medium md:text-8xl">
            Elegant digital experiences for modern businesses.
          </h1>

          <p className="max-w-xl text-lg leading-8 text-[#f1e8ca]/80">
            Creating refined and thoughtful websites that communicate your brand
            with clarity and confidence.
          </p>

          <motion.button
            whileHover={{
              scale: 1.03,
            }}
            whileTap={{
              scale: 0.98,
            }}
            className="mt-10 rounded-full border border-[#f1e8ca]/30 px-8 py-3 transition hover:bg-[#f1e8ca] hover:text-[#5f785f]"
          >
            Learn More
          </motion.button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: 1.4,
            delay: 0.2,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="aspect-[4/5] overflow-hidden rounded-[2rem] bg-[#6f876f]/30 backdrop-blur-sm"
        />
      </div>
    </section>
  );
}
