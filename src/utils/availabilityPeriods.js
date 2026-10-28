export const MAX_AVAILABILITY_PERIOD_DATES = 90;

function chicagoDateFromInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function expandAvailabilityDates(startDate, endDate, selectedDays) {
  const start = chicagoDateFromInput(startDate);
  const end = chicagoDateFromInput(endDate);
  if (!start || !end || end < start) return [];
  const result = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (selectedDays.includes(cursor.getUTCDay())) result.push(cursor.toISOString().slice(0, 10));
    if (result.length > MAX_AVAILABILITY_PERIOD_DATES) return result;
  }
  return result;
}
