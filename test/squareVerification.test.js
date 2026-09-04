import assert from "node:assert/strict";
import test from "node:test";

import { buildSquareVerificationDetails } from "../src/services/squareVerification.js";

test("builds current Square CHARGE verification details from genuine buyer fields", () => {
  assert.deepEqual(
    buildSquareVerificationDetails({
      amountMinor: 2000,
      currency: "USD",
      buyerContact: {
        givenName: "  Amanda Example  ",
        email: "  amanda@example.com  ",
        phone: "  +15555550100  ",
      },
    }),
    {
      amount: "20.00",
      currencyCode: "USD",
      intent: "CHARGE",
      billingContact: {
        givenName: "Amanda Example",
        email: "amanda@example.com",
        phone: "+15555550100",
      },
      customerInitiated: true,
      sellerKeyedIn: false,
    },
  );
});

test("keeps billingContact object-shaped and omits an unavailable optional phone", () => {
  const details = buildSquareVerificationDetails({
    amountMinor: 2000,
    currency: "USD",
    buyerContact: {
      givenName: "Single Name",
      email: "buyer@example.com",
    },
  });

  assert.deepEqual(details.billingContact, {
    givenName: "Single Name",
    email: "buyer@example.com",
  });
});
