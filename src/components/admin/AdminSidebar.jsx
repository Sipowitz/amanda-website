import { NavLink } from "react-router-dom";

const links = [
  {
    label: "Dashboard",
    path: "/admin/dashboard",
  },
  {
    label: "Slots",
    path: "/admin/slots",
  },
];

export default function AdminSidebar() {
  return (
    <aside className="rounded-[2.5rem] border border-white/10 bg-black/10 p-6 backdrop-blur-xl">
      <div className="mb-8">
        <p className="text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
          Admin
        </p>
      </div>

      <nav className="flex flex-col gap-2">
        {links.map((link) => (
          <NavLink
            key={link.path}
            to={link.path}
            className={({ isActive }) =>
              `rounded-2xl px-4 py-3 text-sm uppercase tracking-[0.18em] transition ${
                isActive
                  ? "bg-[#f1e8ca]/12 text-[#f1e8ca]"
                  : "text-[#f1e8ca]/55 hover:bg-white/[0.03] hover:text-[#f1e8ca]"
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
