const bookingIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const paymentAccessTokenPattern = /^[0-9a-f]{64}$/i;

export function paymentStorageKey(serviceSlug) {
  return `amanda:direct-payment:${serviceSlug}`;
}

export function readPaymentIdentity(storage, serviceSlug, serviceId) {
  try {
    const key = paymentStorageKey(serviceSlug);
    const stored = storage.getItem(key);
    if (!stored) return null;

    const identity = JSON.parse(stored);
    if (
      identity.serviceId !== serviceId ||
      !bookingIdPattern.test(identity.bookingId || "") ||
      !paymentAccessTokenPattern.test(identity.paymentAccessToken || "")
    ) {
      storage.removeItem(key);
      return null;
    }

    return identity;
  } catch {
    storage.removeItem(paymentStorageKey(serviceSlug));
    return null;
  }
}

export function storePaymentIdentity(storage, serviceSlug, identity) {
  storage.setItem(paymentStorageKey(serviceSlug), JSON.stringify(identity));
}

export function clearPaymentIdentity(storage, serviceSlug) {
  storage.removeItem(paymentStorageKey(serviceSlug));
}
