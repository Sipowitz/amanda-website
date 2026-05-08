export default function Navbar() {
  return (
    <header className="fixed top-0 z-50 w-full bg-transparent">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <a href="/" className="text-sm uppercase tracking-[0.3em]">
          Brand
        </a>

        <nav className="hidden gap-8 text-sm md:flex">
          <a href="#about">About</a>
          <a href="#services">Services</a>
          <a href="#contact">Contact</a>
        </nav>
      </div>
    </header>
  );
}
