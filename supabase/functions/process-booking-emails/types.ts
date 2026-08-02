export interface QueueMessagePayload {
  email_log_id: string;
  booking_id: string;
  email_type: string;
  recipient_email: string;
  recipient_name?: string | null;
  reminder_key?: string | null;
  payload?: Record<string, unknown>;
}

export interface QueueMessage {
  msg_id: number;
  read_ct: number;
  vt: string;
  enqueued_at: string;
  message: QueueMessagePayload;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
  statusCode?: number;
}

export interface EmailTemplateContext {
  siteUrl: string;
}
