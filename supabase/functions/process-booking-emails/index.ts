import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  MAX_MESSAGES_PER_RUN,
  QUEUE_NAME,
  QUEUE_VISIBILITY_TIMEOUT_SECONDS,
} from "./config.ts";
import { supabase } from "./lib/supabase.ts";
import { processQueueMessage } from "./queue/process-message.ts";
import type { QueueMessage } from "./types.ts";

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
      return new Response(
        JSON.stringify({
          message: "No booking emails are waiting",
          processed: 0,
          succeeded: 0,
          failed: 0,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    const results = [];

    for (const queueMessage of queueMessages) {
      results.push(await processQueueMessage(queueMessage));
    }

    const succeeded = results.filter((result) => result.success).length;
    const failed = results.length - succeeded;

    return new Response(
      JSON.stringify({
        message: "Booking email queue processed",
        processed: results.length,
        succeeded,
        failed,
        results,
      }),
      {
        status: failed > 0 ? 207 : 200,
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
