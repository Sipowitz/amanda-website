export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatBookingDate(value: unknown): string {
  if (!value) {
    return "Date to be confirmed";
  }

  const date = new Date(`${String(value)}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatCurrency(
  value: unknown,
  currency = "USD",
): string {
  const number = Number(value ?? 0);
  const safeCurrency = currency === "USD" ? currency : "USD";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: safeCurrency,
  }).format(Number.isFinite(number) ? number : 0);
}

export function getCustomerFirstName(name: unknown): string {
  const fullName = String(name ?? "").trim();

  if (!fullName) {
    return "there";
  }

  return fullName.split(/\s+/)[0];
}

export function formatReminderTiming(value: unknown): string {
  const hours = Number(value);

  if (!Number.isFinite(hours) || hours <= 0) {
    return "before the appointment";
  }

  if (hours === 168) {
    return "one week before the appointment";
  }

  if (hours % 24 === 0) {
    const days = hours / 24;

    return `${days} ${days === 1 ? "day" : "days"} before the appointment`;
  }

  return `${hours} ${hours === 1 ? "hour" : "hours"} before the appointment`;
}
