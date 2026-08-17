function requireEnvironmentVariable(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const QUEUE_NAME = "booking_emails";
export const QUEUE_VISIBILITY_TIMEOUT_SECONDS = 60;
export const MAX_MESSAGES_PER_RUN = 10;
export const MAX_DELIVERY_ATTEMPTS = 3;

export const supabaseUrl = requireEnvironmentVariable("SUPABASE_URL");
export const supabaseServiceRoleKey = requireEnvironmentVariable(
  "SUPABASE_SERVICE_ROLE_KEY",
);
export const resendApiKey = requireEnvironmentVariable("RESEND_API_KEY");
export const bookingFromEmail = requireEnvironmentVariable(
  "BOOKING_FROM_EMAIL",
);
export const bookingReplyToEmail = requireEnvironmentVariable(
  "BOOKING_REPLY_TO_EMAIL",
);
export const siteUrl = requireEnvironmentVariable("SITE_URL").replace(
  /\/+$/,
  "",
);
