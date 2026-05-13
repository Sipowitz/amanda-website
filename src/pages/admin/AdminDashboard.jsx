import { Link, useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

export default function AdminDashboard() {
  const navigate = useNavigate();

  const { logout } = useAdminAuth();

  async function handleLogout() {
    try {
      await logout();

      navigate("/");
    } catch (error) {
      console.error(error);

      alert("Failed to logout");
    }
  }

  return (
    <div className="flex flex-col gap-16">
      <AdminHeader
        title="Admin Dashboard"
        subtitle="Booking Management"
        onLogout={handleLogout}
      />

      <section className="grid gap-6 md:grid-cols-2">
        <Link
          to="/admin/slots"
          className="rounded-[2.5rem] border border-white/10 bg-black/10 p-8 backdrop-blur-xl transition hover:border-[#f1e8ca]/20"
        >
          <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
            Management
          </p>

          <h2 className="mb-4 text-3xl text-[#f1e8ca]">Booking Slots</h2>

          <p className="text-[#f1e8ca]/60">
            Generate availability, manage bookings, and maintain scheduling.
          </p>
        </Link>
      </section>
    </div>
  );
}
