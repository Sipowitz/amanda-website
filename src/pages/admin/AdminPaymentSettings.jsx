import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import AdminCard from "../../components/admin/AdminCard";
import AdminHeader from "../../components/admin/AdminHeader";
import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { useToast } from "../../contexts/ToastContext";
import {
  getServicePaymentSettings,
  updateServicePaymentSetting,
} from "../../services/adminService";

function formatPrice(service) {
  return (service.price_amount / 100).toLocaleString("en-US", {
    style: "currency",
    currency: service.currency || "USD",
  });
}

export default function AdminPaymentSettings() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingServiceId, setSavingServiceId] = useState(null);
  const navigate = useNavigate();
  const { logout } = useAdminAuth();
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;

    getServicePaymentSettings()
      .then((settings) => {
        if (!cancelled) setServices(settings);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          toast.error(error.message || "Failed to load payment settings");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [toast]);

  function handleLinkChange(serviceId, value) {
    setServices((current) =>
      current.map((service) =>
        service.service_id === serviceId
          ? { ...service, stripe_payment_link_url: value }
          : service,
      ),
    );
  }

  async function handleSave(event, service) {
    event.preventDefault();

    try {
      setSavingServiceId(service.service_id);
      const updated = await updateServicePaymentSetting({
        serviceId: service.service_id,
        paymentLinkUrl: service.stripe_payment_link_url,
      });
      handleLinkChange(
        service.service_id,
        updated.stripe_payment_link_url || "",
      );
      toast.success(`${service.service_name} payment link updated`);
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to update payment link");
    } finally {
      setSavingServiceId(null);
    }
  }

  async function handleLogout() {
    const accepted = await confirm({
      title: "Logout",
      message: "Are you sure you want to logout?",
      confirmText: "Logout",
    });
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
        title="Payment Settings"
        subtitle="System Configuration"
        description="Manage the Stripe Payment Link included in booking confirmation emails for each active service."
        onLogout={handleLogout}
      />

      <button
        type="button"
        onClick={() => navigate("/admin/settings")}
        className="flex w-fit items-center gap-2 text-sm font-medium text-[#536458] transition hover:text-[#2f4835]"
      >
        <span aria-hidden="true">←</span>
        <span>Back to Settings</span>
      </button>

      {loading ? (
        <AdminCard className="p-8">
          <p className="text-sm text-[#687068]">Loading payment settings...</p>
        </AdminCard>
      ) : (
        <div className="flex flex-col gap-5">
          {services.map((service) => (
            <AdminCard key={service.service_id} className="p-7">
              <form
                onSubmit={(event) => handleSave(event, service)}
                className="flex flex-col gap-6"
              >
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#6a766a]">
                    {formatPrice(service)}
                  </p>
                  <h2 className="mt-2 font-serif text-3xl text-[#202620]">
                    {service.service_name}
                  </h2>
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={`payment-link-${service.service_id}`}
                    className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]"
                  >
                    Stripe Payment Link URL
                  </label>
                  <input
                    id={`payment-link-${service.service_id}`}
                    type="url"
                    value={service.stripe_payment_link_url || ""}
                    onChange={(event) =>
                      handleLinkChange(service.service_id, event.target.value)
                    }
                    placeholder="https://buy.stripe.com/..."
                    maxLength="2048"
                    className="admin-input w-full"
                  />
                  <p className="text-xs leading-5 text-[#7a837b]">
                    Leave blank to omit the Pay now button for this service.
                    No Stripe API key is stored here.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={savingServiceId === service.service_id}
                  className="admin-button w-fit"
                >
                  {savingServiceId === service.service_id
                    ? "Saving..."
                    : "Save Payment Link"}
                </button>
              </form>
            </AdminCard>
          ))}
        </div>
      )}
    </div>
  );
}
