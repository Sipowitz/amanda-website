import { useEffect, useState } from "react";

import { Outlet } from "react-router-dom";

import { AnimatePresence, motion } from "framer-motion";

import AdminSidebar from "./AdminSidebar";

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen bg-[#f6f4ee] text-[#202620]">
      <header className="sticky top-0 z-40 border-b border-[#d9dfd6] bg-[#f8f7f2]/95 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#5f6f60]">Amanda Beach</p>
            <p className="mt-1 font-serif text-xl text-[#1f251f]">Admin</p>
          </div>
          <button type="button" onClick={() => setSidebarOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d1d8cf] bg-white text-[#304030] shadow-sm" aria-label="Open admin navigation">☰</button>
        </div>
      </header>

      <div className="mx-auto grid min-h-screen w-full max-w-[1700px] lg:grid-cols-[265px_minmax(0,1fr)]">
        <aside className="hidden bg-[#385845] lg:sticky lg:top-0 lg:block lg:h-screen">
          <AdminSidebar />
        </aside>

        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.button type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm lg:hidden" aria-label="Close admin navigation" />
              <motion.aside initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: "spring", damping: 28, stiffness: 280 }} className="fixed inset-y-0 left-0 z-50 w-[285px] bg-[#385845] shadow-2xl lg:hidden">
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
                    <div><p className="text-[10px] uppercase tracking-[0.3em] text-[#f4efdc]/60">Amanda Beach</p><p className="mt-1 font-serif text-xl text-[#fff8e7]">Admin</p></div>
                    <button type="button" onClick={() => setSidebarOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[#fff8e7]" aria-label="Close admin navigation">✕</button>
                  </div>
                  <AdminSidebar mobile onNavigate={() => setSidebarOpen(false)} />
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <main className="min-w-0 bg-[radial-gradient(circle_at_top_right,rgba(164,187,164,0.14),transparent_28%)] px-5 py-7 sm:px-7 lg:px-10 lg:py-10 xl:px-14">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
