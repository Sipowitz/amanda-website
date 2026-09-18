import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatLocalTimestamp } from "../../utils/slotTime";

import AdminCard from "../../components/admin/AdminCard";
import AdminHeader from "../../components/admin/AdminHeader";
import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { useToast } from "../../contexts/ToastContext";
import {
  createAdminDiscountCode,
  getAdminDiscountCodes,
  getEligibleDiscountServices,
  setAdminDiscountCodeEnabled,
  updateAdminDiscountCode,
} from "../../services/adminService";

const emptyForm = {
  code: "",
  percentageOff: "",
  scope: "all",
  selectedServiceIds: [],
  expiresAt: "",
  enabled: true,
};

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatExpiry(value) {
  return value ? formatLocalTimestamp(value) : "No expiry";
}

function friendlyError(error, fallback) {
  if (/administrator access|required|permission denied/i.test(error?.message || "")) {
    return "You do not have permission to manage discount codes.";
  }
  return fallback;
}

export default function AdminDiscounts() {
  const [discounts, setDiscounts] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [formError, setFormError] = useState("");
  const navigate = useNavigate();
  const { logout } = useAdminAuth();
  const confirm = useConfirm();
  const toast = useToast();

  const serviceNames = useMemo(
    () => new Map(services.map((service) => [service.id, service.name])),
    [services],
  );

  async function load() {
    const [codes, eligibleServices] = await Promise.all([
      getAdminDiscountCodes(),
      getEligibleDiscountServices(),
    ]);
    setDiscounts(codes);
    setServices(eligibleServices);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAdminDiscountCodes(), getEligibleDiscountServices()])
      .then(([codes, eligibleServices]) => {
        if (cancelled) return;
        setDiscounts(codes);
        setServices(eligibleServices);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) toast.error(friendlyError(error, "Unable to load discount codes."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [toast]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(discount) {
    setEditing(discount);
    setForm({
      code: discount.code,
      percentageOff: String(discount.percentage_off),
      scope: discount.scope,
      selectedServiceIds: discount.selected_service_ids || [],
      expiresAt: localDateTime(discount.expires_at),
      enabled: discount.enabled,
    });
    setFormError("");
    setFormOpen(true);
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError("");
  }

  function toggleService(serviceId) {
    setForm((current) => ({
      ...current,
      selectedServiceIds: current.selectedServiceIds.includes(serviceId)
        ? current.selectedServiceIds.filter((id) => id !== serviceId)
        : [...current.selectedServiceIds, serviceId],
    }));
    setFormError("");
  }

  async function submit(event) {
    event.preventDefault();
    const code = form.code.trim().toUpperCase();
    const percentageOff = Number(form.percentageOff);
    const selectedServiceIds = form.scope === "selected" ? form.selectedServiceIds : [];
    if (!editing && !code) return setFormError("Enter a discount code.");
    if (!Number.isInteger(percentageOff) || percentageOff < 1 || percentageOff > 99) {
      return setFormError("Percentage off must be a whole number from 1 to 99.");
    }
    if (form.scope === "selected" && selectedServiceIds.length === 0) {
      return setFormError("Choose at least one eligible service.");
    }

    try {
      setSaving(true);
      const payload = {
        percentageOff,
        scope: form.scope,
        selectedServiceIds,
        enabled: form.enabled,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      };
      if (editing) {
        await updateAdminDiscountCode({ ...payload, discountCodeId: editing.id });
      } else {
        await createAdminDiscountCode({ ...payload, code });
      }
      await load();
      setFormOpen(false);
      setEditing(null);
      setForm(emptyForm);
      toast.success(editing ? "Discount code updated" : "Discount code created");
    } catch (error) {
      console.error(error);
      setFormError(friendlyError(error, "Unable to save this discount code. Check the details and try again."));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(discount) {
    const nextEnabled = !discount.enabled;
    const accepted = await confirm({
      title: nextEnabled ? "Enable discount code" : "Disable discount code",
      message: nextEnabled ? "Make this code available at checkout?" : "Customers will no longer be able to use this code.",
      confirmText: nextEnabled ? "Enable" : "Disable",
    });
    if (!accepted) return;
    try {
      setTogglingId(discount.id);
      await setAdminDiscountCodeEnabled(discount.id, nextEnabled);
      await load();
      toast.success(nextEnabled ? "Discount code enabled" : "Discount code disabled");
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Unable to update this discount code."));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleLogout() {
    const accepted = await confirm({ title: "Logout", message: "Are you sure you want to logout?", confirmText: "Logout" });
    if (!accepted) return;
    await logout();
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="flex flex-col gap-8">
      <AdminHeader title="Discount codes" subtitle="Checkout offers" description="Create and manage customer discount codes without changing historical bookings." onLogout={handleLogout} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-[#5c675e]">Disabled codes stay on record for historical pricing and redemption reporting.</p>
        <button type="button" onClick={openCreate} className="admin-button">Create discount code</button>
      </div>

      {formOpen && (
        <AdminCard className="p-5 sm:p-7">
          <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#677266]">{editing ? "Edit discount code" : "New discount code"}</p><h2 className="mt-2 font-serif text-2xl text-[#202620]">{editing ? editing.code : "Create discount code"}</h2></div>
            <div className="grid gap-5 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-[#39443c]">Code
                <input name="code" value={form.code} readOnly={Boolean(editing)} required onChange={(event) => updateForm("code", event.target.value.toUpperCase())} placeholder="SUMMER20" maxLength="32" className="admin-input" aria-describedby={editing ? "code-immutable" : undefined} />
                {editing && <span id="code-immutable" className="text-xs font-normal text-[#6f786f]">Codes cannot be renamed after creation.</span>}
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[#39443c]">Percentage off
                <input name="percentage-off" type="number" min="1" max="99" step="1" required value={form.percentageOff} onChange={(event) => updateForm("percentageOff", event.target.value)} className="admin-input" />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[#39443c]">Expiry <span className="font-normal text-[#6f786f]">(optional)</span>
                <input name="expiry" type="datetime-local" value={form.expiresAt} onChange={(event) => updateForm("expiresAt", event.target.value)} className="admin-input" />
              </label>
              <label className="flex items-center gap-3 self-end rounded-xl border border-[#d8ded5] bg-[#f8faf6] px-4 py-3 text-sm font-medium text-[#39443c]"><input name="enabled" type="checkbox" checked={form.enabled} onChange={(event) => updateForm("enabled", event.target.checked)} /> Enabled at checkout</label>
            </div>
            <fieldset className="flex flex-col gap-3"><legend className="text-sm font-medium text-[#39443c]">Applies to</legend>
              <label className="flex items-center gap-3"><input type="radio" name="scope" value="all" checked={form.scope === "all"} onChange={() => { updateForm("scope", "all"); updateForm("selectedServiceIds", []); }} /> All eligible services</label>
              <label className="flex items-center gap-3"><input type="radio" name="scope" value="selected" checked={form.scope === "selected"} onChange={() => updateForm("scope", "selected")} /> Selected services</label>
              {form.scope === "selected" && <div className="grid gap-2 rounded-xl border border-[#d8ded5] bg-[#f8faf6] p-4 sm:grid-cols-2">{services.length ? services.map((service) => <label key={service.id} className="flex items-center gap-3 text-sm text-[#39443c]"><input type="checkbox" checked={form.selectedServiceIds.includes(service.id)} onChange={() => toggleService(service.id)} /> {service.name}</label>) : <p className="text-sm text-[#687068]">No eligible services are currently available.</p>}</div>}
            </fieldset>
            {formError && <p role="alert" className="rounded-lg bg-[#f9e7df] px-4 py-3 text-sm text-[#9a3a24]">{formError}</p>}
            <div className="flex flex-wrap gap-3"><button type="submit" disabled={saving} className="admin-button">{saving ? "Saving…" : editing ? "Save changes" : "Create discount code"}</button><button type="button" onClick={() => setFormOpen(false)} className="admin-button-secondary">Cancel</button></div>
          </form>
        </AdminCard>
      )}

      {loading ? <AdminCard className="p-8"><p className="text-sm text-[#687068]">Loading discount codes...</p></AdminCard> : discounts.length === 0 ? <AdminCard className="p-8"><p className="text-sm text-[#687068]">No discount codes have been created.</p></AdminCard> : <div className="flex flex-col gap-4">{discounts.map((discount) => {
        const selectedNames = (discount.selected_service_ids || []).map((id) => serviceNames.get(id) || "Unavailable service");
        return <AdminCard key={discount.id} className="p-5 sm:p-6"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-2xl text-[#202620]">{discount.code}</h2><span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${discount.enabled ? "bg-[#e7f2e7] text-[#2f6b38]" : "bg-[#efeee9] text-[#68685f]"}`}>{discount.enabled ? "Enabled" : "Disabled"}</span></div><dl className="mt-4 grid gap-x-7 gap-y-3 text-sm text-[#516051] sm:grid-cols-2 xl:grid-cols-4"><div><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7a837b]">Discount</dt><dd className="mt-1 font-medium">{discount.percentage_off}% off</dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7a837b]">Scope</dt><dd className="mt-1 font-medium">{discount.scope === "all" ? "All eligible services" : "Selected services"}</dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7a837b]">Expiry</dt><dd className="mt-1 font-medium">{formatExpiry(discount.expires_at)}</dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7a837b]">Uses</dt><dd className="mt-1 font-medium">{discount.uses}</dd></div></dl>{discount.scope === "selected" && <p className="mt-4 text-sm text-[#536058]"><span className="font-medium">Services:</span> {selectedNames.join(", ")}</p>}</div><div className="flex flex-wrap gap-3"><button type="button" onClick={() => openEdit(discount)} className="admin-button-secondary">Edit</button><button type="button" disabled={togglingId === discount.id} onClick={() => toggleEnabled(discount)} className="admin-button-secondary">{togglingId === discount.id ? "Updating…" : discount.enabled ? "Disable" : "Enable"}</button></div></div></AdminCard>;
      })}</div>}
    </div>
  );
}
