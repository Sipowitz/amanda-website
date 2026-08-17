import { useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";
import AdminCard from "../../components/admin/AdminCard";

import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";

const settingsSections = [
  {
    title: "Business details",
    description:
      "Contact information, business identity and public-facing details.",
    available: false,
  },
  {
    title: "Booking rules",
    description:
      "Default durations, notice periods and future scheduling preferences.",
    available: false,
  },
  {
    title: "Payments",
    description:
      "Manage the Stripe Payment Link used by each booking service.",
    available: true,
    path: "/admin/settings/payments",
  },
  {
    title: "Email settings",
    description:
      "Reminder timing, sending hours and customer eligibility settings.",
    available: true,
    path: "/admin/settings/email",
  },
];

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
    <div className="flex flex-col gap-10">
      <AdminHeader
        title="Settings"
        subtitle="System Configuration"
        description="Manage the business and booking preferences that power the administration area."
        onLogout={handleLogout}
      />

      <div className="grid gap-5 md:grid-cols-2">
        {settingsSections.map((section) => {
          if (section.available) {
            return (
              <button
                key={section.title}
                type="button"
                onClick={() => navigate(section.path)}
                className="group text-left"
              >
                <AdminCard
                  interactive
                  className="h-full p-7"
                >
                  <div className="flex h-full flex-col">
                    <div className="flex items-start justify-between gap-5">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#58705d]">
                          Available
                        </p>

                        <h2 className="mt-3 font-serif text-2xl text-[#202620]">
                          {section.title}
                        </h2>
                      </div>

                      <span className="mt-1 text-xl text-[#506a56] transition duration-200 group-hover:translate-x-1">
                        →
                      </span>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-[#626b62]">
                      {section.description}
                    </p>
                  </div>
                </AdminCard>
              </button>
            );
          }

          return (
            <AdminCard
              key={section.title}
              className="p-7"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#6a766a]">
                Coming soon
              </p>

              <h2 className="mt-3 font-serif text-2xl text-[#202620]">
                {section.title}
              </h2>

              <p className="mt-3 text-sm leading-6 text-[#626b62]">
                {section.description}
              </p>
            </AdminCard>
          );
        })}
      </div>
    </div>
  );
}
