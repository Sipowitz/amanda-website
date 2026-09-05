import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = () => read("../supabase/migrations/20260818001000_direct_payment_phase_one.sql");
const paymentFunction = () => read("../supabase/functions/square-payment/index.ts");
const webhookFunction = () => read("../supabase/functions/square-webhook/index.ts");
const bookingPage = () => read("../src/pages/Booking.jsx");

test("Voice Memo alone is explicitly configured for direct payment", async () => {
  const sql = await migration();
  assert.match(sql, /slug = 'voice-memo-reading'[\s\S]*then 'direct_payment'/);
  assert.doesNotMatch(sql, /when booking_mode = 'untimed'\s+then 'direct_payment'/);
  assert.match(sql, /else 'payment_link'/);
  assert.match(await bookingPage(), /payment_flow === "direct_payment"/);
});

test("browser request cannot provide amount currency or location", async () => {
  const source = await paymentFunction();
  assert.match(source, /action,attemptId,bookingId,paymentAccessToken,sourceToken/);
  assert.doesNotMatch(source, /payload\.(amount|currency|location)/);
  assert.match(source, /amount: submission\.amount_minor/);
  assert.match(source, /currency: submission\.currency/);
  assert.match(source, /location_id: locationId/);
});

test("attempt reservation is concurrent-safe and uses stable Square idempotency", async () => {
  const sql = await migration();
  assert.match(sql, /payment_attempts_one_active_per_booking/);
  assert.match(sql, /where status in \('reserved', 'processing', 'unknown'\)/);
  assert.match(sql, /where id = p_booking_id for update/);
  assert.match(sql, /'sq-' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/);
  assert.match(sql, /length\(idempotency_key\) between 1 and 45/);
  assert.match(await paymentFunction(), /idempotency_key: submission\.idempotency_key/);
  assert.match(await paymentFunction(), /squareResponse = await fetch\(endpoint, squareRequest\)/g);
});

test("duplicate submit cannot issue a second provider request", async () => {
  const sql = await migration();
  const edge = await paymentFunction();
  assert.match(sql, /if selected_attempt\.status <> 'reserved' then[\s\S]*'should_submit', false/);
  assert.match(edge, /if \(submissionError \|\| !submission\?\.should_submit\)/);
  assert.match(edge, /This payment is already being verified\. Do not pay again/);
});

test("lifecycle distinguishes definitive failure from ambiguous outcome", async () => {
  const sql = await migration();
  const edge = await paymentFunction();
  assert.match(sql, /'reserved', 'processing', 'unknown', 'completed', 'failed'/);
  assert.match(edge, /mark_payment_attempt_unknown/);
  assert.match(edge, /\[408, 409, 429\]\.includes\(squareResponse\.status\)/);
  assert.match(edge, /fail_payment_attempt/);
  assert.match(edge, /Payment was declined/);
});

test("only unsubmitted reservations can expire", async () => {
  const sql = await migration();
  const sweep = sql.match(/create function public\.expire_stale_reserved_payment_attempts\(\)[\s\S]*?\n\$\$;/)?.[0] || "";
  assert.match(sweep, /status = 'reserved' and submitted_at is null/);
  assert.doesNotMatch(sweep, /status in \('processing', 'unknown'\)/);
  assert.match(sweep, /select \* into selected_booking from public\.bookings[\s\S]*for update;[\s\S]*select \* into selected_attempt from private\.payment_attempts/);
});

test("provider payment IDs and webhook events are unique", async () => {
  const sql = await migration();
  assert.match(sql, /payment_attempts_provider_payment_unique/);
  assert.match(sql, /primary key \(provider, event_id\)/);
  assert.match(sql, /on conflict \(provider, event_id\) do nothing/);
});

test("API and webhook use the same atomic completion RPC", async () => {
  const sql = await migration();
  assert.match(await paymentFunction(), /rpc\("record_provider_payment_result"/);
  assert.match(await webhookFunction(), /rpc\("record_provider_payment_result"/);
  assert.equal((sql.match(/perform public\.queue_booking_email\(/g) || []).length, 2);
  assert.doesNotMatch(sql, /'payment_received'/);
});

test("completion validates amount currency location reference and active state", async () => {
  const sql = await migration();
  const edge = await paymentFunction();
  assert.match(sql, /selected_attempt\.amount_minor <> p_amount_minor/);
  assert.match(sql, /selected_attempt\.currency <> upper\(p_currency\)/);
  assert.match(sql, /selected_attempt\.provider_location_id <> p_provider_location_id/);
  assert.match(edge, /payment\.reference_id === payload\.attemptId/);
  assert.match(edge, /payment\.location_id === locationId/);
  assert.match(edge, /payment\.amount_money\?\.amount === submission\.amount_minor/);
});

test("webhook verifies raw body with documented signature construction", async () => {
  const source = await webhookFunction();
  assert.ok(source.indexOf("const rawBody = await request.text()") < source.indexOf("JSON.parse(rawBody)"));
  assert.match(source, /notificationUrl \+ rawBody/);
  assert.match(source, /name: "HMAC", hash: "SHA-256"/);
  assert.match(source, /x-square-hmacsha256-signature/);
  assert.match(source, /difference \|=/);
});

test("webhook rejects unrelated or mismatched Square payments", async () => {
  const source = await webhookFunction();
  assert.match(source, /event\.merchant_id !== expectedMerchantId/);
  assert.match(source, /payment\.location_id !== locationId/);
  assert.match(source, /get_payment_attempt_booking/);
  assert.match(source, /Only|COMPLETED/);
});

test("only COMPLETED provider state confirms and pays", async () => {
  const sql = await migration();
  assert.match(sql, /if p_provider_status <> 'COMPLETED'/);
  assert.match(sql, /status = 'confirmed', payment_status = 'paid'/);
  assert.match(sql, /payment_method = 'square'/);
});

test("recovery token is hashed and source token is not persisted", async () => {
  const sql = await migration();
  assert.match(sql, /digest\(payment_access_token, 'sha256'\)/);
  assert.doesNotMatch(sql, /source_token|card_token|cvv/i);
  assert.doesNotMatch(await read("../src/services/paymentRecovery.js"), /sourceToken|card data|cvv/i);
});

test("privileged payment mutation is service-role only", async () => {
  const sql = await migration();
  assert.match(sql, /Service-role access is required/g);
  assert.match(sql, /revoke all on function %s from public, anon, authenticated/);
  assert.match(sql, /Provider-controlled payment fields are read-only/);
});

test("admin cannot confirm unpaid, edit, cancel active, or cancel settled direct payment", async () => {
  const sql = await migration();
  assert.match(sql, /payment provider controls confirmation/);
  assert.match(sql, /selected_attempt\.status in \('processing', 'unknown', 'completed'\)/);
  assert.match(sql, /selected_attempt\.status = 'reserved'[\s\S]*status = 'cancelled'/);
  assert.match(sql, /selected_booking\.payment_status = 'paid'/);
  assert.match(sql, /p_status in \('pending', 'confirmed'\)/);
});

test("frontend does not treat tokenization or API acceptance as payment success", async () => {
  const source = await read("../src/components/booking/SquareCardPayment.jsx");
  assert.match(source, /status\.paid && status\.bookingStatus === "confirmed"/);
  assert.match(source, /status\.paymentStatus === "paid"/);
  assert.match(source, /Do not pay again/);
  assert.match(source, /card\?\.destroy/);
});

test("Square charge tokenization uses the authenticated booking contact", async () => {
  const component = await read("../src/components/booking/SquareCardPayment.jsx");
  const edge = await paymentFunction();
  assert.match(component, /buildSquareVerificationDetails\(context\)/);
  assert.match(edge, /\.select\(bookingContextSelection\)/);
  assert.match(edge, /givenName: booking\.customer_name/);
  assert.match(edge, /email: booking\.customer_email/);
  assert.match(edge, /phone: booking\.customer_phone/);
});

test("Square checkout keeps the authoritative amount visible in its secure UI", async () => {
  const component = await read("../src/components/booking/SquareCardPayment.jsx");
  assert.match(component, /payments\.card\(\{ style: squareCardStyle \}\)/);
  assert.match(component, /fontFamily: "helvetica neue, sans-serif"/);
  assert.doesNotMatch(component, /fontFamily: "Inter, sans-serif"/);
  assert.match(component, /Secure checkout/);
  assert.match(component, /service\.name/);
  assert.match(component, /formatPrice\(context\.amountMinor, context\.currency\)/);
  assert.match(component, /`Pay \$\{displayAmount\} securely`/);
  assert.match(component, /Secure payment powered by Square/);
  assert.match(component, /max-w-lg/);
});

test("Voice Memo request form collapses to one compact summary for payment", async () => {
  const booking = await bookingPage();
  const form = await read("../src/components/booking/BookingForm.jsx");
  const summary = await read("../src/components/booking/BookingRequestSummary.jsx");
  assert.match(booking, /showingDirectPayment && \([\s\S]*<BookingRequestSummary[\s\S]*<SquareCardPayment/);
  assert.match(booking, /\) : \([\s\S]*<BookingForm/);
  assert.match(form, /name="name"[\s\S]*required/);
  assert.match(form, /name="email"[\s\S]*required/);
  assert.match(form, /name="phone"[\s\S]*required/);
  assert.match(form, /name="message"[\s\S]*required=\{!isTimed\}/);
  assert.match(summary, /details\.name/);
  assert.match(summary, /details\.email/);
  assert.match(summary, /details\.phone &&/);
  assert.match(summary, /details\.message/);
  assert.match(booking, /onBookingRecovered=\{handleBookingRecovered\}/);
  assert.match(await paymentFunction(), /message: booking\.customer_message/);
});

test("timed Stripe Payment Link infrastructure remains present", async () => {
  const sql = await read("../supabase/migrations/20260817213000_service_stripe_payment_links.sql");
  assert.match(sql, /stripe_payment_link_url/);
  assert.match(sql, /'private-readings'/);
  assert.match(sql, /stripe_payment_link_url/);
  assert.match(await migration(), /else 'payment_link'/);
});
