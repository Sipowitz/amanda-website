// starts_at is computed by PostgreSQL from the slot wall time and configured
// IANA timezone. Never reinterpret slot_date/slot_time in the browser timezone.
export function formatSlotTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? ""));
  if (!match) return String(value ?? "");

  const hour = Number(match[1]);
  const minute = match[2];
  if (hour > 23 || Number(minute) > 59) return String(value ?? "");

  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

// Preserve the browser-local semantics that existing admin timestamp displays
// use, while rendering only their clock portion in the shared 12-hour style.
export function formatLocalTimestamp(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "2-digit", hourCycle: "h12",
  }).format(new Date(value)).replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
}

export function isSlotPast(slot, now = Date.now()) {
  const instant = Date.parse(slot?.starts_at);
  return !Number.isFinite(instant) || instant < Number(now);
}

export function businessDate(timezone, now = Date.now()) {
  if (!timezone) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function visibleAdminSlots(slots, now = Date.now()) {
  // All booking history (including expired checkout holds) remains accessible.
  return slots.filter((slot) => slot.bookings?.length > 0 || !isSlotPast(slot, now));
}
