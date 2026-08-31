import type {
  EmailContent,
  EmailTemplateContext,
} from "../types.ts";

import {
  escapeHtml,
  formatBookingAppointment,
  formatCurrency,
  getCustomerFirstName,
} from "../lib/formatters.ts";
import { getEmailLayout } from "../lib/layout.ts";

function getBookingDetails(
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
    customerName,
    firstName: getCustomerFirstName(customerName),
    serviceName,
    hasAppointment,
    slotDate: appointment?.date ?? "",
    slotTime: appointment?.time ?? "",
  };
}

function getConfirmationPaymentDetails(payload: Record<string, unknown>) {
  const amountDue = Number(payload.amount_due ?? 0);
  const amountPaid = Number(payload.amount_paid ?? 0);
  const amountRemaining = Math.max(amountDue - amountPaid, 0);
  const paymentStatus = String(payload.payment_status ?? "unpaid");
  const currency = String(payload.service_currency ?? "USD");
  const basePaymentLink = String(payload.stripe_payment_link_url ?? "").trim();
  const bookingId = String(payload.booking_id ?? "").trim();
  const customerEmail = String(payload.customer_email ?? "").trim();
  const paymentSettled =
    ["paid", "waived"].includes(paymentStatus) || amountDue <= amountPaid;
  const embeddedCheckoutPayment =
    payload.embedded_checkout_payment === true;
  const amountLabel = embeddedCheckoutPayment
    ? "Payment received"
    : amountPaid > 0 || paymentSettled ? "Amount remaining" : "Amount due";
  const amountValue = formatCurrency(
    embeddedCheckoutPayment
      ? amountPaid
      : amountPaid > 0 || paymentSettled ? amountRemaining : amountDue,
    currency,
  );

  let paymentUrl = "";

  if (
    basePaymentLink &&
    bookingId &&
    customerEmail &&
    !paymentSettled
  ) {
    try {
      const url = new URL(basePaymentLink);
      url.searchParams.set("client_reference_id", bookingId);
      url.searchParams.set("locked_prefilled_email", customerEmail);
      paymentUrl = url.toString();
    } catch {
      paymentUrl = "";
    }
  }

  return { amountLabel, amountValue, paymentUrl };
}

function getBookingDetailRows(
  details: ReturnType<typeof getBookingDetails>,
) {
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

export function buildBookingRequestCustomerEmail(
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  const details = getBookingDetails(payload, context.timezone);
  const subject = "We've received your booking request";

  const text = [
    `Hello ${details.firstName},`,
    "",
    "Thank you for your booking request.",
    "",
    `Service: ${details.serviceName}`,
    details.hasAppointment ? `Requested date: ${details.slotDate}` : "",
    details.hasAppointment ? `Requested time: ${details.slotTime}` : "",
    "",
    "Amanda will review your request and contact you when your booking has been confirmed.",
    "",
    "Amanda Beach",
  ].filter(Boolean).join("\n");

  const html = getEmailLayout({
    eyebrow: "Booking Request",
    heading: `Thank you, ${details.firstName}.`,
    body: `
      <p style="margin: 0;">
        We've received your booking request. Amanda will review it and
        contact you when your booking has been confirmed.
      </p>
    `,
    details: getBookingDetailRows(details),
    buttonLabel: "Visit Amanda Beach",
    buttonUrl: context.siteUrl,
  });

  return { subject, html, text };
}

export function buildBookingRequestAdminEmail(
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  const details = getBookingDetails(payload, context.timezone);
  const customerEmail = String(payload.customer_email ?? "");
  const customerPhone = String(payload.customer_phone ?? "");
  const customerMessage = String(payload.customer_message ?? "");

  const subject =
    `New booking request from ${details.customerName || "a customer"}`;

  const text = [
    "A new booking request has been received.",
    "",
    `Customer: ${details.customerName}`,
    `Email: ${customerEmail}`,
    `Phone: ${customerPhone || "Not provided"}`,
    `Service: ${details.serviceName}`,
    details.hasAppointment ? `Date: ${details.slotDate}` : "",
    details.hasAppointment ? `Time: ${details.slotTime}` : "",
    `Message: ${customerMessage || "No message supplied"}`,
    "",
    `Admin: ${context.siteUrl}/admin/bookings`,
  ].filter(Boolean).join("\n");

  const html = getEmailLayout({
    eyebrow: "New Booking Request",
    heading: details.customerName || "New customer",
    body: `
      <p style="margin: 0;">
        A new booking request has been submitted through the website.
      </p>
    `,
    details: [
      { label: "Email", value: customerEmail },
      { label: "Telephone", value: customerPhone || "Not provided" },
      ...getBookingDetailRows(details),
      { label: "Message", value: customerMessage || "No message supplied" },
    ],
    buttonLabel: "Open Admin Area",
    buttonUrl: `${context.siteUrl}/admin/bookings`,
  });

  return { subject, html, text };
}

export function buildBookingConfirmedEmail(
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  const details = getBookingDetails(payload, context.timezone);
  const payment = getConfirmationPaymentDetails(payload);
  const subject = "Your booking has been confirmed";

  const text = [
    `Hello ${details.firstName},`,
    "",
    "Your booking with Amanda Beach has been confirmed.",
    "",
    `Service: ${details.serviceName}`,
    details.hasAppointment ? `Date: ${details.slotDate}` : "",
    details.hasAppointment ? `Time: ${details.slotTime}` : "",
    `${payment.amountLabel}: ${payment.amountValue}`,
    payment.paymentUrl ? `Pay now: ${payment.paymentUrl}` : "",
    "",
    "Amanda looks forward to working with you.",
  ].filter(Boolean).join("\n");

  const html = getEmailLayout({
    eyebrow: "Booking Confirmed",
    heading: "Your booking is confirmed.",
    body: `
      <p style="margin: 0;">
        Hello ${escapeHtml(details.firstName)}. Your booking with Amanda Beach
        has been confirmed.
      </p>
    `,
    details: [
      ...getBookingDetailRows(details),
      { label: payment.amountLabel, value: payment.amountValue },
    ],
    buttonLabel: payment.paymentUrl ? "Pay now" : undefined,
    buttonUrl: payment.paymentUrl || undefined,
  });

  return { subject, html, text };
}

export function buildBookingCancelledEmail(
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  const details = getBookingDetails(payload, context.timezone);
  const subject = "Your booking has been cancelled";

  const text = [
    `Hello ${details.firstName},`,
    "",
    "Your booking with Amanda Beach has been cancelled.",
    "",
    `Service: ${details.serviceName}`,
    details.hasAppointment ? `Date: ${details.slotDate}` : "",
    details.hasAppointment ? `Time: ${details.slotTime}` : "",
    "",
    "Please reply to this email if you have any questions.",
  ].filter(Boolean).join("\n");

  const html = getEmailLayout({
    eyebrow: "Booking Cancelled",
    heading: "Your booking has been cancelled.",
    body: `
      <p style="margin: 0;">
        Hello ${escapeHtml(details.firstName)}. Your booking with Amanda Beach
        has been cancelled.
      </p>
    `,
    details: getBookingDetailRows(details),
  });

  return { subject, html, text };
}
