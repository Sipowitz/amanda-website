import { Link } from "react-router-dom";

export default function Navbar() {
  const links = [
    { name: "About", path: "/about" },
    { name: "Booking", path: "/booking" },
    { name: "Events", path: "/events" },
    { name: "Shop", path: "/shop" },
  ];

  return (
    <header className="fixed top-0 z-50 w-full backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-8">
        <Link
          to="/"
          className="text-2xl font-light uppercase tracking-[0.35em]"
        >
          Amanda
        </Link>

        <nav className="hidden gap-10 md:flex">
          {links.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className="text-sm font-semibold uppercase tracking-[0.18em] transition hover:opacity-60"
            >
              {link.name}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
