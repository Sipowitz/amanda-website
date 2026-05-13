import { useEffect, useState } from "react";

import { Outlet } from "react-router-dom";

import { AnimatePresence, motion } from "framer-motion";

import AdminSidebar from "./AdminSidebar";

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#9ebd9e] text-[#f1e8ca] [transform:translateZ(0)] [backface-visibility:hidden]">
      {/* Atmospheric Background */}
      <div className="pointer-events-none absolute inset-0 [transform:translateZ(0)] [contain:paint]">
        {/* Base atmosphere */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(95,120,95,0.18),transparent_42%)]" />

        {/* Central glow */}
        <div className="absolute left-1/2 top-[18%] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-white/[0.04] blur-[70px]" />

        {/* Side depth */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/[0.08] via-transparent to-black/[0.06]" />

        {/* Top fade */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.05] via-transparent to-black/[0.12]" />
      </div>

      {/* Grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "url('https://grainy-gradients.vercel.app/noise.svg')",
        }}
      />

      {/* Content */}
      <div className="relative z-10 min-h-screen">
        {/* Mobile Header */}
        <header className="sticky top-0 z-40 border-b border-white/10 bg-[#9ebd9e]/70 backdrop-blur-2xl lg:hidden">
          <div className="flex items-center justify-between px-6 py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[#f1e8ca]/45">
                Admin
              </p>
            </div>

            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl transition hover:bg-white/[0.06]"
              aria-label="Open Admin Navigation"
            >
              <div className="flex flex-col gap-[4px]">
                <span className="h-[2px] w-5 rounded-full bg-[#f1e8ca]" />

                <span className="h-[2px] w-5 rounded-full bg-[#f1e8ca]" />

                <span className="h-[2px] w-5 rounded-full bg-[#f1e8ca]" />
              </div>
            </button>
          </div>
        </header>

        <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[220px_1fr] lg:items-start lg:gap-8 lg:py-10">
          {/* Desktop Sidebar */}
          <aside className="hidden lg:sticky lg:top-10 lg:block">
            <AdminSidebar />
          </aside>

          {/* Mobile Sidebar */}
          <AnimatePresence>
            {sidebarOpen && (
              <>
                {/* Overlay */}
                <motion.button
                  initial={{
                    opacity: 0,
                  }}
                  animate={{
                    opacity: 1,
                  }}
                  exit={{
                    opacity: 0,
                  }}
                  transition={{
                    duration: 0.2,
                  }}
                  onClick={() => setSidebarOpen(false)}
                  className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm lg:hidden"
                  aria-label="Close navigation overlay"
                />

                {/* Drawer */}
                <motion.aside
                  initial={{
                    x: -320,
                  }}
                  animate={{
                    x: 0,
                  }}
                  exit={{
                    x: -320,
                  }}
                  transition={{
                    type: "spring",
                    damping: 26,
                    stiffness: 260,
                  }}
                  className="fixed left-0 top-0 z-50 flex h-screen w-[280px] flex-col border-r border-white/10 bg-[#88a888]/95 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl lg:hidden"
                >
                  {/* Atmosphere */}
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_40%)]" />

                    <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-black/[0.08]" />
                  </div>

                  <div className="relative z-10">
                    <div className="mb-8 flex items-center justify-between">
                      <p className="text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
                        Admin
                      </p>

                      <button
                        onClick={() => setSidebarOpen(false)}
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] transition hover:bg-white/[0.06]"
                        aria-label="Close navigation"
                      >
                        ✕
                      </button>
                    </div>

                    <AdminSidebar
                      mobile
                      onNavigate={() => setSidebarOpen(false)}
                    />
                  </div>
                </motion.aside>
              </>
            )}
          </AnimatePresence>

          {/* Main Content */}
          <main className="min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
