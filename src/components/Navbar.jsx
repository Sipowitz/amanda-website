import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { motion, AnimatePresence } from "framer-motion";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const [logoClicks, setLogoClicks] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();

  const links = [
    { name: "About", path: "/about" },
    { name: "Booking", path: "/booking" },
    { name: "Events", path: "/events" },
    { name: "Shop", path: "/shop" },
  ];

  function handleLogoClick(event) {
    event.preventDefault();

    const nextClicks = logoClicks + 1;

    setLogoClicks(nextClicks);

    if (nextClicks >= 3) {
      setLogoClicks(0);
      navigate("/admin");
      return;
    }

    setTimeout(() => {
      setLogoClicks(0);
    }, 1200);
  }

  return (
    <>
      <header className="fixed top-0 z-50 w-full">
        {/* Soft atmospheric navbar layer */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-transparent backdrop-blur-[2px]" />

        <div className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-8">
          {/* Logo */}
          <button
            onClick={handleLogoClick}
            className="cursor-pointer text-5xl font-medium tracking-[0.28em] text-[#f1e8ca]"
          >
            Amanda
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-12 md:flex">
            {links.map((link) => {
              const active = location.pathname === link.path;

              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`relative text-[0.95rem] font-medium uppercase tracking-[0.18em] transition duration-300 ${
                    active
                      ? "text-[#f1e8ca]"
                      : "text-[#f1e8ca]/78 hover:text-[#f1e8ca]"
                  }`}
                >
                  {link.name}

                  {/* Underline */}
                  <span
                    className={`absolute -bottom-2 left-0 h-px bg-[#f1e8ca]/70 transition-all duration-300 ${
                      active ? "w-full" : "w-0"
                    }`}
                  />
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

      {/* Mobile Overlay Navigation */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
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
              duration: 0.35,
            }}
            className="fixed inset-0 z-40 bg-[#7f9b7f]/52 backdrop-blur-sm md:hidden"
          >
            {/* Navigation Content */}
            <div className="flex min-h-screen flex-col justify-center px-10">
              <nav className="flex flex-col gap-8">
                {links.map((link) => {
                  const active = location.pathname === link.path;

                  return (
                    <motion.div
                      key={link.path}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.45,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <Link
                        to={link.path}
                        onClick={() => setMenuOpen(false)}
                        className={`text-3xl uppercase tracking-[0.18em] transition ${
                          active
                            ? "text-[#f1e8ca]"
                            : "text-[#f1e8ca]/75 hover:text-[#f1e8ca]"
                        }`}
                      >
                        {link.name}
                      </Link>
                    </motion.div>
                  );
                })}
              </nav>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
