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

  const date = new Date(`${String(value)}T12:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

type AppointmentDisplay = {
  date: string;
  time: string;
};

function getZonedDateTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
) {
  const requestedWallTime = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
  );
  let instant = requestedWallTime;

  // Intl exposes offsets only through formatted calendar parts. Iteratively
  // correct a UTC guess until those parts equal the stored business wall time.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = getZonedDateTimeParts(new Date(instant), timezone);
    const actualWallTime = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = requestedWallTime - actualWallTime;

    instant += correction;
    if (correction === 0) break;
  }

  return new Date(instant);
}

export function formatBookingAppointment(
  dateValue: unknown,
  timeValue: unknown,
  timezone: string,
): AppointmentDisplay {
  const dateText = String(dateValue ?? "");
  const timeText = String(timeValue ?? "");
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeText);

  if (!dateMatch || !timeMatch) {
    return {
      date: formatBookingDate(dateValue),
      time: timeText || "Time to be confirmed",
    };
  }

  try {
    const instant = wallTimeToInstant(
      Number(dateMatch[1]),
      Number(dateMatch[2]),
      Number(dateMatch[3]),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      Number(timeMatch[3] ?? 0),
      timezone,
    );

    return {
      date: new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(instant),
      time: new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(instant),
    };
  } catch {
    return {
      date: formatBookingDate(dateValue),
      time: timeText || "Time to be confirmed",
    };
  }
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
