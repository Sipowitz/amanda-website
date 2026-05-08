import { motion } from "framer-motion";

import Navbar from "../components/Navbar";

export default function MainLayout({ children }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#9ebd9e] text-[#f1e8ca]">
      {/* Atmospheric Background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Main light beam */}
        <motion.div
          animate={{
            x: [0, 80, 0],
            y: [0, -40, 0],
            rotate: [0, 6, 0],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute left-[-20%] top-[-10%] h-[1200px] w-[700px] rounded-full bg-white/[0.14] blur-3xl"
        />

        {/* Secondary green depth */}
        <motion.div
          animate={{
            x: [0, -60, 0],
            y: [0, 60, 0],
            rotate: [0, -8, 0],
          }}
          transition={{
            duration: 24,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute bottom-[-30%] right-[-10%] h-[1000px] w-[800px] rounded-full bg-[#5f785f]/45 blur-3xl"
        />

        {/* Central mist */}
        <motion.div
          animate={{
            opacity: [0.18, 0.3, 0.18],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.06] blur-3xl"
        />

        {/* Top atmospheric glow */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.08] via-transparent to-black/30" />

        {/* Stronger vignette */}
        <div className="absolute inset-0 bg-black/[0.18]" />

        {/* Focus layer behind content */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/[0.12] via-transparent to-black/[0.08]" />
      </div>

      {/* Grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "url('https://grainy-gradients.vercel.app/noise.svg')",
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        <Navbar />

        <main className="flex-1 pt-24">{children}</main>
      </div>
    </div>
  );
}
