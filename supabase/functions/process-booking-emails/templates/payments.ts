import type { EmailContent } from "../types.ts";

import {
  escapeHtml,
  formatBookingDate,
  formatCurrency,
  getCustomerFirstName,
} from "../lib/formatters.ts";
import { getEmailLayout } from "../lib/layout.ts";

function getPaymentDetails(payload: Record<string, unknown>) {
  const customerName = String(payload.customer_name ?? "");

  return {
    firstName: getCustomerFirstName(customerName),
    slotDate: formatBookingDate(payload.slot_date),
    slotTime: String(payload.slot_time ?? "Time to be confirmed"),
  };
}

export function buildPartPaymentReceivedEmail(
  payload: Record<string, unknown>,
): EmailContent {
  const { firstName, slotDate, slotTime } = getPaymentDetails(payload);

  const amountReceived = formatCurrency(payload.amount_received);
  const amountPaid = formatCurrency(payload.amount_paid);
  const amountRemaining = formatCurrency(payload.amount_remaining);
  const paymentMethod = String(payload.payment_method ?? "");
  const paymentReference = String(payload.payment_reference ?? "");

  const subject = "Part payment received";

  const text = [
    `Hello ${firstName},`,
    "",
    `Thank you. We have received your payment of ${amountReceived}.`,
    "",
    `Total paid: ${amountPaid}`,
    `Remaining balance: ${amountRemaining}`,
    `Date: ${slotDate}`,
    `Time: ${slotTime}`,
    paymentMethod ? `Payment method: ${paymentMethod}` : "",
    paymentReference ? `Payment reference: ${paymentReference}` : "",
    "",
    "The remaining balance can be paid before your appointment.",
  ]
    .filter(Boolean)
    .join("\n");

  const details = [
    {
      label: "Received",
      value: amountReceived,
    },
    {
      label: "Total Paid",
      value: amountPaid,
    },
    {
      label: "Remaining",
      value: amountRemaining,
    },
    {
      label: "Date",
      value: slotDate,
    },
    {
      label: "Time",
      value: slotTime,
    },
  ];

  if (paymentMethod) {
    details.push({
      label: "Method",
      value: paymentMethod,
    });
  }

  if (paymentReference) {
    details.push({
      label: "Reference",
      value: paymentReference,
    });
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
    details,
  });

  return {
    subject,
    html,
    text,
  };
}

export function buildPaymentReceivedEmail(
  payload: Record<string, unknown>,
): EmailContent {
  const { firstName, slotDate, slotTime } = getPaymentDetails(payload);

  const amountPaid = formatCurrency(payload.amount_paid);
  const subject = "Payment received";

  const text = [
    `Hello ${firstName},`,
    "",
    `We have received your payment of ${amountPaid}.`,
    "",
    `Date: ${slotDate}`,
    `Time: ${slotTime}`,
    "",
    "Thank you.",
  ].join("\n");

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
      {
        label: "Amount",
        value: amountPaid,
      },
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
