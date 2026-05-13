import { NavLink } from "react-router-dom";

const links = [
  {
    label: "Dashboard",
    path: "/admin/dashboard",
  },
  {
    label: "Bookings",
    path: "/admin/bookings",
  },
  {
    label: "Availability",
    path: "/admin/availability",
  },
  {
    label: "Settings",
    path: "/admin/settings",
  },
];

export default function AdminSidebar({ onNavigate, mobile = false }) {
  return (
    <aside
      className={
        mobile
          ? "flex flex-col"
          : "relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-black/10 p-5 backdrop-blur-2xl"
      }
    >
      {/* Atmosphere */}
      {!mobile && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.07),transparent_38%)]" />

          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.025] to-black/[0.08]" />
        </div>
      )}

      <div className="relative z-10">
        {!mobile && (
          <div className="mb-8 px-2">
            <p className="mb-3 text-xs uppercase tracking-[0.3em] text-[#f1e8ca]/40">
              Navigation
            </p>

            <h2 className="text-2xl text-[#f1e8ca]">Admin</h2>
          </div>
        )}

        <nav className="flex flex-col gap-2">
          {links.map((link) => (
            <NavLink
              key={link.path}
              to={link.path}
              onClick={onNavigate}
              className={({ isActive }) =>
                `group relative overflow-hidden rounded-2xl px-4 py-3.5 text-sm uppercase tracking-[0.18em] backdrop-blur-xl transition-all duration-300 ${
                  isActive
                    ? "border border-[#f1e8ca]/12 bg-[#f1e8ca]/12 text-[#f1e8ca]"
                    : "border border-transparent text-[#f1e8ca]/55 hover:border-white/10 hover:bg-white/[0.04] hover:text-[#f1e8ca]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Hover Glow */}
                  <div
                    className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
                      isActive
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,rgba(255,255,255,0.06),transparent_55%)]" />
                  </div>

                  <div className="relative z-10 flex items-center justify-between">
                    <span>{link.label}</span>

                    <span
                      className={`text-xs transition-transform duration-300 ${
                        isActive
                          ? "translate-x-0 opacity-100"
                          : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                      }`}
                    >
                      →
                    </span>
                  </div>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  );
}
