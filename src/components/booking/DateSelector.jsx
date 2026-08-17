import { useMemo, useState } from "react";

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CALENDAR_CELL_COUNT = 42;

export default function DateSelector({
  availableDates,
  selectedDate,
  onSelectDate,
}) {
  const today = startOfDay(new Date());

  const earliestMonth = startOfMonth(today);

  const [currentMonth, setCurrentMonth] = useState(earliestMonth);

  const monthStart = startOfMonth(currentMonth);

  const monthEnd = endOfMonth(currentMonth);

  const days = eachDayOfInterval({
    start: monthStart,
    end: monthEnd,
  });

  const leadingEmptyDays = getDay(monthStart);

  const populatedCellCount = leadingEmptyDays + days.length;

  const trailingEmptyDays = Math.max(
    CALENDAR_CELL_COUNT - populatedCellCount,
    0,
  );

  const calendarCells = [
    ...Array.from({ length: leadingEmptyDays }, (_, index) => ({
      empty: true,
      id: `leading-empty-${index}`,
    })),

    ...days,

    ...Array.from({ length: trailingEmptyDays }, (_, index) => ({
      empty: true,
      id: `trailing-empty-${index}`,
    })),
  ];

  const canGoToPreviousMonth =
    monthStart.getTime() > earliestMonth.getTime();

  function isPastDate(day) {
    return isBefore(startOfDay(day), today);
  }

  function hasAvailability(day) {
    if (!day || day.empty || isPastDate(day)) {
      return false;
    }

    const formattedDate = format(day, "yyyy-MM-dd");

    return availableDates.includes(formattedDate);
  }

  function handlePreviousMonth() {
    if (!canGoToPreviousMonth) {
      return;
    }

    setCurrentMonth((previousMonth) => subMonths(previousMonth, 1));
  }

  function handleNextMonth() {
    setCurrentMonth((previousMonth) => addMonths(previousMonth, 1));
  }

  const monthLabel = useMemo(() => {
    return format(currentMonth, "MMMM yyyy");
  }, [currentMonth]);

  return (
    <div className="mx-auto w-full max-w-[940px]">
      <div className="rounded-[1.5rem] border border-[#f1e8ca]/14 bg-white/[0.05] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl sm:rounded-[2rem] sm:p-6 md:p-8">
        {/* Header */}
        <div className="mb-5 grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 sm:mb-7 sm:grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] sm:gap-5">
          <button
            type="button"
            onClick={handlePreviousMonth}
            disabled={!canGoToPreviousMonth}
            aria-label="View previous month"
            className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg transition duration-300 sm:h-11 sm:w-11 ${
              canGoToPreviousMonth
                ? "border-[#f1e8ca]/14 bg-white/[0.04] text-[#f1e8ca]/70 hover:border-[#f1e8ca]/30 hover:bg-white/[0.06] hover:text-[#f1e8ca]"
                : "cursor-not-allowed border-white/[0.04] bg-black/[0.06] text-[#f1e8ca]/18"
            }`}
          >
            ←
          </button>

          <h3 className="truncate text-center text-xl text-[#f1e8ca] sm:text-3xl">
            {monthLabel}
          </h3>

          <button
            type="button"
            onClick={handleNextMonth}
            aria-label="View next month"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#f1e8ca]/14 bg-white/[0.04] text-lg text-[#f1e8ca]/70 transition duration-300 hover:border-[#f1e8ca]/30 hover:bg-white/[0.06] hover:text-[#f1e8ca] sm:h-11 sm:w-11"
          >
            →
          </button>
        </div>

        {/* Weekdays */}
        <div className="mb-2 grid grid-cols-7 gap-1 sm:mb-3 sm:gap-2 md:gap-3">
          {weekdayLabels.map((day) => (
            <div
              key={day}
              className="min-w-0 text-center text-[9px] uppercase tracking-[0.08em] text-[#f1e8ca]/72 sm:text-[11px] sm:tracking-[0.18em]"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1 sm:gap-2 md:gap-3">
          {calendarCells.map((day) => {
            if (day.empty) {
              return (
                <div
                  key={day.id}
                  className="h-12 sm:h-[60px] md:h-[68px]"
                />
              );
            }

            const formattedDate = format(day, "yyyy-MM-dd");

            const available = hasAvailability(day);

            const active =
              selectedDate &&
              isSameDay(parseISO(selectedDate), startOfDay(day));

            return (
              <button
                key={formattedDate}
                type="button"
                onClick={() => {
                  if (!available) {
                    return;
                  }

                  onSelectDate(formattedDate);
                }}
                disabled={!available}
                aria-label={`${format(day, "EEEE, MMMM d, yyyy")}${
                  available ? ", available" : ", unavailable"
                }`}
                className={`min-w-0 h-12 rounded-lg border transition-all duration-200 sm:h-[60px] sm:rounded-xl md:h-[68px] md:rounded-[1rem] ${
                  active
                    ? "border-[#f1e8ca]/70 bg-[#f1e8ca]/22 shadow-[0_0_28px_rgba(241,232,202,0.16)]"
                    : available
                      ? "border-[#f1e8ca]/18 bg-white/[0.065] hover:border-[#f1e8ca]/28 hover:bg-[#f1e8ca]/08"
                      : "cursor-not-allowed border-white/[0.03] bg-black/[0.12]"
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
