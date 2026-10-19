import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  MAX_MESSAGES_PER_RUN,
  QUEUE_NAME,
  QUEUE_VISIBILITY_TIMEOUT_SECONDS,
} from "./config.ts";
import { supabase } from "./lib/supabase.ts";
import { processQueueMessage } from "./queue/process-message.ts";
import type { QueueMessage } from "./types.ts";

function secretsMatch(supplied: string, expected: string): boolean {
  const suppliedBytes = new TextEncoder().encode(supplied);
  const expectedBytes = new TextEncoder().encode(expected);
  let difference = suppliedBytes.length ^ expectedBytes.length;

  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= (suppliedBytes[index] ?? 0) ^ expectedBytes[index];
  }

  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed",
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          Allow: "POST",
        },
      },
    );
  }

  const expectedSecret = Deno.env.get("EMAIL_PROCESSOR_SECRET");
  if (!expectedSecret) {
    return Response.json(
      { error: "Email processor authentication is not configured" },
      { status: 503 },
    );
  }

  const suppliedSecret = request.headers.get("X-Email-Processor-Secret");
  if (!suppliedSecret || !secretsMatch(suppliedSecret, expectedSecret)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const { data: messages, error: readError } = await supabase
      .schema("pgmq_public")
      .rpc("read", {
        queue_name: QUEUE_NAME,
        sleep_seconds: QUEUE_VISIBILITY_TIMEOUT_SECONDS,
        n: MAX_MESSAGES_PER_RUN,
      });

    if (readError) {
      throw new Error(
        `Failed to read booking email queue: ${readError.message}`,
      );
    }

    const queueMessages = (messages || []) as QueueMessage[];

    if (queueMessages.length === 0) {
      const summary = {
        messagesRead: 0,
        sent: 0,
        retrying: 0,
        permanentlyFailed: 0,
      };

      console.log("Booking email queue summary", summary);

      return new Response(
        JSON.stringify({
          message: "No booking emails are waiting",
          ...summary,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    const { data: emailSettings, error: settingsError } = await supabase
      .from("email_settings")
      .select("timezone")
      .eq("id", true)
      .single();

    if (settingsError || !emailSettings?.timezone) {
      throw new Error(
        `Failed to load email timezone: ${settingsError?.message || "timezone is missing"}`,
      );
    }

    const settledResults = await Promise.allSettled(
      queueMessages.map((queueMessage) =>
        processQueueMessage(queueMessage, emailSettings.timezone)
      ),
    );

    const results = settledResults.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }

      const queueMessage = queueMessages[index];
      const error = result.reason instanceof Error
        ? result.reason.message
        : "Unexpected queue processing error";

      console.error(
        `Unexpected failure processing queue message ${queueMessage.msg_id}:`,
        result.reason,
      );

      return {
        messageId: queueMessage.msg_id,
        status: "retrying" as const,
        attemptCount: Math.max(Number(queueMessage.read_ct) || 0, 1),
        error,
      };
    });

    const summary = {
      messagesRead: queueMessages.length,
      sent: results.filter((result) => result.status === "sent").length,
      retrying: results.filter((result) => result.status === "retrying").length,
      permanentlyFailed: results.filter(
        (result) => result.status === "permanently_failed",
      ).length,
    };

    console.log("Booking email queue summary", summary);

    return new Response(
      JSON.stringify({
        message: "Booking email queue processed",
        ...summary,
        results,
      }),
      {
        status:
          summary.retrying > 0 || summary.permanentlyFailed > 0 ? 207 : 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("Queue processor failed:", error);

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unknown queue processor error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
});
