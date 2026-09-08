import AdminHeader from "../../components/admin/AdminHeader";
import AdminEmailSettings from "./AdminEmailSettings";
import { useNavigate } from "react-router-dom";
import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { useToast } from "../../contexts/ToastContext";

export default function AdminSettings() {
  const navigate = useNavigate();
  const { logout } = useAdminAuth();
  const confirm = useConfirm();
  const toast = useToast();

  async function handleLogout() {
    const accepted = await confirm({ title: "Logout", message: "Are you sure you want to logout?", confirmText: "Logout" });
    if (!accepted) return;
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
    <div className="flex flex-col gap-10">
      <AdminHeader
        title="Settings"
        subtitle="Notifications & reminders"
        description="Manage the settings Amanda uses day to day."
        onLogout={handleLogout}
      />
      <AdminEmailSettings embedded />
    </div>
  );
}
