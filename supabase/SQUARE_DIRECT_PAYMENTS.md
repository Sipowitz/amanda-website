# Square direct payments

This phase accepts a card payment for the untimed **Voice Memo Reading** only.
The browser tokenizes card details with Square Web Payments SDK and sends the
single-use source token to `square-payment`. The Edge Function reserves a
database attempt before calling Square CreatePayment. Price, currency,
location, and the 45-character-or-shorter idempotency key come exclusively
from server-controlled state.

Timed services, including the $85 Private Reading, continue to use the existing
Stripe Payment Link workflow. Do not remove or repurpose
`stripe_payment_link_url`.

## Architecture and recovery

- `create_pending_payment_booking` snapshots the selected service and returns a
  256-bit opaque recovery token. Only its SHA-256 digest is stored.
- `private.payment_attempts` permits one active `reserved`, `processing`, or
  `unknown` attempt per booking. A retry of an attempt retains its Square
  idempotency key. This initial implementation never creates a replacement
  while an outcome is ambiguous.
- The Square source token is submitted once and is never stored or logged.
- A successful CreatePayment response and signed Square webhook use the same
  idempotent `record_provider_payment_result` RPC. Booking completion and the
  two booking email queue entries are one database transaction.
- Refresh recovery checks database status using booking ID plus the opaque
  token. `processing` and `unknown` show “do not pay again.” Only a definitive
  failure or expired never-submitted reservation enables a new attempt.
- `expire_stale_reserved_payment_attempts()` is an optional scheduler target;
  this migration does not schedule it and it cannot expire submitted attempts.

## Configuration

Frontend build variables (public values):

```text
VITE_SQUARE_APPLICATION_ID
VITE_SQUARE_LOCATION_ID
VITE_SQUARE_ENVIRONMENT=sandbox|production
```

Supabase Edge Function secrets (server-only):

```text
PUBLIC_SITE_URL
SQUARE_ACCESS_TOKEN
SQUARE_LOCATION_ID
SQUARE_MERCHANT_ID
SQUARE_WEBHOOK_SIGNATURE_KEY
SQUARE_WEBHOOK_NOTIFICATION_URL
SQUARE_ENVIRONMENT=sandbox|production
SQUARE_API_VERSION=2026-08-19
```

The frontend and server location IDs must identify the same US Square location.
Never place an access token or webhook signature key in a `VITE_` variable.

## Webhook setup

After deploying the reviewed migration and functions, create one webhook
subscription for the exact deployed `square-webhook` HTTPS URL and subscribe to:

```text
payment.created
payment.updated
```

Set `SQUARE_WEBHOOK_NOTIFICATION_URL` to the byte-for-byte same URL configured
in Square. Set the subscription's signature key as
`SQUARE_WEBHOOK_SIGNATURE_KEY`. The function reads the raw request body and
checks `x-square-hmacsha256-signature` using Base64 HMAC-SHA256 over the exact
notification URL followed by the raw body, with constant-time comparison. It
also validates environment, merchant, location, attempt reference, amount,
currency, and payment ID before mutation. Only `COMPLETED` confirms a booking.

## Content Security Policy

This repository does not currently own the production Cloudflare response
headers. Merge the following current Square vendor sources into the existing
Cloudflare policy (retain the site's existing `'self'` and other sources):

```text
Sandbox:
script-src https://sandbox.web.squarecdn.com
frame-src https://sandbox.web.squarecdn.com
connect-src https://pci-connect.squareupsandbox.com https://o160250.ingest.sentry.io
style-src https://sandbox.web.squarecdn.com
font-src https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net

Production:
script-src https://web.squarecdn.com
frame-src https://web.squarecdn.com
connect-src https://pci-connect.squareup.com https://o160250.ingest.sentry.io
style-src https://web.squarecdn.com
font-src https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net
```

Keep the environment-specific host. Confirm the SDK's actual browser requests
in Sandbox before finalizing CSP; do not weaken unrelated directives. Square's
broader sample policy includes `'unsafe-inline'` for styles, but this must be
reviewed against the site's existing policy instead of added automatically.

## Sandbox test procedure

1. Configure only Sandbox application/location values and Sandbox token.
2. Apply the reviewed migration and deploy both functions to the intended test
   project; confirm JWT verification is enabled only for `square-payment`.
3. Create the webhook subscription and send Square's test notification.
4. Open Voice Memo Reading, submit a request, and use a documented Sandbox
   card. Confirm exactly $20.00 USD in the Square Sandbox dashboard.
5. Confirm the booking becomes `confirmed` + `paid`, has payment method
   `square`, and queues exactly one customer confirmation and one admin notice.
6. Replay the webhook and verify no extra email queue entries.
7. Test decline, refresh-before-submit, duplicate click, and an interrupted
   response. An ambiguous attempt must stay blocked pending reconciliation.
8. Confirm the timed $85 Private Reading still follows the existing Stripe
   Payment Link email flow.

No real Square credentials are required by the local test suite.

## Production promotion and rollback

Before production, independently verify the pinned Square API version, current
webhook signature instructions, event payloads, Web Payments SDK tokenization
arguments, CSP hosts, production application/location/merchant identity, and
notification URL. Use Production credentials only in the deployment secret
store and create a separate Production webhook subscription.

The migration must be reviewed before its first application because version
`20260818001000` is intentionally rewritten in place while still unapplied.
Before accepting live traffic, deploy database and functions, configure secrets
and CSP, then build the frontend. Rollback should first prevent new direct
payment submissions while preserving all `processing`, `unknown`, and
`completed` attempts for reconciliation. Never roll back by deleting payment
records or re-enabling payment for an ambiguous booking. Timed Stripe Payment
Links remain independent throughout.
