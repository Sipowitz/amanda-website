# Timed checkout cleanup lease

`paymentAccessToken` remains in sessionStorage only. The separate localStorage
namespace `amanda:timed-cleanup:<booking UUID>` stores exactly `bookingId`,
`attemptId`, `cleanupCapability`, and `expiresAt`. The capability is a restricted
credential, not public metadata. Never log it or put it in a URL. It authorizes
only the `cleanup` action; it cannot recover status, read customer data, create
an attempt, renew a lease, or submit a payment.

The new migration defaults `private.timed_checkout_cleanup_policy.grace_seconds`
to 180 seconds. It is database-configurable from 120 to 300 seconds. No browser
clock or browser-supplied duration controls the lease. The recovery-authenticated
`lease` action returns a renewal interval of one third of the configured grace.
The mounted timed card renews on that interval and window focus. Lease deadlines
and capability mutation authority never extend beyond attempt creation + one
hour. Voice Memo does not issue, store, renew or consume cleanup capabilities.

Every operation locks the booking before the attempt. Retry insertion invalidates
old capabilities under that booking lock. Cleanup checks the exact attempt,
lease, payment evidence and competing history before locking/releasing the slot.
Existing submission, completion, expiry and authenticated abandonment retain their
own authorization and locks. There are no unload-dependent requests.

An identity-free timed entry checks all outstanding timed markers before loading
availability. It polls every 15 seconds or on "Check previous checkout". Only a
server acknowledgement permits fresh selection. Refusal and transport errors
remain blocked. An acknowledged cleanup can be retried without further mutation,
even after the capability deadline; similarly, completed one-hour expiry or safe
manual cancellation can be acknowledged without touching any booking or slot.
An expired, unused capability cannot mutate a still-reserved checkout.

The inactive-tab policy is a bounded lease, not proof of tab closure: an offline
or suspended checkout may lose its never-submitted reservation when another tab
requests cleanup after the grace period. A resumed tab must revalidate and cannot
submit after cleanup wins. Processing, unknown, submitted and paid attempts never
qualify, and a new tab cannot recover their details with this capability; it must
use the original session or seek assistance. Malformed/stale markers also fail
closed. Missing/unavailable persistent storage falls back to the one-hour sweep.

This migration does not backfill raw capabilities for existing closed tabs, and
is not applied by the repository changes. Existing live checkouts obtain a
capability on their next authenticated initialization. No existing credentials
are copied into persistent storage.
