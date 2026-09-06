// This storage contains only narrowly scoped abandonment capabilities, never
// the payment recovery token or any customer/payment details.
const prefix = "amanda:timed-cleanup:";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secret = /^[0-9a-f]{64}$/i;

export function readCleanupMarkers(storage) {
  if (!storage) return [];
  const markers = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const marker = JSON.parse(storage.getItem(key));
    if (!uuid.test(marker?.bookingId || "") || !uuid.test(marker?.attemptId || "") ||
      !secret.test(marker?.cleanupCapability || "") || !Number.isFinite(Date.parse(marker?.expiresAt)) ||
      key !== prefix + marker.bookingId) throw new Error("Previous checkout cleanup is unavailable.");
    markers.push(marker);
  }
  return markers;
}

export function storeCleanupMarker(storage, marker) {
  // Explicit allowlist: never spread a service response/recovery identity here.
  storage?.setItem(prefix + marker.bookingId, JSON.stringify({
    bookingId: marker.bookingId, attemptId: marker.attemptId,
    cleanupCapability: marker.cleanupCapability, expiresAt: marker.expiresAt,
  }));
}

export function clearCleanupMarker(storage, bookingId, attemptId) {
  try {
    const key = prefix + bookingId;
    const marker = JSON.parse(storage?.getItem(key) || "null");
    if (marker && (!attemptId || marker.attemptId === attemptId)) storage.removeItem(key);
  } catch { /* Storage failure must not undo an authenticated completion/closure. */ }
}

export async function renewCheckoutCleanup({ storage, bookingId, paymentAccessToken, attemptId, renew, active }) {
  let existing;
  try { existing = readCleanupMarkers(storage).find((item) => item.bookingId === bookingId && item.attemptId === attemptId); } catch { /* Recovery authority can replace its own marker. */ }
  const lease = await renew(bookingId, paymentAccessToken, attemptId, existing?.cleanupCapability || null);
  if (!active()) return null;
  if (!secret.test(lease?.cleanupCapability || "") || !Number.isFinite(Date.parse(lease?.expiresAt)) ||
    !Number.isFinite(lease?.renewAfterSeconds) || lease.renewAfterSeconds < 1) {
    throw new Error("Checkout lease is unavailable.");
  }
  try { storeCleanupMarker(storage, { bookingId, attemptId, ...lease }); } catch { /* Storage unavailable: existing one-hour fallback remains. */ }
  return lease;
}

export async function resolveOutstandingTimedCleanups({ storage, cleanup, active = () => true }) {
  try {
    for (const marker of readCleanupMarkers(storage)) {
      if (!active()) return false;
      const result = await cleanup(marker);
      if (!active() || result?.abandoned !== true) return false;
      // A different tab may have replaced this marker while the request ran.
      const current = readCleanupMarkers(storage).find((item) => item.bookingId === marker.bookingId);
      if (current && (current.attemptId !== marker.attemptId || current.cleanupCapability !== marker.cleanupCapability)) return false;
      clearCleanupMarker(storage, marker.bookingId, marker.attemptId);
    }
    return active();
  } catch {
    return false;
  }
}

export function getCleanupStorage() {
  try { return window.localStorage; } catch { return undefined; }
}

export function isCleanupStorageEvent(event) {
  return event.key === null || event.key?.startsWith(prefix);
}
