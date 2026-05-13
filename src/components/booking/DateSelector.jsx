import { useMemo, useState } from "react";

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
    <div className="mx-auto max-w-4xl">
      <div className="rounded-[2rem] border border-[#f1e8ca]/14 bg-white/[0.05] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl sm:p-5">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={() => setCurrentMonth((prev) => subMonths(prev, 1))}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#f1e8ca]/14 bg-white/[0.04] text-lg text-[#f1e8ca]/70 transition duration-300 hover:border-[#f1e8ca]/30 hover:bg-white/[0.06] hover:text-[#f1e8ca]"
          >
            ←
          </button>

          <h3 className="text-2xl text-[#f1e8ca] sm:text-3xl">{monthLabel}</h3>

          <button
            onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#f1e8ca]/14 bg-white/[0.04] text-lg text-[#f1e8ca]/70 transition duration-300 hover:border-[#f1e8ca]/30 hover:bg-white/[0.06] hover:text-[#f1e8ca]"
          >
            →
          </button>
        </div>

        {/* Weekdays */}
        <div className="mb-3 grid grid-cols-7 gap-1.5">
          {weekdayLabels.map((day) => (
            <div
              key={day}
              className="text-center text-[11px] uppercase tracking-[0.22em] text-[#f1e8ca]/72"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 gap-1.5">
          {calendarCells.map((day) => {
            if (day.empty) {
              return <div key={day.id} className="h-[64px]" />;
            }

            const formattedDate = format(day, "yyyy-MM-dd");

            const available = hasAvailability(day);

            const active =
              selectedDate && isSameDay(new Date(selectedDate), day);

            return (
              <button
                key={formattedDate}
                onClick={() => {
                  if (!available) {
                    return;
                  }

                  onSelectDate(formattedDate);
                }}
                disabled={!available}
                className={`h-[64px] rounded-[1rem] border transition-all duration-200 ${
                  active
                    ? "border-[#f1e8ca]/70 bg-[#f1e8ca]/22 shadow-[0_0_28px_rgba(241,232,202,0.16)]"
                    : available
                      ? "border-[#f1e8ca]/18 bg-white/[0.065] hover:border-[#f1e8ca]/28 hover:bg-[#f1e8ca]/08"
                      : "border-white/[0.03] bg-black/[0.12]"
                }`}
              >
                <div className="flex h-full flex-col items-center justify-center">
                  <span
                    className={`transition-colors duration-200 ${
                      active
                        ? "text-lg font-semibold text-[#fffdf5] sm:text-xl"
                        : available
                          ? "text-base font-medium text-[#f1e8ca] sm:text-lg"
                          : "text-sm font-light text-[#f1e8ca]/18 sm:text-base"
                    }`}
                  >
                    {format(day, "d")}
                  </span>

                  {available && (
                    <span
                      className={`mt-1 h-1 w-1 rounded-full ${
                        active
                          ? "bg-[#fffdf5] shadow-[0_0_10px_rgba(255,253,245,0.9)]"
                          : "bg-[#f1e8ca]/70"
                      }`}
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
