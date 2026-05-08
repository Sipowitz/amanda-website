import { useState } from "react";
import { Link } from "react-router-dom";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { name: "About", path: "/about" },
    { name: "Booking", path: "/booking" },
    { name: "Events", path: "/events" },
    { name: "Shop", path: "/shop" },
  ];

  return (
    <>
      <header className="fixed top-0 z-50 w-full backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-8">
          <Link to="/" className="text-3xl font-medium tracking-[0.25em]">
            Amanda
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden gap-10 md:flex">
            {links.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="text-xs font-semibold uppercase tracking-[0.25em] text-[#f1e8ca]/90 transition hover:text-[#f1e8ca]"
              >
                {link.name}
              </Link>
            ))}
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex flex-col gap-1 md:hidden"
            aria-label="Toggle Menu"
          >
            <span className="h-[2px] w-6 bg-[#f1e8ca]" />
            <span className="h-[2px] w-6 bg-[#f1e8ca]" />
          </button>
        </div>
      </header>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-10 bg-[#8ea98e]/95 backdrop-blur-xl">
          {links.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              onClick={() => setMenuOpen(false)}
              className="text-4xl font-medium text-[#f1e8ca]"
            >
              {link.name}
            </Link>
          ))}

          <button
            onClick={() => setMenuOpen(false)}
            className="absolute right-6 top-8 text-sm uppercase tracking-[0.2em] text-[#f1e8ca]/70"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
