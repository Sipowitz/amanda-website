import type {
  EmailContent,
  EmailTemplateContext,
} from "../types.ts";

import {
  escapeHtml,
  formatBookingDate,
  formatCurrency,
  formatReminderTiming,
  getCustomerFirstName,
} from "../lib/formatters.ts";
import { getEmailLayout } from "../lib/layout.ts";

function getReminderDetails(payload: Record<string, unknown>) {
  const customerName = String(payload.customer_name ?? "");
  const reminderHours = Number(payload.reminder_hours ?? 24);

  return {
    customerName,
    firstName: getCustomerFirstName(customerName),
    slotDate: formatBookingDate(payload.slot_date),
    slotTime: String(payload.slot_time ?? "Time to be confirmed"),
    reminderHours,
    timingDescription: formatReminderTiming(reminderHours),
  };
}

export function buildCustomerReminderEmail(
  payload: Record<string, unknown>,
): EmailContent {
  const {
    firstName,
    slotDate,
    slotTime,
    reminderHours,
    timingDescription,
  } = getReminderDetails(payload);

  const subject =
    reminderHours === 24
      ? "A reminder about your booking tomorrow"
      : "A reminder about your upcoming booking";

  const text = [
    `Hello ${firstName},`,
    "",
    `This is a reminder ${timingDescription} for your booking with Amanda Beach.`,
    "",
    `Date: ${slotDate}`,
    `Time: ${slotTime}`,
    "",
    "Amanda looks forward to seeing you.",
  ].join("\n");

  const html = getEmailLayout({
    eyebrow: "Booking Reminder",
    heading:
      reminderHours === 24
        ? "Your appointment is tomorrow."
        : "Your appointment is coming up.",
    body: `
      <p style="margin: 0;">
        Hello ${escapeHtml(firstName)}. This is a reminder
        ${escapeHtml(timingDescription)} for your booking with Amanda Beach.
      </p>
    `,
    details: [
      {
        label: "Date",
        value: slotDate,
      },
      {
        label: "Time",
        value: slotTime,
      },
    ],
  });

  return {
    subject,
    html,
    text,
  };
}

export function buildAdminReminderEmail(
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  const {
    customerName,
    slotDate,
    slotTime,
    timingDescription,
  } = getReminderDetails(payload);

  const customerEmail = String(payload.customer_email ?? "");
  const customerPhone = String(payload.customer_phone ?? "");
  const bookingStatus = String(payload.booking_status ?? "");
  const paymentStatus = String(payload.payment_status ?? "");
  const amountRemaining = formatCurrency(payload.amount_remaining);

  const subject = `Booking reminder: ${customerName || "customer"}`;

  const text = [
    `This is an admin reminder ${timingDescription}.`,
    "",
    `Customer: ${customerName}`,
    `Email: ${customerEmail || "Not provided"}`,
    `Phone: ${customerPhone || "Not provided"}`,
    `Date: ${slotDate}`,
    `Time: ${slotTime}`,
    bookingStatus ? `Booking status: ${bookingStatus}` : "",
    paymentStatus ? `Payment status: ${paymentStatus}` : "",
    `Balance remaining: ${amountRemaining}`,
    "",
    `Admin: ${context.siteUrl}/admin/bookings`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = getEmailLayout({
    eyebrow: "Admin Booking Reminder",
    heading: customerName || "Upcoming booking",
    body: `
      <p style="margin: 0;">
        This is an admin reminder ${escapeHtml(timingDescription)}.
      </p>
    `,
    details: [
      {
        label: "Customer",
        value: customerName || "Not provided",
      },
      {
        label: "Email",
        value: customerEmail || "Not provided",
      },
      {
        label: "Telephone",
        value: customerPhone || "Not provided",
      },
      {
        label: "Date",
        value: slotDate,
      },
      {
        label: "Time",
        value: slotTime,
      },
      {
        label: "Booking",
        value: bookingStatus || "Not recorded",
      },
      {
        label: "Payment",
        value: paymentStatus || "Not recorded",
      },
      {
        label: "Balance",
        value: amountRemaining,
      },
    ],
    buttonLabel: "Open Bookings",
    buttonUrl: `${context.siteUrl}/admin/bookings`,
  });

  return {
    subject,
    html,
    text,
  };
}
