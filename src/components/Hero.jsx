import { motion } from "framer-motion";
import { Link } from "react-router-dom";

import heroImage from "../assets/hero-image.jpg";

export default function Hero() {
  return (
    <section className="relative px-6 pb-0">
      <div className="mx-auto grid w-full max-w-7xl gap-10 md:grid-cols-2 md:items-start">
        {/* Left Content */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 1,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="-mt-8 max-w-2xl"
        >
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.35em] text-[#f1e8ca]/65"></p>

          <h1 className="text-5xl font-light leading-[0.95] text-[#f1e8ca] sm:text-6xl md:text-[6rem]">
            Amanda Beach
          </h1>

          <p className="mt-6 max-w-lg text-lg leading-[1.9] text-[#f1e8ca]/85">
            With two decades of intuitive expertise, Amanda Beach brings a
            polished, glamorous edge to the world of spiritual guidance. Her
            readings are engaging, entertaining, and impeccably accurate - the
            kind of insight sought by leaders, creators, and anyone who moves
            through life like a main character.
          </p>
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
          className="relative h-[360px] overflow-hidden rounded-[2rem]"
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
