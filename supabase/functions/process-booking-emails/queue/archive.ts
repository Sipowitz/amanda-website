import { QUEUE_NAME } from "../config.ts";
import { supabase } from "../lib/supabase.ts";

export async function archiveQueueMessage(messageId: number): Promise<void> {
  const { error } = await supabase
    .schema("pgmq_public")
    .rpc("archive", {
      queue_name: QUEUE_NAME,
      message_id: messageId,
    });

  if (error) {
    throw new Error(`Failed to archive queue message: ${error.message}`);
  }
}
