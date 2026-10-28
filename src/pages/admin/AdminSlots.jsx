import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AdminCard from "../../components/admin/AdminCard";
import AdminHeader from "../../components/admin/AdminHeader";
import AvailabilityPeriodEditor from "../../components/admin/AvailabilityPeriodEditor";
import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { useToast } from "../../contexts/ToastContext";
import { createAvailabilityPeriods, deleteAvailabilityPeriod, getAdminAvailabilityPeriods, getLegacyAvailabilityCount, previewAvailabilityPeriods, updateAvailabilityPeriod } from "../../services/adminService";
import { formatSlotTime } from "../../utils/slotTime";

const BUSINESS_TIMEZONE = "America/Chicago";
function chicagoParts(instant) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}
function formatChicagoDate(instant) { return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIMEZONE, weekday: "long", month: "long", day: "numeric" }).format(new Date(instant)); }
function resultMessage(result, action) {
  const results = result?.results || [result];
  if (results.some((item) => item?.outcome === "extended")) return "Availability updated. The new hours were merged with your existing availability.";
  if (results.every((item) => item?.outcome === "unchanged")) return "Those hours were already available; no changes were needed.";
  return action === "delete" ? "Availability removed. Existing bookings were kept." : "Availability updated.";
}

export default function AdminSlots() {
  const [periods, setPeriods] = useState([]); const [legacyCount, setLegacyCount] = useState(0);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [editing, setEditing] = useState(null);
  const navigate = useNavigate(); const { logout } = useAdminAuth(); const toast = useToast(); const confirm = useConfirm();
  async function refresh() {
    setLoading(true);
    try { const [nextPeriods, legacy] = await Promise.all([getAdminAvailabilityPeriods(), getLegacyAvailabilityCount()]); setPeriods(nextPeriods); setLegacyCount(legacy); }
    catch (error) { console.error(error); toast.error("Unable to load availability. Please try again."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    Promise.all([getAdminAvailabilityPeriods(), getLegacyAvailabilityCount()])
      .then(([nextPeriods, legacy]) => {
        if (!active) return;
        setPeriods(nextPeriods);
        setLegacyCount(legacy);
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        toast.error("Unable to load availability. Please try again.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [toast]);
  async function handleSave(payload) {
    setSaving(true);
    try {
      const result = editing ? await updateAvailabilityPeriod({ periodId: editing.id, ...payload }) : await createAvailabilityPeriods(payload);
      if (result?.outcome === "anchor_conflict") throw new Error("These hours use an incompatible appointment cadence. No changes were made.");
      toast.success(resultMessage(result, "save")); setEditing(null); await refresh();
    } finally { setSaving(false); }
  }
  async function handleDelete(period) {
    const accepted = await confirm({ title: "Remove availability?", message: "This removes future unbooked appointment opportunities. Existing bookings, booking history, and Square payments will not change.", confirmText: "Remove availability" });
    if (!accepted) return;
    setSaving(true);
    try { const result = await deleteAvailabilityPeriod(period.id); if (result?.outcome === "not_found") throw new Error("This availability was already changed. The schedule was refreshed."); toast.success(resultMessage(result, "delete")); if (editing?.id === period.id) setEditing(null); await refresh(); }
    catch (error) { console.error(error); toast.error(error?.message || "Unable to remove availability. Please try again."); }
    finally { setSaving(false); }
  }
  async function handleLogout() { if (!await confirm({ title: "Logout", message: "Are you sure you want to logout?", confirmText: "Logout" })) return; await logout(); navigate("/admin/login", { replace: true }); }
  const editValues = useMemo(() => editing ? chicagoParts(editing.starts_at) : null, [editing]);
  return <div className="flex flex-col gap-8 sm:gap-10">
    <AdminHeader title="Availability" subtitle="Set the hours customers can book" onLogout={handleLogout} />
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#202620]/60">Business timezone: <strong className="font-medium text-[#202620]">America/Chicago</strong></p><Link to="/admin/bookings" className="admin-button-secondary min-h-10 px-4 py-2 text-xs uppercase tracking-[.14em]">View bookings</Link></div>
    {legacyCount > 0 && <AdminCard className="border-[#d7c698] bg-[#fff9eb] p-4"><p className="font-medium text-[#202620]">Legacy availability is still present</p><p className="mt-1 text-sm text-[#202620]/70">{legacyCount} older appointment time{legacyCount === 1 ? " remains" : "s remain"} outside this new availability system. They are read-only here and will be handled in the planned legacy cleanup.</p></AdminCard>}
    <AvailabilityPeriodEditor key={editing?.id || "new"} editingPeriod={editing} initialValues={editValues} loading={saving} onCancelEdit={() => setEditing(null)} onPreview={previewAvailabilityPeriods} onSave={handleSave} />
    <section className="flex flex-col gap-4"><div><p className="text-xs uppercase tracking-[.22em] text-[#202620]/45">Existing availability</p><h2 className="mt-1 text-2xl text-[#202620]">Your bookable hours</h2></div>
      {loading ? <AdminCard className="p-8"><p className="text-[#202620]/60">Loading availability…</p></AdminCard> : periods.length === 0 ? <AdminCard className="p-8"><p className="text-[#202620]/60">No availability periods have been added yet.</p></AdminCard> : <div className="grid gap-4 lg:grid-cols-2">{periods.map((period) => <AdminCard key={period.id} className="p-5"><div className="flex justify-between gap-3"><div><h3 className="text-xl text-[#202620]">{formatChicagoDate(period.starts_at)}</h3><p className="mt-2 text-[#202620]/75">{formatSlotTime(chicagoParts(period.starts_at).time)} – {formatSlotTime(chicagoParts(period.ends_at).time)}</p><p className="mt-2 text-sm text-[#202620]/60">{period.appointment_count} appointment {period.appointment_count === 1 ? "time" : "times"}{period.booked_appointment_count ? ` · ${period.booked_appointment_count} booked` : ""}</p></div><div className="flex flex-col gap-2"><button type="button" onClick={() => setEditing(period)} className="admin-button-secondary min-h-10 px-3 text-sm">Edit</button><button type="button" disabled={saving} onClick={() => handleDelete(period)} className="min-h-10 px-3 text-sm text-red-800">Delete</button></div></div></AdminCard>)}</div>}
    </section>
  </div>;
}
