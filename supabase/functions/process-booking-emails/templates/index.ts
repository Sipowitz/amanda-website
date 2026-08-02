import type {
  EmailContent,
  EmailTemplateContext,
} from "../types.ts";

import {
  buildBookingCancelledEmail,
  buildBookingConfirmedEmail,
  buildBookingRequestAdminEmail,
  buildBookingRequestCustomerEmail,
} from "./booking.ts";
import {
  buildPartPaymentReceivedEmail,
  buildPaymentReceivedEmail,
} from "./payments.ts";
import {
  buildAdminReminderEmail,
  buildCustomerReminderEmail,
} from "./reminders.ts";

export function buildEmail(
  emailType: string,
  payload: Record<string, unknown>,
  context: EmailTemplateContext,
): EmailContent {
  switch (emailType) {
    case "booking_request_customer":
      return buildBookingRequestCustomerEmail(payload, context);

    case "booking_request_admin":
      return buildBookingRequestAdminEmail(payload, context);

    case "booking_confirmed":
      return buildBookingConfirmedEmail(payload);

    case "booking_cancelled":
      return buildBookingCancelledEmail(payload);

    case "part_payment_received":
      return buildPartPaymentReceivedEmail(payload);

    case "payment_received":
      return buildPaymentReceivedEmail(payload);

    case "booking_reminder_24h":
    case "booking_reminder_customer":
      return buildCustomerReminderEmail(payload);

    case "booking_reminder_admin":
      return buildAdminReminderEmail(payload, context);

    default:
      throw new Error(`Unsupported email type: ${emailType}`);
  }
}
