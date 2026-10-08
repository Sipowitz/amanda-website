import { useEffect, useRef, useState } from "react";

import AdminCard from "../../components/admin/AdminCard";
import AdminHeader from "../../components/admin/AdminHeader";
import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { useToast } from "../../contexts/ToastContext";
import {
  createAdminService,
  getAdminServices,
  moveAdminService,
  setAdminServiceActive,
  updateAdminService,
} from "../../services/adminService";
import { parseServicePriceAmount } from "../../utils/servicePrice";

const emptyForm = { name: "", publicSummary: "", price: "", bookingMode: "timed" };

function formatPrice(amount) {
  return (amount / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function AdminServices() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState(null);
  const [formError, setFormError] = useState("");
  const formRef = useRef(null);
  const { logout } = useAdminAuth();
  const toast = useToast();
  const confirm = useConfirm();

  async function load() {
    const result = await getAdminServices();
    setServices(result);
  }

  useEffect(() => {
    let cancelled = false;
    getAdminServices()
      .then((result) => { if (!cancelled) setServices(result); })
      .catch((error) => { if (!cancelled) toast.error(error.message || "Unable to load services."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [toast]);

  useEffect(() => {
    if (formOpen) formRef.current?.scrollIntoView({ block: "start" });
  }, [editing, formOpen]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(service) {
    setEditing(service);
    setForm({
      name: service.name,
      publicSummary: service.public_summary || "",
      price: String(service.price_amount / 100),
      bookingMode: service.booking_mode,
    });
    setFormError("");
    setFormOpen(true);
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError("");
  }

  async function submit(event) {
    event.preventDefault();
    const amount = parseServicePriceAmount(form.price);
    if (!form.name.trim()) return setFormError("Enter a service name.");
    if (!form.publicSummary.trim()) return setFormError("Enter a public summary.");
    if (!amount) return setFormError("Enter a positive price with no more than two decimal places.");
    try {
      setSaving(true);
      if (editing) {
        await updateAdminService({ serviceId: editing.id, name: form.name, publicSummary: form.publicSummary, priceAmount: amount });
      } else {
        await createAdminService({ name: form.name, publicSummary: form.publicSummary, bookingMode: form.bookingMode, priceAmount: amount });
      }
      await load();
      setFormOpen(false);
      toast.success(editing ? "Service updated" : "Service created inactive");
    } catch (error) {
      setFormError(error.message || "Unable to save this service.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(service) {
    const next = !service.is_active;
    const accepted = await confirm({
      title: next ? "Activate service" : "Deactivate service",
      message: next ? "Make this service available for new public bookings?" : "Remove this service from new public bookings? Existing bookings and payments are unchanged.",
      confirmText: next ? "Activate" : "Deactivate",
    });
    if (!accepted) return;
    try {
      setWorkingId(service.id);
      await setAdminServiceActive(service.id, next);
      await load();
      toast.success(next ? "Service activated" : "Service deactivated");
    } catch (error) {
      toast.error(error.message || "Unable to update this service.");
    } finally { setWorkingId(null); }
  }

  async function move(service, direction) {
    try {
      setWorkingId(service.id);
      await moveAdminService(service.id, direction);
      await load();
    } catch (error) {
      toast.error(error.message || "Unable to reorder services.");
    } finally { setWorkingId(null); }
  }

  async function handleLogout() { await logout(); }

  const serviceGroups = [
    { id: "live-readings", title: "Live Readings", services: services.filter((service) => service.booking_mode === "timed") },
    { id: "voice-memo-readings", title: "Voice Memo Readings", services: services.filter((service) => service.booking_mode === "untimed") },
  ].filter((group) => group.services.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <AdminHeader title="Services" subtitle="Booking catalogue" description="Create services inactive, review them, then activate when ready." onLogout={handleLogout} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-[#5c675e]">Services are never deleted because booking and payment history stays attached.</p>
        <button type="button" onClick={openCreate} className="admin-button">Add service</button>
      </div>

      {formOpen && <AdminCard className="p-5 sm:p-7">
        <form ref={formRef} onSubmit={submit} className="scroll-mt-24 flex flex-col gap-5 lg:scroll-mt-8" noValidate>
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#677266]">{editing ? "Edit service" : "New service"}</p><h2 className="mt-2 font-serif text-2xl text-[#202620]">{editing ? editing.name : "Add service"}</h2></div>
          <label className="flex flex-col gap-2 text-sm font-medium text-[#39443c]">Name<input name="name" value={form.name} onChange={(event) => updateForm("name", event.target.value)} maxLength="160" required className="admin-input" /></label>
          <label className="flex flex-col gap-2 text-sm font-medium text-[#39443c]">Public summary<textarea name="public-summary" value={form.publicSummary} onChange={(event) => updateForm("publicSummary", event.target.value)} maxLength="1000" required rows="4" className="admin-input" /></label>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium text-[#39443c]">Price (USD)<input name="price" inputMode="decimal" value={form.price} onChange={(event) => updateForm("price", event.target.value)} placeholder="85.00" required className="admin-input" /></label>
            {editing ? <div className="flex flex-col gap-2 text-sm text-[#516051]"><span className="font-medium text-[#39443c]">Booking type</span><span>{editing.booking_mode === "timed" ? "Timed" : "Untimed"}{editing.booking_mode === "timed" ? " · 60 minutes" : ""}</span><span className="text-xs">Slug: {editing.slug}</span></div>
              : <fieldset className="flex flex-col gap-2 text-sm font-medium text-[#39443c]"><legend>Booking type</legend><label><input type="radio" name="booking-mode" value="timed" checked={form.bookingMode === "timed"} onChange={() => updateForm("bookingMode", "timed")} /> Timed</label><label><input type="radio" name="booking-mode" value="untimed" checked={form.bookingMode === "untimed"} onChange={() => updateForm("bookingMode", "untimed")} /> Untimed</label>{form.bookingMode === "timed" && <span className="text-xs font-normal text-[#6f786f]">Duration: 60 minutes (fixed)</span>}</fieldset>}
          </div>
          {!editing && <p className="text-sm text-[#687068]">New services start inactive and will not appear publicly until activated.</p>}
          {formError && <p role="alert" className="rounded-lg bg-[#f9e7df] px-4 py-3 text-sm text-[#9a3a24]">{formError}</p>}
          <div className="flex gap-3"><button type="submit" disabled={saving} className="admin-button">{saving ? "Saving…" : editing ? "Save changes" : "Create inactive service"}</button><button type="button" onClick={() => setFormOpen(false)} className="admin-button-secondary">Cancel</button></div>
        </form>
      </AdminCard>}

      {loading ? <AdminCard className="p-8"><p className="text-sm text-[#687068]">Loading services...</p></AdminCard>
        : <div className="flex flex-col gap-8">{serviceGroups.map((group) => <section key={group.id} aria-labelledby={`${group.id}-heading`} className="flex flex-col gap-4">
          <h2 id={`${group.id}-heading`} className="font-serif text-2xl text-[#202620]">{group.title}</h2>
          {group.services.map((service, index) => <AdminCard key={service.id} className="p-5 sm:p-6">
            <article data-service-card={service.id} className="flex flex-col">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-serif text-2xl text-[#202620]">{service.name}</h3><span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${service.is_active ? "bg-[#e7f2e7] text-[#2f6b38]" : "bg-[#efeee9] text-[#68685f]"}`}>{service.is_active ? "Active" : "Inactive"}</span></div>
                <p className="mt-3 max-w-3xl whitespace-pre-wrap break-words text-sm leading-6 text-[#516051]">{service.public_summary || "No public summary configured."}</p>
                <p className="mt-3 break-words text-sm text-[#516051]">{formatPrice(service.price_amount)} · {service.booking_mode === "timed" ? "Timed · 60 minutes" : "Untimed"} · /services/{service.slug}</p>
              </div>
              <div role="group" aria-label={`${service.name} actions`} className="mt-6 grid grid-cols-2 gap-3 border-t border-[#e2e6df] pt-5 sm:flex sm:flex-wrap sm:items-center">
                <button type="button" disabled={workingId === service.id || index === 0} onClick={() => move(service, "up")} className="admin-button-secondary whitespace-nowrap">Move up</button>
                <button type="button" disabled={workingId === service.id || index === group.services.length - 1} onClick={() => move(service, "down")} className="admin-button-secondary whitespace-nowrap">Move down</button>
                <button type="button" onClick={() => openEdit(service)} className="admin-button-secondary whitespace-nowrap">Edit</button>
                <button type="button" disabled={workingId === service.id} onClick={() => toggleActive(service)} className="admin-button-secondary whitespace-nowrap">{service.is_active ? "Deactivate" : "Activate"}</button>
              </div>
            </article>
          </AdminCard>)}
        </section>)}</div>}
    </div>
  );
}
