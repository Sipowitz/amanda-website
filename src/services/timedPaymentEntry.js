// Navigation timing describes the initial document, not later SPA entries.
// Consume reload eligibility once; a later reopening of the modal is fresh.
export function createCheckoutEntryPolicy(navigationType, initialPathname) {
  let entered = false;
  return (pathname) => {
    const recover = !entered && navigationType === "reload" && pathname === initialPathname;
    entered = true;
    return recover;
  };
}

// Keep credentials until the server confirms terminal abandonment. Status is
// only a candidate check: the mutation must revalidate under database locks.
export async function resolveTimedPaymentEntry({ identity, recover, getStatus, abandon, clearIdentity }) {
  try {
    const status = await getStatus(identity.bookingId, identity.paymentAccessToken);
    if (status.serviceId !== identity.serviceId || status.bookingMode !== "timed") return identity;
    const reserved = status.bookingStatus === "pending_payment" &&
      status.paymentStatus === "unpaid" && status.paid === false &&
      status.attemptStatus === "reserved";
    const cancelled = status.bookingStatus === "cancelled" &&
      status.paymentStatus === "unpaid" && status.paid === false &&
      status.attemptStatus === "cancelled";
    if ((!recover && reserved) || cancelled) {
      await terminateTimedPaymentCheckout({ identity, attemptId: status.attemptId, abandon, clearIdentity });
      return null;
    }
  } catch {
    // Includes a submission winning the race and a lost abandonment response.
    // Checkout will read status again; never infer permission to book anew.
  }
  return identity;
}

// The attempt ID is the one displayed to the customer, not a newly fetched
// attempt. The server rejects it if another tab has already started a retry.
export async function terminateTimedPaymentCheckout({ identity, attemptId, abandon, clearIdentity }) {
  if (!identity || !attemptId) throw new Error("Recover payment status before choosing a new appointment.");
  const result = await abandon(identity.bookingId, identity.paymentAccessToken, attemptId);
  if (result?.abandoned !== true) throw new Error("Checkout could not be safely closed. Recover payment status.");
  clearIdentity();
}
