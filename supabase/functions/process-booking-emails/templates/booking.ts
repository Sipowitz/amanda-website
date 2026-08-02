import type {
  EmailContent,
  EmailTemplateContext,
} from "../types.ts";

import {
  escapeHtml,
  formatBookingDate,
  getCustomerFirstName,
} from "../lib/formatters.ts";
import { getEmailLayout } from "../lib/layout.ts";

function getBookingDetails(payload: Record<string, unknown>) {
  const customerName = String(payload.customer_name ?? "");

  return {
    customerName,
    firstName: getCustomerFirstName(customerName),
    slotDate: formatBookingDate(payload.slot_date),
    slotTime: String(payload.slot_time ?? "Time to be confirmed"),
  };
}

export function buildBookingRequestCustomerEmail(
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  const { firstName, slotDate, slotTime } = getBookingDetails(payload);

  const subject = "We’ve received your booking request";

  const text = [
    `Hello ${firstName},`,
    "",
    "Thank you for your booking request.",
    "",
    `Requested date: ${slotDate}`,
    `Requested time: ${slotTime}`,
    "",
    "Amanda will review your request and contact you when it has been confirmed.",
    "",
    "Amanda Beach",
  ].join("\n");

  const html = getEmailLayout({
    eyebrow: "Booking Request",
    heading: `Thank you, ${firstName}.`,
    body: `
      <p style="margin: 0;">
        We’ve received your booking request. Amanda will review it and
        contact you when the appointment has been confirmed.
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
    buttonLabel: "Visit Amanda Beach",
    buttonUrl: context.siteUrl,
  });

  return {
    subject,
    html,
    text,
  };
}

export function buildBookingRequestAdminEmail(
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  const { customerName, slotDate, slotTime } = getBookingDetails(payload);

  const customerEmail = String(payload.customer_email ?? "");
  const customerPhone = String(payload.customer_phone ?? "");
  const customerMessage = String(payload.customer_message ?? "");

  const subject = `New booking request from ${customerName || "a customer"}`;

  const text = [
    "A new booking request has been received.",
    "",
    `Customer: ${customerName}`,
    `Email: ${customerEmail}`,
    `Phone: ${customerPhone || "Not provided"}`,
    `Date: ${slotDate}`,
    `Time: ${slotTime}`,
    `Message: ${customerMessage || "No message supplied"}`,
    "",
    `Admin: ${context.siteUrl}/admin`,
  ].join("\n");

  const html = getEmailLayout({
    eyebrow: "New Booking Request",
    heading: customerName || "New customer",
    body: `
      <p style="margin: 0;">
        A new booking request has been submitted through the website.
      </p>
    `,
    details: [
      {
        label: "Email",
        value: customerEmail,
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
        label: "Message",
        value: customerMessage || "No message supplied",
      },
    ],
    buttonLabel: "Open Admin Area",
    buttonUrl: `${context.siteUrl}/admin`,
  });

  return {
    subject,
    html,
    text,
  };
}

export function buildBookingConfirmedEmail(
  payload: Record<string, unknown>,
): EmailContent {
  const { firstName, slotDate, slotTime } = getBookingDetails(payload);

  const subject = "Your booking has been confirmed";

  const text = [
    `Hello ${firstName},`,
    "",
    "Your booking with Amanda Beach has been confirmed.",
    "",
    `Date: ${slotDate}`,
    `Time: ${slotTime}`,
    "",
    "Amanda looks forward to seeing you.",
  ].join("\n");

  const html = getEmailLayout({
    eyebrow: "Booking Confirmed",
    heading: "Your appointment is confirmed.",
    body: `
      <p style="margin: 0;">
        Hello ${escapeHtml(firstName)}. Your booking with Amanda Beach has
        been confirmed.
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

export function buildBookingCancelledEmail(
  payload: Record<string, unknown>,
): EmailContent {
  const { firstName, slotDate, slotTime } = getBookingDetails(payload);

  const subject = "Your booking has been cancelled";

  const text = [
    `Hello ${firstName},`,
    "",
    "Your booking with Amanda Beach has been cancelled.",
    "",
    `Date: ${slotDate}`,
    `Time: ${slotTime}`,
    "",
    "Please reply to this email if you have any questions.",
  ].join("\n");

  const html = getEmailLayout({
    eyebrow: "Booking Cancelled",
    heading: "Your appointment has been cancelled.",
    body: `
      <p style="margin: 0;">
        Hello ${escapeHtml(firstName)}. Your booking with Amanda Beach has
        been cancelled.
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
