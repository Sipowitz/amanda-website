import {
  bookingFromEmail,
  bookingReplyToEmail,
  resendApiKey,
} from "../config.ts";
import type {
  EmailContent,
  ResendResponse,
} from "../types.ts";

export async function sendWithResend({
  emailLogId,
  bookingId,
  emailType,
  recipientEmail,
  emailContent,
}: {
  emailLogId: string;
  bookingId: string;
  emailType: string;
  recipientEmail: string;
  emailContent: EmailContent;
}): Promise<string> {
  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `booking-email-${emailLogId}`,
    },
    body: JSON.stringify({
      from: bookingFromEmail,
      to: [recipientEmail],
      reply_to: bookingReplyToEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      tags: [
        {
          name: "email_type",
          value: emailType,
        },
        {
          name: "booking_id",
          value: bookingId.replaceAll("-", "_"),
        },
      ],
    }),
  });

  const responseBody = (await resendResponse.json()) as ResendResponse;

  if (!resendResponse.ok || !responseBody.id) {
    throw new Error(
      responseBody.message ||
        `Resend returned HTTP ${resendResponse.status}`,
    );
  }

  return responseBody.id;
}
