import { useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

import { useToast } from "../../contexts/ToastContext";

import { useConfirm } from "../../contexts/ConfirmContext";

export default function AdminSettings() {
  const navigate = useNavigate();

  const { logout } = useAdminAuth();

  const toast = useToast();

  const confirm = useConfirm();

  async function handleLogout() {
    const confirmed = await confirm({
      title: "Logout",
      message: "Are you sure you want to logout?",
      confirmText: "Logout",
    });

    if (!confirmed) {
      return;
    }

    try {
      await logout();

      navigate("/");

      toast.success("Logged out successfully");
    } catch (error) {
      console.error(error);

      toast.error("Failed to logout");
    }
  }

  return (
    <div className="flex flex-col gap-16">
      <AdminHeader
        title="Settings"
        subtitle="System Configuration"
        onLogout={handleLogout}
      />

      <section className="rounded-[2.5rem] border border-white/10 bg-black/10 p-10 backdrop-blur-xl">
        <p className="mb-4 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
          Coming Soon
        </p>

        <h2 className="mb-4 text-4xl text-[#f1e8ca]">Admin Settings</h2>

        <p className="max-w-2xl text-[#f1e8ca]/60">
          This page will eventually contain business settings, booking rules,
          availability defaults, and administrative configuration.
        </p>
      </section>
    </div>
  );
}
