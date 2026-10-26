# Apple Pay checkout

## Completed code changes

`src/components/booking/SquareCardPayment.jsx` now initializes Square Apple Pay beside the existing Card method, after the protected booking attempt is ready. It builds the Square `PaymentRequest` from the server-returned attempt amount and currency, uses `US` as the country code, and sends the resulting one-time Square token through the existing `submitSquarePayment` path. No booking, pricing, discount, database, Edge Function, webhook, or secret handling was changed.

Apple Pay is optional: failure to initialize it, including unsupported browsers, devices, or account/domain setup, leaves the Card form available. The Apple Pay click handler invokes `applePay.tokenize()` before any asynchronous status or API work, as required by Square.

## Domain association file

The repository contains the genuine Square-provided association file at:

```text
public/.well-known/apple-developer-merchantid-domain-association
```

Vite copies `public` files unchanged to the Cloudflare Pages output. Before registering a domain, deploy through the normal release process and confirm that `https://<domain>/.well-known/apple-developer-merchantid-domain-association` returns the raw file without authentication, redirects, HTML, or SPA fallback. No `_redirects`, `_headers`, or Pages routing configuration exists in this repository; any Cloudflare Pages SPA fallback must exclude this path.

## Manual Square and production steps

1. In Square Developer Console, select the application whose ID is supplied to the Web Payments SDK.
2. Register the HTTPS Sandbox domain under Apple Pay and test on Safari with a Wallet card. Apple Pay cannot be tested from HTTP or localhost; Square Sandbox uses a real Wallet card but does not charge it.
3. Register the Production domain after confirming the association file is live. Register `www` as well if checkout is served there.
4. Confirm the browser application/location IDs and server location ID belong to the same Square merchant/location.
5. Perform a controlled production payment and confirm Square webhook reconciliation creates exactly one paid booking.

Apple Pay is supported on compatible Safari/Apple hardware only. Other browsers/devices continue to see Card entry. See Square's [Apple Pay guide](https://developer.squareup.com/docs/web-payments/apple-pay) and [Apple Pay SDK reference](https://developer.squareup.com/reference/sdks/web/payments/digital-wallets/apple-pay).
