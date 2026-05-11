import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  startOfMonth,
  subMonths,
} from "date-fns";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function DateSelector({
  availableDates,
  selectedDate,
  onSelectDate,
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const days = eachDayOfInterval({
    start: monthStart,
    end: monthEnd,
  });

  const leadingEmptyDays = getDay(monthStart);

  const calendarCells = [
    ...Array.from({ length: leadingEmptyDays }, (_, index) => ({
      empty: true,
      id: `empty-${index}`,
    })),
    ...days,
  ];

  function hasAvailability(day) {
    if (!day || day.empty) {
      return false;
    }

    const formatted = format(day, "yyyy-MM-dd");

    return availableDates.includes(formatted);
  }

  const monthLabel = useMemo(() => {
    return format(currentMonth, "MMMM yyyy");
  }, [currentMonth]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="rounded-[2.8rem] border border-[#f1e8ca]/10 bg-black/10 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl md:p-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <button
            onClick={() => setCurrentMonth((prev) => subMonths(prev, 1))}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-[#f1e8ca]/12 bg-white/[0.03] text-3xl text-[#f1e8ca]/70 transition duration-300 hover:border-[#f1e8ca]/30 hover:bg-white/[0.06] hover:text-[#f1e8ca]"
          >
            ←
          </button>

          <div className="text-center">
            <p className="mb-2 text-xs uppercase tracking-[0.35em] text-[#f1e8ca]/45">
              Select Date
            </p>

            <h3 className="text-4xl text-[#f1e8ca] md:text-5xl">
              {monthLabel}
            </h3>
          </div>

          <button
            onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-[#f1e8ca]/12 bg-white/[0.03] text-3xl text-[#f1e8ca]/70 transition duration-300 hover:border-[#f1e8ca]/30 hover:bg-white/[0.06] hover:text-[#f1e8ca]"
          >
            →
          </button>
        </div>

        {/* Weekdays */}
        <div className="mb-4 grid grid-cols-7 gap-3">
          {weekdayLabels.map((day) => (
            <div
              key={day}
              className="text-center text-[0.7rem] uppercase tracking-[0.25em] text-[#f1e8ca]/42"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-3">
          {calendarCells.map((day, index) => {
            if (day.empty) {
              return <div key={day.id} className="aspect-square" />;
            }

            const formattedDate = format(day, "yyyy-MM-dd");

            const available = hasAvailability(day);

            const active =
              selectedDate && isSameDay(new Date(selectedDate), day);

            return (
              <motion.button
                key={`${formattedDate}-${index}`}
                whileHover={available ? { y: -3 } : undefined}
                whileTap={available ? { scale: 0.97 } : undefined}
                onClick={() => {
                  if (!available) {
                    return;
                  }

                  onSelectDate(formattedDate);
                }}
                disabled={!available}
                className={`group relative aspect-square overflow-hidden rounded-[1.8rem] border transition-all duration-500 ${
                  active
                    ? "border-[#f1e8ca]/55 bg-[#f1e8ca]/18 shadow-[0_0_45px_rgba(241,232,202,0.22)]"
                    : available
                      ? "border-[#f1e8ca]/12 bg-white/[0.04] shadow-[0_0_25px_rgba(241,232,202,0.05)] hover:border-[#f1e8ca]/35 hover:bg-[#f1e8ca]/08 hover:shadow-[0_0_45px_rgba(241,232,202,0.12)]"
                      : "border-white/[0.025] bg-black/10"
                }`}
              >
                {/* Glow Layer */}
                {available && (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(241,232,202,0.10),transparent_70%)] opacity-0 transition duration-500 group-hover:opacity-100" />
                )}

                <div className="relative flex h-full flex-col items-center justify-center">
                  <span
                    className={`transition-all duration-300 ${
                      active
                        ? "text-5xl font-medium text-[#fff7df]"
                        : available
                          ? "text-4xl font-medium text-[#f1e8ca]"
                          : "text-3xl font-light text-[#f1e8ca]/18"
                    }`}
                  >
                    {format(day, "d")}
                  </span>

                  {available && (
                    <span
                      className={`mt-3 h-2 w-2 rounded-full transition-all duration-300 ${
                        active
                          ? "bg-[#fff7df] shadow-[0_0_14px_rgba(255,247,223,0.9)]"
                          : "bg-[#f1e8ca]/75 shadow-[0_0_10px_rgba(241,232,202,0.45)]"
                      }`}
                    />
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-8 flex items-center justify-center gap-10">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-[#f1e8ca] shadow-[0_0_12px_rgba(241,232,202,0.8)]" />

            <span className="text-xs uppercase tracking-[0.25em] text-[#f1e8ca]/65">
              Available
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full border border-[#f1e8ca]/35" />

            <span className="text-xs uppercase tracking-[0.25em] text-[#f1e8ca]/40">
              Unavailable
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-[#fff7df] shadow-[0_0_14px_rgba(255,247,223,1)]" />

            <span className="text-xs uppercase tracking-[0.25em] text-[#f1e8ca]/75">
              Selected
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
