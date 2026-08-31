import { useCallback, useEffect, useMemo, useState } from "react";

import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

import {
  createCheckoutSession,
  getCheckoutPaymentStatus,
} from "../../services/bookingService";

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePublishableKey
  ? loadStripe(stripePublishableKey)
  : null;

function formatPrice(amount, currency) {
  return (amount / 100).toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function EmbeddedPayment({
  bookingId,
  paymentAccessToken,
  service,
  onPaymentVerified,
}) {
  const [paymentContext, setPaymentContext] = useState(() => ({
    serviceName: service.name,
    priceAmount: service.price_amount,
    currency: service.currency,
  }));
  const [clientSecret, setClientSecret] = useState("");
  const [paymentState, setPaymentState] = useState(
    stripePublishableKey ? "loading" : "configuration_missing",
  );
  const [error, setError] = useState("");
  const [initializationAttempt, setInitializationAttempt] = useState(0);

  const markVerified = useCallback((status) => {
    setPaymentState("success");
    setClientSecret("");
    onPaymentVerified?.(status);
  }, [onPaymentVerified]);

  const checkAuthoritativeStatus = useCallback(async () => {
    const status = await getCheckoutPaymentStatus(
      bookingId,
      paymentAccessToken,
    );

    if (status.paid) {
      markVerified(status);
    } else if (status.can_restart || status.checkout_status === "expired") {
      setClientSecret("");
      setPaymentState("expired");
    }

    return status;
  }, [bookingId, markVerified, paymentAccessToken]);

  useEffect(() => {
    if (!stripePublishableKey) return undefined;

    let active = true;

    async function initialiseCheckout() {
      try {
        setError("");
        setClientSecret("");
        setPaymentState("loading");

        const session = await createCheckoutSession(
          bookingId,
          paymentAccessToken,
        );

        if (!active) return;
        if (session.paid) {
          markVerified(session);
          return;
        }

        setClientSecret(session.clientSecret);
        setPaymentState("ready");
        setPaymentContext({
          serviceName: session.serviceName,
          priceAmount: session.amountTotal,
          currency: session.currency.toUpperCase(),
        });
      } catch (checkoutError) {
        if (active) {
          setError(checkoutError.message || "Unable to initialise secure payment.");
          setPaymentState("error");
        }
      }
    }

    initialiseCheckout();
    return () => {
      active = false;
    };
  }, [
    bookingId,
    initializationAttempt,
    markVerified,
    paymentAccessToken,
  ]);

  useEffect(() => {
    if (paymentState !== "ready") return undefined;

    const intervalId = window.setInterval(() => {
      checkAuthoritativeStatus().catch((statusError) => {
        console.error("Background payment status check failed", statusError);
      });
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [checkAuthoritativeStatus, paymentState]);

  const verifyAfterCompletion = useCallback(async () => {
    setClientSecret("");
    setPaymentState("verifying");
    setError("");

    try {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const status = await checkAuthoritativeStatus();
        if (status.paid || status.can_restart) return;
        await wait(2500);
      }

      setPaymentState("verification_delayed");
    } catch (statusError) {
      setError(statusError.message || "Payment verification is temporarily unavailable.");
      setPaymentState("verification_delayed");
    }
  }, [checkAuthoritativeStatus]);

  const checkoutOptions = useMemo(() => clientSecret
    ? {
      clientSecret,
      onComplete() {
        // Presentation signal only. The signed webhook and database remain the
        // sole authority; this starts polling that authoritative state.
        verifyAfterCompletion();
      },
    }
    : null, [clientSecret, verifyAfterCompletion]);

  function retryInitialization() {
    setInitializationAttempt((value) => value + 1);
  }

  async function retryVerification() {
    try {
      setPaymentState("verifying");
      setError("");
      const status = await checkAuthoritativeStatus();
      if (!status.paid && !status.can_restart) {
        setPaymentState("verification_delayed");
      }
    } catch (statusError) {
      setError(statusError.message || "Payment verification is temporarily unavailable.");
      setPaymentState("verification_delayed");
    }
  }

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm sm:p-8">
      <p className="text-sm uppercase tracking-[0.2em] text-[#f1e8ca]/55">
        Payment
      </p>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-3xl text-[#f1e8ca]">{paymentContext.serviceName}</h2>
        <p className="text-2xl text-[#f1e8ca]">
          {formatPrice(paymentContext.priceAmount, paymentContext.currency)}
        </p>
      </div>

      <p className="mt-3 text-[#f1e8ca]/70">Secure card payment</p>

      <div className="mt-6 min-h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[#f8f7f2] p-3 sm:p-5">
        {paymentState === "configuration_missing" && (
          <PaymentMessage title="Stripe configuration required">
            Secure payment is not configured in this environment. Your request
            remains saved for payment recovery.
          </PaymentMessage>
        )}

        {paymentState === "loading" && (
          <PaymentMessage>Loading secure payment...</PaymentMessage>
        )}

        {paymentState === "error" && (
          <PaymentMessage title="Payment is temporarily unavailable">
            <p>{error}</p>
            <ActionButton onClick={retryInitialization}>Try again</ActionButton>
          </PaymentMessage>
        )}

        {paymentState === "verifying" && (
          <PaymentMessage title="Verifying your payment">
            Stripe has submitted the payment. This page is waiting for the
            secure server confirmation and will update automatically.
          </PaymentMessage>
        )}

        {paymentState === "verification_delayed" && (
          <PaymentMessage title="Confirmation is taking longer than expected">
            <p>
              Do not pay again. Your payment may still be processing. You can
              safely check the existing booking again.
            </p>
            {error && <p className="mt-2">{error}</p>}
            <ActionButton onClick={retryVerification}>Check payment</ActionButton>
          </PaymentMessage>
        )}

        {paymentState === "expired" && (
          <PaymentMessage title="Payment session expired">
            <p>
              No payment was recorded. Restarting uses this same booking and
              cannot reactivate the expired Checkout Session.
            </p>
            <ActionButton onClick={retryInitialization}>Restart payment</ActionButton>
          </PaymentMessage>
        )}

        {paymentState === "success" && (
          <PaymentMessage title="Payment confirmed">
            Your Voice Memo Reading is confirmed and a confirmation email has
            been queued. Thank you.
          </PaymentMessage>
        )}

        {paymentState === "ready" && checkoutOptions && stripePromise && (
          <EmbeddedCheckoutProvider stripe={stripePromise} options={checkoutOptions}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        )}
      </div>
    </section>
  );
}

function PaymentMessage({ title, children }) {
  return (
    <div className="flex min-h-[380px] items-center justify-center px-6 text-center">
      <div className="max-w-lg text-sm leading-relaxed text-[#385845]/75">
        {title && <h3 className="mb-3 text-2xl text-[#385845]">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

function ActionButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-5 rounded-full bg-[#385845] px-6 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-white"
    >
      {children}
    </button>
  );
}
