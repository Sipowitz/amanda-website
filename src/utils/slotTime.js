// starts_at is computed by PostgreSQL from the slot wall time and configured
// IANA timezone. Never reinterpret slot_date/slot_time in the browser timezone.
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
