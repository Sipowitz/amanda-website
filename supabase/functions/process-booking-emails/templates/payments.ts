import type { EmailContent, EmailTemplateContext } from "../types.ts";

import {
  escapeHtml,
  formatBookingAppointment,
  formatCurrency,
  getCustomerFirstName,
} from "../lib/formatters.ts";
import { getEmailLayout } from "../lib/layout.ts";

function getPaymentDetails(
  payload: Record<string, unknown>,
  timezone: string,
) {
  const customerName = String(payload.customer_name ?? "");
  const serviceName = String(payload.service_name ?? "Booking");
  const bookingMode = String(payload.service_booking_mode ?? "timed");
  const hasAppointment =
    bookingMode === "timed" &&
    Boolean(payload.slot_date) &&
    Boolean(payload.slot_time);

  const appointment = hasAppointment
    ? formatBookingAppointment(
      payload.slot_date,
      payload.slot_time,
      timezone,
    )
    : null;

  return {
    firstName: getCustomerFirstName(customerName),
    serviceName,
    currency: String(payload.service_currency ?? "USD"),
    hasAppointment,
    slotDate: appointment?.date ?? "",
    slotTime: appointment?.time ?? "",
  };
}

function getBookingRows(details: ReturnType<typeof getPaymentDetails>) {
  return [
    { label: "Service", value: details.serviceName },
    ...(details.hasAppointment
      ? [
        { label: "Date", value: details.slotDate },
        { label: "Time", value: details.slotTime },
      ]
      : []),
  ];
}

export function buildPartPaymentReceivedEmail(
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  const details = getPaymentDetails(payload, context.timezone);
  const amountReceived = formatCurrency(
    payload.amount_received,
    details.currency,
  );
  const amountPaid = formatCurrency(payload.amount_paid, details.currency);
  const amountRemaining = formatCurrency(
    payload.amount_remaining,
    details.currency,
  );
  const paymentMethod = String(payload.payment_method ?? "");
  const paymentReference = String(payload.payment_reference ?? "");

  const subject = "Part payment received";

  const text = [
    `Hello ${details.firstName},`,
    "",
    `Thank you. We have received your payment of ${amountReceived}.`,
    "",
    `Service: ${details.serviceName}`,
    `Total paid: ${amountPaid}`,
    `Remaining balance: ${amountRemaining}`,
    details.hasAppointment ? `Date: ${details.slotDate}` : "",
    details.hasAppointment ? `Time: ${details.slotTime}` : "",
    paymentMethod ? `Payment method: ${paymentMethod}` : "",
    paymentReference ? `Payment reference: ${paymentReference}` : "",
    "",
    "The remaining balance is still due.",
  ].filter(Boolean).join("\n");

  const paymentRows = [
    { label: "Received", value: amountReceived },
    { label: "Total Paid", value: amountPaid },
    { label: "Remaining", value: amountRemaining },
    ...getBookingRows(details),
  ];

  if (paymentMethod) {
    paymentRows.push({ label: "Method", value: paymentMethod });
  }

  if (paymentReference) {
    paymentRows.push({ label: "Reference", value: paymentReference });
  }

  const html = getEmailLayout({
    eyebrow: "Part Payment Received",
    heading: "Thank you.",
    body: `
      <p style="margin: 0;">
        We have received your payment of
        <strong>${escapeHtml(amountReceived)}</strong>.
      </p>

      <p style="margin: 16px 0 0;">
        The remaining balance is
        <strong>${escapeHtml(amountRemaining)}</strong>.
      </p>
    `,
    details: paymentRows,
  });

  return { subject, html, text };
}

export function buildPaymentReceivedEmail(
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  const details = getPaymentDetails(payload, context.timezone);
  const amountPaid = formatCurrency(payload.amount_paid, details.currency);
  const subject = "Payment received";

  const text = [
    `Hello ${details.firstName},`,
    "",
    `We have received your payment of ${amountPaid}.`,
    "",
    `Service: ${details.serviceName}`,
    details.hasAppointment ? `Date: ${details.slotDate}` : "",
    details.hasAppointment ? `Time: ${details.slotTime}` : "",
    "",
    "Thank you.",
  ].filter(Boolean).join("\n");

  const html = getEmailLayout({
    eyebrow: "Payment Received",
    heading: "Thank you.",
    body: `
      <p style="margin: 0;">
        We have received your payment of
        <strong>${escapeHtml(amountPaid)}</strong>.
      </p>
    `,
    details: [
      { label: "Amount", value: amountPaid },
      ...getBookingRows(details),
    ],
  });

  return { subject, html, text };
}
