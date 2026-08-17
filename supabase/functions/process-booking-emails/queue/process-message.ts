import { MAX_DELIVERY_ATTEMPTS, siteUrl } from "../config.ts";
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

export type QueueMessageResult = {
  messageId: number;
  status: "sent" | "retrying" | "permanently_failed";
  attemptCount: number;
  error?: string;
};

type SendResult = {
  disposition: "sent" | "already_sent" | "already_failed";
  attemptCount: number;
  error?: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown email processing error";
}

async function sendEmail(
  queueMessage: QueueMessage,
  onAttemptStarted: (attemptCount: number) => void,
): Promise<SendResult> {
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
    .select("status, attempts, resend_email_id, error_message")
    .eq("id", emailLogId)
    .single();

  if (existingLogError) {
    throw new Error(
      `Unable to load email audit record: ${existingLogError.message}`,
    );
  }

  const existingAttemptCount = Number(existingLog.attempts ?? 0);
  onAttemptStarted(existingAttemptCount);

  if (existingLog.status === "sent") {
    return {
      disposition: "already_sent",
      attemptCount: existingAttemptCount,
    };
  }

  if (existingAttemptCount >= MAX_DELIVERY_ATTEMPTS) {
    return {
      disposition: "already_failed",
      attemptCount: existingAttemptCount,
      error: existingLog.error_message || "Maximum delivery attempts reached",
    };
  }

  const attemptCount = await markEmailAsProcessing(emailLogId);
  onAttemptStarted(attemptCount);

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
    disposition: "sent",
    attemptCount,
  };
}

export async function processQueueMessage(
  queueMessage: QueueMessage,
): Promise<QueueMessageResult> {
  const emailLogId = queueMessage.message?.email_log_id;
  let attemptCount = 0;
  let durableAttemptCountKnown = false;

  let sendResult: SendResult;

  try {
    sendResult = await sendEmail(queueMessage, (currentAttemptCount) => {
      durableAttemptCountKnown = true;
      attemptCount = currentAttemptCount;
    });
  } catch (error) {
    if (!durableAttemptCountKnown) {
      attemptCount = Math.max(Number(queueMessage.read_ct) || 0, 1);
    }

    const errorMessage = getErrorMessage(error);
    const permanentlyFailed = attemptCount >= MAX_DELIVERY_ATTEMPTS;

    console.error(
      `Email delivery failed for queue message ${queueMessage.msg_id} ` +
        `(attempt ${attemptCount}/${MAX_DELIVERY_ATTEMPTS}):`,
      error,
    );

    const failureRecorded = emailLogId
      ? await markEmailAsFailed(emailLogId, error, permanentlyFailed)
      : true;

    if (permanentlyFailed) {
      if (!failureRecorded) {
        return {
          messageId: queueMessage.msg_id,
          status: "retrying",
          attemptCount,
          error: `Final delivery failure could not be recorded: ${errorMessage}`,
        };
      }

      try {
        await archiveQueueMessage(queueMessage.msg_id);
      } catch (archiveError) {
        console.error(
          `Permanently failed queue message ${queueMessage.msg_id} could not be archived:`,
          archiveError,
        );
      }

      return {
        messageId: queueMessage.msg_id,
        status: "permanently_failed",
        attemptCount,
        error: errorMessage,
      };
    }

    return {
      messageId: queueMessage.msg_id,
      status: "retrying",
      attemptCount,
      error: errorMessage,
    };
  }

  if (sendResult.disposition === "already_failed" && emailLogId) {
    const failureRecorded = await markEmailAsFailed(
      emailLogId,
      new Error(sendResult.error || "Maximum delivery attempts reached"),
      true,
    );

    if (!failureRecorded) {
      return {
        messageId: queueMessage.msg_id,
        status: "retrying",
        attemptCount: sendResult.attemptCount,
        error: "Final delivery failure could not be recorded",
      };
    }
  }

  try {
    await archiveQueueMessage(queueMessage.msg_id);
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    console.error(
      `Queue message ${queueMessage.msg_id} was not archived after ` +
        `${sendResult.disposition}:`,
      error,
    );

    return {
      messageId: queueMessage.msg_id,
      status: "retrying",
      attemptCount: sendResult.attemptCount,
      error: errorMessage,
    };
  }

  if (sendResult.disposition === "already_failed") {
    console.log(
      `Archived previously exhausted queue message ${queueMessage.msg_id}`,
    );

    return {
      messageId: queueMessage.msg_id,
      status: "permanently_failed",
      attemptCount: sendResult.attemptCount,
      error: sendResult.error,
    };
  }

  console.log(
    `Processed and archived queue message ${queueMessage.msg_id} ` +
      `(${sendResult.disposition})`,
  );

  return {
    messageId: queueMessage.msg_id,
    status: "sent",
    attemptCount: sendResult.attemptCount,
  };
}
