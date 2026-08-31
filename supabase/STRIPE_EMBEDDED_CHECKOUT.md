# Embedded Checkout phase one

This phase is intentionally limited to services explicitly configured with
`payment_flow = 'embedded_checkout'`. The migration opts in only
`voice-memo-reading`. Timed services continue to use the existing Payment Link
workflow.

## Lifecycle

- `pending_payment`: the booking may have one `creating` or `open` Checkout
  attempt.
- `confirmed` / `paid`: a signed `checkout.session.completed` webhook verified
  the registered Session, amount and currency.
- `payment_expired`: Stripe expired the Session, or the optional stale-attempt
  sweep marked an abandoned attempt expired. The same booking and recovery
  token can reserve a new attempt.
- `cancelled`: an administrator may cancel an expired unpaid request. Active or
  settled Stripe bookings cannot be cancelled by the ordinary booking RPC.

The browser receives a random recovery token once. Only its SHA-256 digest is
stored. The browser keeps the token in `sessionStorage`, never customer details
or a service-role credential.

## Required eventual configuration

Do not perform these steps until the migration and functions are ready for the
target environment.

- Deploy `create-checkout-session` with JWT verification enabled.
- Deploy `stripe-webhook` with JWT verification disabled.
- Set `STRIPE_SECRET_KEY` for both functions.
- Set `STRIPE_WEBHOOK_SECRET` for the webhook.
- Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for both functions.
- Set `PUBLIC_SITE_URL` for checkout CORS.
- Build the site with `VITE_STRIPE_PUBLISHABLE_KEY`.
- Subscribe the Stripe webhook endpoint to:
  - `checkout.session.completed`
  - `checkout.session.expired`

Checkout is deliberately card-only in phase one, so asynchronous payment
success/failure events are not part of this lifecycle.

## Optional stale-attempt sweep

The migration creates `public.expire_stale_stripe_checkouts()` but deliberately
does not create a cron job. It is a service-role-only safety net for a rare
interruption before Session registration.

A future deployment should schedule it after reviewing the target project's
existing cron conventions. It marks only unregistered `creating` attempts older
than one hour. Registered/open Session expiry is handled exclusively by the
signed `checkout.session.expired` webhook and is never inferred from database
time.

It retains the booking, customer record, attempt history and webhook history.
It does not delete payment records.
