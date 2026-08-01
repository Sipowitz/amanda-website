import { NavLink } from "react-router-dom";

const links = [
  { label: "Dashboard", path: "/admin/dashboard", icon: "⌂" },
  { label: "Bookings", path: "/admin/bookings", icon: "▣" },
  { label: "Availability", path: "/admin/availability", icon: "◇" },
  { label: "Settings", path: "/admin/settings", icon: "⚙" },
];

export default function AdminSidebar({ onNavigate, mobile = false }) {
  return (
    <div className={`flex h-full flex-col ${mobile ? "p-5" : "px-5 py-8"}`}>
      {!mobile && (
        <div className="mb-10 px-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[#f4efdc]/65">Amanda Beach</p>
          <h2 className="mt-3 font-serif text-3xl font-normal text-[#fff8e7]">Admin</h2>
        </div>
      )}
      <nav className="flex flex-col gap-2">
        {links.map((link) => (
          <NavLink key={link.path} to={link.path} onClick={onNavigate} className={({ isActive }) => `group flex items-center gap-3 rounded-xl border px-4 py-3.5 text-sm font-medium transition ${isActive ? "border-white/20 bg-white/15 text-white shadow-inner" : "border-transparent text-white/78 hover:bg-white/8 hover:text-white"}`}>
            {({ isActive }) => (<>
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${isActive ? "border-white/20 bg-white/12" : "border-white/10 bg-black/5"}`}>{link.icon}</span>
              <span>{link.label}</span>
              <span className={`ml-auto transition ${isActive ? "opacity-70" : "opacity-0 group-hover:opacity-50"}`}>→</span>
            </>)}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto px-3 pt-8">
        <div className="border-t border-white/12 pt-5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#f4efdc]/50">Booking Management</p>
          <p className="mt-2 text-xs leading-relaxed text-white/55">Private administration area</p>
        </div>
      </div>
    </div>
  );
}
