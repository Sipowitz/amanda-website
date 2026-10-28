import { useMemo, useState } from "react";

import AdminCard from "./AdminCard";
import { formatSlotTime } from "../../utils/slotTime";
import { expandAvailabilityDates, MAX_AVAILABILITY_PERIOD_DATES } from "../../utils/availabilityPeriods";

const weekdays = [
  [0, "Sunday"], [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"],
  [4, "Thursday"], [5, "Friday"], [6, "Saturday"],
];

function errorMessage(error) {
  const message = error?.message || "Unable to update availability. Please try again.";
  if (/incompatible appointment start/i.test(message)) return "These hours conflict with an existing appointment schedule. Edit the existing availability instead.";
  return message;
}

export default function AvailabilityPeriodEditor({ editingPeriod, initialValues, onCancelEdit, onPreview, onSave, loading }) {
  const [mode, setMode] = useState("single");
  const [startDate, setStartDate] = useState(initialValues?.date || "");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState(initialValues?.startTime || "10:00");
  const [endTime, setEndTime] = useState(initialValues?.endTime || "17:00");
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);

  const dates = useMemo(() => mode === "single"
    ? (startDate ? [startDate] : [])
    : expandAvailabilityDates(startDate, endDate, days), [mode, startDate, endDate, days]);
  const periods = useMemo(() => dates.map((date) => ({
    start_local: `${date}T${startTime}`,
    end_local: `${date}T${endTime}`,
  })), [dates, startTime, endTime]);
  const isEditing = Boolean(editingPeriod);

  function validate() {
    if (!startDate || !startTime || !endTime) return "Choose a date, start time, and end time.";
    if (mode === "multiple" && !endDate) return "Choose an end date.";
    if (mode === "multiple" && days.length === 0) return "Choose at least one weekday.";
    if (mode === "multiple" && endDate < startDate) return "The end date must not be before the start date.";
    if (endTime <= startTime) return "Available until must be after available from.";
    if (dates.length === 0) return "No matching dates were found.";
    if (dates.length > MAX_AVAILABILITY_PERIOD_DATES) return `Choose no more than ${MAX_AVAILABILITY_PERIOD_DATES} dates at once.`;
    return "";
  }

  async function requestPreview() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setError("");
    try {
      const result = await onPreview(isEditing ? [{ start_local: `${startDate}T${startTime}`, end_local: `${startDate}T${endTime}` }] : periods, editingPeriod?.id || null);
      setPreview(result);
      if (result?.outcome === "anchor_conflict") setError("These hours use an incompatible appointment cadence. No changes will be made.");
    } catch (requestError) { setError(errorMessage(requestError)); }
  }

  async function submit(event) {
    event.preventDefault();
    const validation = validate();
    if (validation) { setError(validation); return; }
    setError("");
    try {
      await onSave(isEditing ? { startLocal: `${startDate}T${startTime}`, endLocal: `${startDate}T${endTime}` } : periods);
      setPreview(null);
    } catch (requestError) { setError(errorMessage(requestError)); }
  }

  // Editing values are set from the displayed period on initial render by the
  // parent key; a component key avoids accidentally retaining an earlier form.
  return (
    <AdminCard className="p-5 sm:p-8">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase tracking-[.22em] text-[#202620]/45">Availability</p><h2 className="text-2xl text-[#202620]">{isEditing ? "Edit availability" : "Add availability"}</h2></div>
        <p className="text-sm text-[#202620]/60">All times are America/Chicago. Appointments are 60 minutes.</p>
      </div>
      {!isEditing && <div className="mb-6 flex rounded-xl bg-[#f3f6f1] p-1" role="tablist" aria-label="Availability type">
        {[['single', 'Single date'], ['multiple', 'Multiple dates']].map(([value, label]) => <button key={value} type="button" onClick={() => { setMode(value); setPreview(null); }} className={`min-h-11 flex-1 rounded-lg px-3 text-sm ${mode === value ? "bg-white text-[#202620] shadow-sm" : "text-[#202620]/60"}`}>{label}</button>)}
      </div>}
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-[#202620]/70">{isEditing || mode === "single" ? "Date" : "From"}<input type="date" required value={startDate} onChange={(event) => { setStartDate(event.target.value); setPreview(null); }} className="admin-input mt-2 w-full" /></label>
          {mode === "multiple" && !isEditing && <label className="text-sm text-[#202620]/70">To<input type="date" required value={endDate} onChange={(event) => { setEndDate(event.target.value); setPreview(null); }} className="admin-input mt-2 w-full" /></label>}
        </div>
        {mode === "multiple" && !isEditing && <fieldset><legend className="mb-2 text-sm text-[#202620]/70">Days</legend><div className="flex flex-wrap gap-2">{weekdays.map(([value, label]) => <button key={value} type="button" onClick={() => { setDays((current) => current.includes(value) ? current.filter((day) => day !== value) : [...current, value]); setPreview(null); }} aria-pressed={days.includes(value)} className={`min-h-11 rounded-lg border px-3 text-sm ${days.includes(value) ? "border-[#789478] bg-[#dce8da]" : "border-[#d9dfd6] bg-white"}`}>{label.slice(0, 3)}</button>)}</div></fieldset>}
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-[#202620]/70">Available from<input type="time" required value={startTime} onChange={(event) => { setStartTime(event.target.value); setPreview(null); }} className="admin-input mt-2 w-full" /></label><label className="text-sm text-[#202620]/70">Available until<input type="time" required value={endTime} onChange={(event) => { setEndTime(event.target.value); setPreview(null); }} className="admin-input mt-2 w-full" /></label></div>
        {mode === "multiple" && !isEditing && dates.length > 0 && <p className="text-sm text-[#202620]/60">{dates.length} selected date{dates.length === 1 ? "" : "s"}: {dates.slice(0, 5).join(", ")}{dates.length > 5 ? "…" : ""}</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="flex flex-wrap gap-3"><button type="button" disabled={loading} onClick={requestPreview} className="admin-button-secondary min-h-11 px-5">Preview appointment times</button><button type="submit" disabled={loading || preview?.outcome === "anchor_conflict"} className="admin-button min-h-11 px-5">{loading ? "Saving…" : isEditing ? "Save availability" : "Add availability"}</button>{isEditing && <button type="button" onClick={onCancelEdit} className="min-h-11 px-3 text-sm text-[#202620]/65">Cancel</button>}</div>
      </form>
      {preview?.outcome === "preview" && <div className="mt-6 rounded-xl border border-[#d9dfd6] bg-[#f7f8f5] p-4"><h3 className="text-lg text-[#202620]">Appointment preview</h3><p className="mt-1 text-sm text-[#202620]/60">This preview uses the same schedule and merge rules as saving.</p><div className="mt-3 flex flex-wrap gap-2">{(preview.appointments || []).slice(0, 48).map((appointment) => <span key={`${appointment.slot_date}-${appointment.slot_time}`} className={`rounded-lg px-3 py-2 text-sm ${appointment.has_booking || !appointment.is_available ? "bg-[#eee3d3]" : appointment.already_existed ? "bg-[#e5eee3]" : "bg-white"}`}>{appointment.slot_date} · {formatSlotTime(appointment.slot_time)}{appointment.has_booking ? " (booked)" : appointment.already_existed ? " (already available)" : ""}</span>)}</div>{(preview.appointments || []).length > 48 && <p className="mt-3 text-sm text-[#202620]/60">Showing the first 48 times.</p>}</div>}
    </AdminCard>
  );
}
