import { useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";
import AdminCard from "../../components/admin/AdminCard";

import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";

export default function AdminSettings() {
  const navigate = useNavigate();
  const { logout } = useAdminAuth();
  const toast = useToast();
  const confirm = useConfirm();

  async function handleLogout() {
    const confirmed = await confirm({ title: "Logout", message: "Are you sure you want to logout?", confirmText: "Logout" });
    if (!confirmed) return;
    try { await logout(); navigate("/"); toast.success("Logged out successfully"); }
    catch (error) { console.error(error); toast.error("Failed to logout"); }
  }

  return (
    <div className="flex flex-col gap-10">
      <AdminHeader title="Settings" subtitle="System Configuration" description="Manage the business and booking preferences that power the administration area." onLogout={handleLogout} />
      <div className="grid gap-5 md:grid-cols-2">
        {[
          ["Business details", "Contact information, business identity and public-facing details."],
          ["Booking rules", "Default durations, notice periods and future scheduling preferences."],
          ["Payments", "Payment methods, default pricing and receipt behaviour."],
          ["Email", "Sender details, notification preferences and template controls."],
        ].map(([title, text]) => (
          <AdminCard key={title} className="p-7">
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#6a766a]">Coming soon</p>
            <h2 className="mt-3 font-serif text-2xl text-[#202620]">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-[#626b62]">{text}</p>
          </AdminCard>
        ))}
      </div>
    </div>
  );
}
