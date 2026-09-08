import { useState } from "react";

import AdminCard from "./AdminCard";

const days = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

export default function SlotGenerator({ onGenerate, loading }) {
  const [formData, setFormData] = useState({
    startDate: "",
    endDate: "",
    startTime: "10:00",
    endTime: "17:00",
    interval: "30",
  });
  const [repeat, setRepeat] = useState(false);

  const [selectedDays, setSelectedDays] = useState([1, 2, 3, 4, 5]);

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function toggleDay(dayValue) {
    setSelectedDays((prev) => {
      if (prev.includes(dayValue)) {
        return prev.filter((day) => day !== dayValue);
      }

      return [...prev, dayValue];
    });
  }

  function handleSubmit(event) {
    event.preventDefault();

    const start = new Date(`${formData.startDate}T12:00:00`);

    onGenerate({
      ...formData,
      endDate: repeat ? formData.endDate : formData.startDate,
      selectedDays: repeat ? selectedDays : [start.getDay()],
    });
  }

  return (
    <AdminCard className="p-8">
      <div className="mb-8">
          <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#202620]/45">
          Add availability
          </p>

        <h2 className="text-4xl text-[#202620]">Create appointment times</h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        {/* Dates */}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#202620]/55">
              Date
            </label>

            <input
              type="date"
              name="startDate"
              required
              value={formData.startDate}
              onChange={handleChange}
              className="rounded-2xl border border-[#d9dfd6] bg-white px-5 py-4 text-[#202620] outline-none backdrop-blur-xl transition focus:border-[#6f8b70] focus:bg-white/[0.07]"
            />
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-3 text-sm text-[#202620]/65">
              <input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} />
              Repeat across dates
            </label>
          </div>
        </div>

        {repeat && <div className="flex flex-col gap-5 rounded-2xl border border-[#d9dfd6] bg-[#f7f8f5] p-5">
          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#202620]/55">End date</label>
            <input type="date" name="endDate" required value={formData.endDate} onChange={handleChange} className="rounded-2xl border border-[#d9dfd6] bg-white px-5 py-4 text-[#202620] outline-none" />
          </div>
          <div className="flex flex-col gap-4">
            <label className="text-sm uppercase tracking-[0.18em] text-[#202620]/55">Weekdays</label>
            <div className="flex flex-wrap gap-3">{days.map((day) => {
              const active = selectedDays.includes(day.value);
              return <button key={day.value} type="button" onClick={() => toggleDay(day.value)} className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] ${active ? "border-[#789478] bg-[#dce8da] text-[#202620]" : "border-[#d9dfd6] text-[#202620]/55"}`}>{day.label}</button>;
            })}</div>
          </div>
        </div>}

        {/* Times */}
        <div className="grid gap-5 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#202620]/55">
              Start Time
            </label>

            <input
              type="time"
              name="startTime"
              value={formData.startTime}
              onChange={handleChange}
              className="rounded-2xl border border-[#d9dfd6] bg-white px-5 py-4 text-[#202620] outline-none backdrop-blur-xl transition focus:border-[#6f8b70] focus:bg-white/[0.07]"
            />
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#202620]/55">
              End Time
            </label>

            <input
              type="time"
              name="endTime"
              value={formData.endTime}
              onChange={handleChange}
              className="rounded-2xl border border-[#d9dfd6] bg-white px-5 py-4 text-[#202620] outline-none backdrop-blur-xl transition focus:border-[#6f8b70] focus:bg-white/[0.07]"
            />
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#202620]/55">
              Interval
            </label>

            <select
              name="interval"
              value={formData.interval}
              onChange={handleChange}
              className="rounded-2xl border border-[#d9dfd6] bg-white px-5 py-4 text-[#202620] outline-none backdrop-blur-xl transition focus:border-[#6f8b70] focus:bg-white/[0.07]"
            >
              <option value="15">15 mins</option>

              <option value="30">30 mins</option>

              <option value="45">45 mins</option>

              <option value="60">60 mins</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl border border-[#b9c9b7] bg-[#e5eee3] px-8 py-5 text-[#202620] backdrop-blur-xl transition duration-300 hover:bg-[#f1e8ca]/16 disabled:opacity-50"
        >
          {loading ? "Adding…" : "Add availability"}
        </button>
      </form>
    </AdminCard>
  );
}
