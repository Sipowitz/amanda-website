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
    <div className="mx-auto max-w-5xl">
      <div className="rounded-[2rem] border border-[#f1e8ca]/16 bg-white/[0.06] p-4 shadow-[0_20px_80px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:rounded-[2.8rem] sm:p-6 md:p-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between sm:mb-8">
          <button
            onClick={() => setCurrentMonth((prev) => subMonths(prev, 1))}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#f1e8ca]/16 bg-white/[0.05] text-2xl text-[#f1e8ca]/75 transition-colors duration-300 hover:border-[#f1e8ca]/35 hover:bg-white/[0.08] hover:text-[#f1e8ca] sm:h-14 sm:w-14 sm:text-3xl"
          >
            ←
          </button>

          <div className="text-center">
            <h3 className="text-2xl text-[#f1e8ca] sm:text-4xl md:text-5xl">
              {monthLabel}
            </h3>
          </div>

          <button
            onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#f1e8ca]/16 bg-white/[0.05] text-2xl text-[#f1e8ca]/75 transition-colors duration-300 hover:border-[#f1e8ca]/35 hover:bg-white/[0.08] hover:text-[#f1e8ca] sm:h-14 sm:w-14 sm:text-3xl"
          >
            →
          </button>
        </div>

        {/* Weekdays */}
        <div className="mb-3 grid grid-cols-7 gap-1.5 sm:mb-4 sm:gap-3">
          {weekdayLabels.map((day) => (
            <div
              key={day}
              className="text-center text-[0.55rem] uppercase tracking-[0.15em] text-[#f1e8ca]/45 sm:text-[0.7rem] sm:tracking-[0.25em]"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-3">
          {calendarCells.map((day) => {
            if (day.empty) {
              return <div key={day.id} className="aspect-square" />;
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
                className={`relative aspect-square overflow-hidden rounded-[1rem] border transition-all duration-200 sm:rounded-[1.8rem] ${
                  active
                    ? "border-[#f1e8ca]/55 bg-[#f1e8ca]/18 shadow-[0_0_24px_rgba(241,232,202,0.10)]"
                    : available
                      ? "border-[#f1e8ca]/16 bg-white/[0.05] shadow-[0_0_18px_rgba(0,0,0,0.08)] hover:border-[#f1e8ca]/30 hover:bg-[#f1e8ca]/08"
                      : "border-white/[0.04] bg-black/10"
                }`}
              >
                <div className="relative flex h-full flex-col items-center justify-center">
                  <span
                    className={`transition-colors duration-200 ${
                      active
                        ? "text-2xl font-medium text-[#fff7df] sm:text-5xl"
                        : available
                          ? "text-xl font-medium text-[#f1e8ca] sm:text-4xl"
                          : "text-lg font-light text-[#f1e8ca]/18 sm:text-3xl"
                    }`}
                  >
                    {format(day, "d")}
                  </span>

                  {available && (
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 rounded-full sm:mt-3 sm:h-2 sm:w-2 ${
                        active
                          ? "bg-[#fff7df] shadow-[0_0_10px_rgba(255,247,223,0.8)]"
                          : "bg-[#f1e8ca]/75 shadow-[0_0_6px_rgba(241,232,202,0.35)]"
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
