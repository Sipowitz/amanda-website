import { useCallback, useEffect, useState } from "react";

import { Link, useLocation, useNavigate } from "react-router-dom";

import { motion } from "framer-motion";

import useTripleActivation from "../hooks/useTripleActivation";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const location = useLocation();

  const navigate = useNavigate();

  const links = [
    {
      name: "Services",
      path: "/services",
    },
    {
      name: "About",
      path: "/about",
    },
    {
      name: "Contact",
      path: "/contact",
    },
  ];

  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const openAdmin = useCallback(() => {
    navigate("/admin");
  }, [navigate]);

  const handleSecretAdminAccess = useTripleActivation(openAdmin);

  function handleMenuButtonClick() {
    setMenuOpen((prev) => !prev);
  }

  function handleServicesClick(event) {
    const openedAdmin = handleSecretAdminAccess();

    if (openedAdmin) {
      event.preventDefault();
    }
  }

  function handleMobileServicesClick(event) {
    handleServicesClick(event);

    setMenuOpen(false);
  }

  return (
    <>
      <header className="fixed top-0 z-50 w-full">
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-transparent" />

        <div className="relative mx-auto flex max-w-7xl items-center justify-end px-6 py-8">
          {/* Desktop Nav */}
          <nav className="hidden items-center gap-12 md:flex">
            {links.map((link) => {
              const active = link.path === "/services"
                ? location.pathname === link.path || location.pathname.startsWith("/services/")
                : location.pathname === link.path;

              return (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={
                    link.path === "/services"
                      ? handleServicesClick
                      : undefined
                  }
                  className={`relative text-[0.95rem] font-medium uppercase tracking-[0.18em] transition-colors duration-300 ${
                    active
                      ? "text-[#f1e8ca]"
                      : "text-[#f1e8ca]/78 hover:text-[#f1e8ca]"
                  }`}
                >
                  {link.name}

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
            onClick={handleMenuButtonClick}
            className="relative z-50 flex h-8 w-8 items-center justify-center md:hidden"
            aria-label="Toggle Menu"
          >
            <motion.span
              animate={{
                rotate: menuOpen ? 45 : 0,
                y: menuOpen ? 0 : -7,
              }}
              transition={{
                duration: 0.28,
              }}
              className="absolute h-[2px] w-6 origin-center rounded-full bg-[#f1e8ca]"
            />

            <motion.span
              animate={{
                opacity: menuOpen ? 0 : 1,
                scaleX: menuOpen ? 0 : 1,
              }}
              transition={{
                duration: 0.18,
              }}
              className="absolute h-[2px] w-6 rounded-full bg-[#f1e8ca]"
            />

            <motion.span
              animate={{
                rotate: menuOpen ? -45 : 0,
                y: menuOpen ? 0 : 7,
              }}
              transition={{
                duration: 0.28,
              }}
              className="absolute h-[2px] w-6 origin-center rounded-full bg-[#f1e8ca]"
            />
          </button>
        </div>
      </header>

      {/* Mobile Menu */}
      <motion.div
        initial={false}
        animate={{
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
        }}
        transition={{
          duration: 0.2,
        }}
        className="fixed inset-0 z-40 bg-[#6f876f]/88 md:hidden"
      >
        <div className="flex min-h-screen flex-col justify-center px-10">
          <nav className="flex flex-col gap-8">
            {links.map((link) => {
              const active = link.path === "/services"
                ? location.pathname === link.path || location.pathname.startsWith("/services/")
                : location.pathname === link.path;

              return (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={
                    link.path === "/services"
                      ? handleMobileServicesClick
                      : () => setMenuOpen(false)
                  }
                  className={`text-3xl uppercase tracking-[0.18em] transition-colors duration-300 ${
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
        </div>
      </motion.div>
    </>
  );
}
