import { supabase } from "../lib/supabase.ts";

function getBookingTimestampColumn(emailType: string): string | null {
  switch (emailType) {
    case "booking_request_customer":
      return "request_email_sent_at";

    case "booking_request_admin":
      return "admin_notification_sent_at";

    case "booking_confirmed":
      return "confirmation_email_sent_at";

    case "booking_cancelled":
      return "cancellation_email_sent_at";

    case "part_payment_received":
    case "payment_received":
      return "payment_email_sent_at";

    case "booking_reminder_24h":
      return "reminder_24h_sent_at";

    default:
      return null;
  }
}

export async function markEmailAsProcessing(
  emailLogId: string,
): Promise<number> {
  const { data: emailLog, error: readError } = await supabase
    .from("booking_email_log")
    .select("attempts, status")
    .eq("id", emailLogId)
    .single();

  if (readError) {
    throw new Error(`Failed to read email log: ${readError.message}`);
  }

  if (emailLog.status === "sent") {
    return Number(emailLog.attempts ?? 0);
  }

  const nextAttemptCount = Number(emailLog.attempts ?? 0) + 1;

  const { error: updateError } = await supabase
    .from("booking_email_log")
    .update({
      status: "processing",
      attempts: nextAttemptCount,
      last_attempt_at: new Date().toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", emailLogId);

  if (updateError) {
    throw new Error(
      `Failed to mark email as processing: ${updateError.message}`,
    );
  }

  return nextAttemptCount;
}

export async function markEmailAsSent({
  emailLogId,
  bookingId,
  emailType,
  resendEmailId,
}: {
  emailLogId: string;
  bookingId: string;
  emailType: string;
  resendEmailId: string;
}): Promise<void> {
  const sentAt = new Date().toISOString();

  const { error: logError } = await supabase
    .from("booking_email_log")
    .update({
      status: "sent",
      resend_email_id: resendEmailId,
      sent_at: sentAt,
      failed_at: null,
      error_message: null,
      updated_at: sentAt,
    })
    .eq("id", emailLogId);

  if (logError) {
    throw new Error(`Failed to update email log: ${logError.message}`);
  }

  const timestampColumn = getBookingTimestampColumn(emailType);

  if (!timestampColumn) {
    return;
  }

  const { error: bookingError } = await supabase
    .from("bookings")
    .update({
      [timestampColumn]: sentAt,
      updated_at: sentAt,
    })
    .eq("id", bookingId);

  if (bookingError) {
    throw new Error(
      `Email sent, but booking timestamp update failed: ${bookingError.message}`,
    );
  }
}

export async function markEmailAsFailed(
  emailLogId: string,
  error: unknown,
  permanentlyFailed: boolean,
): Promise<boolean> {
  const message =
    error instanceof Error ? error.message : "Unknown email processing error";

  const failedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("booking_email_log")
    .update({
      status: permanentlyFailed ? "failed" : "queued",
      failed_at: permanentlyFailed ? failedAt : null,
      error_message: message.slice(0, 2000),
      updated_at: failedAt,
    })
    .eq("id", emailLogId);

  if (updateError) {
    console.error(
      `Failed to record error for email log ${emailLogId}:`,
      updateError,
    );

    return false;
  }

  return true;
}
