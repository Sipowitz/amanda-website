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

    onGenerate({
      ...formData,
      selectedDays,
    });
  }

  return (
    <AdminCard className="p-8">
      <div className="mb-8">
        <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
          Bulk Creation
        </p>

        <h2 className="text-4xl text-[#f1e8ca]">Generate Slots</h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        {/* Dates */}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55">
              Start Date
            </label>

            <input
              type="date"
              name="startDate"
              required
              value={formData.startDate}
              onChange={handleChange}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
            />
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55">
              End Date
            </label>

            <input
              type="date"
              name="endDate"
              required
              value={formData.endDate}
              onChange={handleChange}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
            />
          </div>
        </div>

        {/* Days */}
        <div className="flex flex-col gap-4">
          <label className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55">
            Available Days
          </label>

          <div className="flex flex-wrap gap-3">
            {days.map((day) => {
              const active = selectedDays.includes(day.value);

              return (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDay(day.value)}
                  className={`rounded-full border px-5 py-3 text-sm uppercase tracking-[0.18em] backdrop-blur-xl transition ${
                    active
                      ? "border-[#f1e8ca]/30 bg-[#f1e8ca]/14 text-[#f1e8ca]"
                      : "border-white/10 bg-white/[0.04] text-[#f1e8ca]/55 hover:bg-white/[0.06] hover:text-[#f1e8ca]"
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Times */}
        <div className="grid gap-5 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55">
              Start Time
            </label>

            <input
              type="time"
              name="startTime"
              value={formData.startTime}
              onChange={handleChange}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
            />
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55">
              End Time
            </label>

            <input
              type="time"
              name="endTime"
              value={formData.endTime}
              onChange={handleChange}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
            />
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55">
              Interval
            </label>

            <select
              name="interval"
              value={formData.interval}
              onChange={handleChange}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
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
          className="rounded-2xl border border-[#f1e8ca]/15 bg-[#f1e8ca]/10 px-8 py-5 text-[#f1e8ca] backdrop-blur-xl transition duration-300 hover:bg-[#f1e8ca]/16 disabled:opacity-50"
        >
          {loading ? "Generating..." : "Generate Booking Slots"}
        </button>
      </form>
    </AdminCard>
  );
}
