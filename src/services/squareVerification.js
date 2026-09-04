export function buildSquareVerificationDetails({
  amountMinor,
  currency,
  buyerContact,
}) {
  const phone = buyerContact.phone?.trim();

  return {
    amount: (amountMinor / 100).toFixed(2),
    currencyCode: currency,
    intent: "CHARGE",
    billingContact: {
      // The booking form collects a single full-name field, so do not guess at
      // given/family-name boundaries. Square permits the full name here.
      givenName: buyerContact.givenName.trim(),
      email: buyerContact.email.trim(),
      ...(phone ? { phone } : {}),
    },
    customerInitiated: true,
    sellerKeyedIn: false,
  };
}
