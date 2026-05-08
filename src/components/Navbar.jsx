import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const links = [
    { name: "About", path: "/about" },
    { name: "Booking", path: "/booking" },
    { name: "Events", path: "/events" },
    { name: "Shop", path: "/shop" },
  ];

  return (
    <>
      <header className="fixed top-0 z-50 w-full">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-8">
          <Link to="/" className="text-3xl font-medium tracking-[0.25em]">
            Amanda
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden gap-10 md:flex">
            {links.map((link) => {
              const active = location.pathname === link.path;

              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`text-xs font-semibold uppercase tracking-[0.25em] transition ${
                    active
                      ? "text-[#f1e8ca]"
                      : "text-[#f1e8ca]/75 hover:text-[#f1e8ca]"
                  }`}
                >
                  {link.name}
                </Link>
              );
            })}
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="relative z-50 flex flex-col gap-1.5 md:hidden"
            aria-label="Toggle Menu"
          >
            <motion.span
              animate={{
                rotate: menuOpen ? 45 : 0,
                y: menuOpen ? 7 : 0,
              }}
              transition={{
                duration: 0.3,
              }}
              className="h-[2px] w-6 origin-center bg-[#f1e8ca]"
            />

            <motion.span
              animate={{
                opacity: menuOpen ? 0 : 1,
              }}
              transition={{
                duration: 0.2,
              }}
              className="h-[2px] w-6 bg-[#f1e8ca]"
            />

            <motion.span
              animate={{
                rotate: menuOpen ? -45 : 0,
                y: menuOpen ? -7 : 0,
              }}
              transition={{
                duration: 0.3,
              }}
              className="h-[2px] w-6 origin-center bg-[#f1e8ca]"
            />
          </button>
        </div>
      </header>

      {/* Mobile Menu */}
      <AnimatePresence>
        {menuOpen && (
          <>
            {/* Atmospheric Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
              onClick={() => setMenuOpen(false)}
            />

            {/* Floating Menu */}
            <motion.div
              initial={{
                opacity: 0,
                y: -10,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              exit={{
                opacity: 0,
                y: -6,
              }}
              transition={{
                duration: 0.4,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="fixed inset-x-6 top-24 z-40 rounded-[2rem] bg-[#7f9b7f]/75 p-8 shadow-[0_8px_40px_rgba(0,0,0,0.12)] backdrop-blur-sm md:hidden"
            >
              <nav className="flex flex-col gap-5">
                {links.map((link) => {
                  const active = location.pathname === link.path;

                  return (
                    <Link
                      key={link.path}
                      to={link.path}
                      onClick={() => setMenuOpen(false)}
                      className={`text-lg uppercase tracking-[0.18em] transition ${
                        active
                          ? "text-[#f1e8ca]"
                          : "text-[#f1e8ca]/70 hover:text-[#f1e8ca]"
                      }`}
                    >
                      {link.name}
                    </Link>
                  );
                })}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
