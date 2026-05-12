import { motion } from "framer-motion";

import heroImage from "../assets/hero-image.jpg";

export default function Hero() {
  return (
    <section className="relative px-6 pb-24 pt-10">
      <div className="mx-auto grid w-full max-w-7xl gap-10 md:grid-cols-2 md:items-center">
        {/* Left Content */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 1,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="max-w-2xl"
        >
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.35em] text-[#f1e8ca]/65">
            Personal Brand
          </p>

          <h1 className="text-5xl font-light leading-[0.95] text-[#f1e8ca] sm:text-6xl md:text-[6rem]">
            Elegant digital experiences for modern businesses.
          </h1>

          <p className="mt-6 max-w-lg text-lg leading-[1.9] text-[#f1e8ca]/85">
            Creating refined and thoughtful websites that communicate your brand
            with clarity and confidence.
          </p>

          <button className="mt-8 rounded-full border border-[#f1e8ca]/30 px-8 py-4 text-sm uppercase tracking-[0.2em] text-[#f1e8ca] transition hover:bg-[#f1e8ca] hover:text-[#6f876f]">
            Learn More
          </button>
        </motion.div>

        {/* Right Image */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: 1.4,
            delay: 0.2,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="relative aspect-[4/5] overflow-hidden rounded-[2rem]"
        >
          <img
            src={heroImage}
            alt="Atmospheric portrait"
            className="h-full w-full object-cover"
          />

          {/* Atmospheric overlay */}
          <div className="absolute inset-0 bg-black/10" />

          {/* Soft gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-white/5" />
        </motion.div>
      </div>
    </section>
  );
}
