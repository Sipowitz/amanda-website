import { siteUrl } from "../config.ts";
import { supabase } from "../lib/supabase.ts";
import { sendWithResend } from "../services/resend.ts";
import { buildEmail } from "../templates/index.ts";
import type { QueueMessage } from "../types.ts";
import { archiveQueueMessage } from "./archive.ts";
import {
  markEmailAsFailed,
  markEmailAsProcessing,
  markEmailAsSent,
} from "./email-log.ts";

async function sendEmail(
  queueMessage: QueueMessage,
): Promise<{
  resendEmailId: string;
}> {
  const {
    email_log_id: emailLogId,
    booking_id: bookingId,
    email_type: emailType,
    recipient_email: recipientEmail,
    payload = {},
  } = queueMessage.message;

  if (!emailLogId || !bookingId || !emailType || !recipientEmail) {
    throw new Error("Queue message is missing required email fields");
  }

  const { data: existingLog, error: existingLogError } = await supabase
    .from("booking_email_log")
    .select("status, resend_email_id")
    .eq("id", emailLogId)
    .single();

  if (existingLogError) {
    throw new Error(
      `Unable to load email audit record: ${existingLogError.message}`,
    );
  }

  if (existingLog.status === "sent") {
    return {
      resendEmailId: existingLog.resend_email_id || "already-sent",
    };
  }

  await markEmailAsProcessing(emailLogId);

  const emailContent = buildEmail(emailType, payload, {
    siteUrl,
  });

  const resendEmailId = await sendWithResend({
    emailLogId,
    bookingId,
    emailType,
    recipientEmail,
    emailContent,
  });

  await markEmailAsSent({
    emailLogId,
    bookingId,
    emailType,
    resendEmailId,
  });

  return {
    resendEmailId,
  };
}

export async function processQueueMessage(
  queueMessage: QueueMessage,
): Promise<{
  messageId: number;
  success: boolean;
  error?: string;
}> {
  const emailLogId = queueMessage.message?.email_log_id;

  try {
    await sendEmail(queueMessage);
    await archiveQueueMessage(queueMessage.msg_id);

    console.log(
      `Successfully processed queue message ${queueMessage.msg_id}`,
    );

    return {
      messageId: queueMessage.msg_id,
      success: true,
    };
  } catch (error) {
    console.error(
      `Failed to process queue message ${queueMessage.msg_id}:`,
      error,
    );

    if (emailLogId) {
      await markEmailAsFailed(emailLogId, error);
    }

    return {
      messageId: queueMessage.msg_id,
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown email processing error",
    };
  }
}
