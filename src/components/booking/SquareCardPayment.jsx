import { useCallback, useEffect, useRef, useState } from "react";

import {
  getDirectPaymentStatus,
  initializeDirectPayment,
  submitSquarePayment,
} from "../../services/bookingService";
import { buildSquareVerificationDetails } from "../../services/squareVerification";

const applicationId = import.meta.env.VITE_SQUARE_APPLICATION_ID;
const locationId = import.meta.env.VITE_SQUARE_LOCATION_ID;
const environment = import.meta.env.VITE_SQUARE_ENVIRONMENT;
const sdkUrl = environment === "production"
  ? "https://web.squarecdn.com/v1/square.js"
  : environment === "sandbox"
    ? "https://sandbox.web.squarecdn.com/v1/square.js"
    : "";

const squareCardStyle = {
  ".input-container": {
    borderColor: "#d8d5ca",
    borderRadius: "10px",
    borderWidth: "1px",
  },
  ".input-container.is-focus": {
    borderColor: "#55735a",
    borderWidth: "1px",
  },
  ".input-container.is-error": {
    borderColor: "#a94d45",
    borderWidth: "1px",
  },
  input: {
    backgroundColor: "#faf8f1",
    color: "#29312b",
    fontFamily: "helvetica neue, sans-serif",
    fontSize: "16px",
    fontWeight: "400",
  },
  "input::placeholder": {
    color: "#7a817a",
  },
  ".message-text": {
    color: "#687168",
  },
  ".message-icon": {
    color: "#687168",
  },
  ".message-text.is-error": {
    color: "#8f3f39",
  },
  ".message-icon.is-error": {
    color: "#8f3f39",
  },
};

let sdkPromise;
function loadSquareSdk() {
  if (window.Square) return Promise.resolve(window.Square);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${sdkUrl}"]`);
      const script = existing || document.createElement("script");
      script.addEventListener("load", () => resolve(window.Square), { once: true });
      script.addEventListener("error", () => reject(new Error("Secure card form failed to load.")), { once: true });
      if (!existing) {
        script.src = sdkUrl;
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }
  return sdkPromise;
}

function formatPrice(amount, currency) {
  return (amount / 100).toLocaleString("en-US", {
    style: "currency",
    currency,
  });
}

export default function SquareCardPayment({ bookingId, paymentAccessToken, service, onBookingRecovered, onPaymentVerified, onChooseNewAppointment }) {
  const cardRef = useRef(null);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  const [context, setContext] = useState({
    amountMinor: service.price_amount,
    currency: service.currency,
    serviceName: service.name,
    buyerContact: null,
  });
  const [attemptId, setAttemptId] = useState(null);
  const [state, setState] = useState(
    applicationId && locationId && sdkUrl ? "loading" : "configuration_missing",
  );
  const [error, setError] = useState("");

  const handleStatus = useCallback((status) => {
    if (status.serviceName) {
      setContext((current) => ({
        ...current,
        serviceName: status.serviceName,
      }));
    }
    if (status.paid && status.bookingStatus === "confirmed" && status.paymentStatus === "paid") {
      setState("success");
      onPaymentVerified?.(status);
      return "success";
    }
    if (["processing", "unknown"].includes(status.attemptStatus)) {
      setState("verifying");
      return "verifying";
    }
    if (status.canRestart || ["failed", "expired", "cancelled"].includes(status.attemptStatus)) {
      setState("restart");
      return "restart";
    }
    return "ready";
  }, [onPaymentVerified]);

  const checkStatus = useCallback(async () => {
    const status = await getDirectPaymentStatus(bookingId, paymentAccessToken);
    handleStatus(status);
    return status;
  }, [bookingId, handleStatus, paymentAccessToken]);

  const initialize = useCallback(async (restart = false) => {
    setError("");
    setState("loading");
    const current = await getDirectPaymentStatus(bookingId, paymentAccessToken);
    if (current.bookingDetails) {
      onBookingRecovered?.({
        ...current.bookingDetails,
        amountMinor: current.amountMinor,
        currency: current.currency,
      });
    }
    const currentState = handleStatus(current);
    if (currentState !== "ready" && !(restart && currentState === "restart")) return;
    if (!current.buyerContact?.givenName || !current.buyerContact?.email) {
      throw new Error("Buyer contact details are unavailable for secure payment.");
    }
    const attempt = await initializeDirectPayment(bookingId, paymentAccessToken);
    if (attempt.paid) {
      handleStatus(attempt);
      return;
    }
    if (["processing", "unknown"].includes(attempt.attemptStatus)) {
      setState("verifying");
      return;
    }
    setAttemptId(attempt.attemptId);
    setContext({
      amountMinor: attempt.amountMinor,
      currency: attempt.currency,
      serviceName: attempt.serviceName,
      buyerContact: current.buyerContact,
    });
    const Square = await loadSquareSdk();
    if (!Square || !mountedRef.current) throw new Error("Secure card form is unavailable.");
    const payments = Square.payments(applicationId, locationId);
    const card = await payments.card({ style: squareCardStyle });
    if (!mountedRef.current) {
      await card.destroy();
      return;
    }
    cardRef.current = card;
    await card.attach("#square-card-container");
    setState("ready");
  }, [bookingId, handleStatus, onBookingRecovered, paymentAccessToken]);

  useEffect(() => {
    mountedRef.current = true;
    let initializeTimer;
    if (applicationId && locationId && sdkUrl) {
      initializeTimer = window.setTimeout(() => {
        initialize().catch((reason) => {
          if (mountedRef.current) {
            setError(reason.message || "Unable to initialize secure payment.");
            setState("error");
          }
        });
      }, 0);
    }
    return () => {
      window.clearTimeout(initializeTimer);
      mountedRef.current = false;
      const card = cardRef.current;
      cardRef.current = null;
      card?.destroy().catch(() => {});
    };
  }, [initialize]);

  useEffect(() => {
    if (state !== "verifying") return undefined;
    const timer = window.setInterval(() => checkStatus().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, [checkStatus, state]);

  async function submit(event) {
    event.preventDefault();
    if (submittingRef.current || !cardRef.current || !attemptId) return;
    submittingRef.current = true;
    setError("");
    setState("tokenizing");
    try {
      const tokenized = await cardRef.current.tokenize(
        buildSquareVerificationDetails(context),
      );
      if (tokenized.status !== "OK" || !tokenized.token) {
        throw new Error(tokenized.errors?.[0]?.message || "Card details could not be tokenized.");
      }
      setState("verifying");
      const result = await submitSquarePayment({
        bookingId,
        paymentAccessToken,
        attemptId,
        sourceToken: tokenized.token,
      });
      // The single-use token stays in this call only. It is never stored/logged.
      if (result.declined) {
        setError(result.error || "Payment was declined.");
        setState("restart");
        return;
      }
      await checkStatus();
    } catch (reason) {
      setError(reason.message || "Payment could not be submitted.");
      try {
        const status = await checkStatus();
        if (status.attemptStatus === "reserved") setState("ready");
      } catch {
        setState("verifying");
      }
    } finally {
      submittingRef.current = false;
    }
  }

  const displayAmount = formatPrice(context.amountMinor, context.currency);

  return (
    <section className="mx-auto w-full max-w-lg rounded-[1.25rem] border border-[#ded8ca] bg-[#f3efe5] p-4 text-[#29312b] shadow-[0_16px_42px_rgba(37,49,39,0.16)] sm:p-5">
      <div className="flex items-end justify-between gap-4 border-b border-[#d8d2c5] pb-4">
        <div>
          <h2 className="text-2xl font-normal text-[#304435] [text-shadow:none] sm:text-[1.7rem]">Secure checkout</h2>
          <p className="mt-1 text-sm text-[#667068] [text-shadow:none]">{service.name}</p>
        </div>
        <p className="shrink-0 text-2xl font-semibold tabular-nums text-[#304435] [text-shadow:none]">{displayAmount}</p>
      </div>

      <div className="pt-4">
        {state === "configuration_missing" && <Message title="Square configuration required">Secure payment is not configured in this environment. Your request remains saved for recovery.</Message>}
        {state === "loading" && <Message>Loading secure payment...</Message>}
        {state === "error" && <Message title="Payment is temporarily unavailable"><p>{error}</p><Button onClick={() => initialize(false)}>Try again</Button></Message>}
        {state === "verifying" && <Message title="Verifying your payment"><p>Do not pay again. The secure server is confirming the existing payment attempt.</p>{error && <p>{error}</p>}<Button onClick={() => checkStatus()}>Check payment</Button></Message>}
        {state === "restart" && <Message title="Payment was not completed"><p>{onChooseNewAppointment ? "Your appointment reservation is no longer held." : error || "No charge was recorded for the previous attempt."}</p><div className="flex flex-wrap items-center justify-center gap-3"><Button onClick={() => initialize(true)}>Try payment again</Button>{onChooseNewAppointment && <Button onClick={onChooseNewAppointment}>Choose a new appointment</Button>}</div></Message>}
        {state === "success" && <Message title="Payment confirmed">Your {context.serviceName || "booking"} is confirmed and a confirmation email has been sent. Thank you.</Message>}
        <form onSubmit={submit} className={state === "ready" || state === "tokenizing" ? "block" : "hidden"}>
          <p className="mb-2 text-sm font-medium text-[#3e4b40] [text-shadow:none]">Card details</p>
          <div id="square-card-container" className="min-h-24" />
          {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
          <button disabled={state !== "ready"} className="min-h-12 w-full rounded-xl bg-[#365d3c] px-5 py-3.5 text-base font-semibold text-white shadow-[0_8px_18px_rgba(54,93,60,0.22)] transition hover:bg-[#2f5335] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#365d3c] disabled:cursor-not-allowed disabled:opacity-55">
            {state === "tokenizing" ? "Processing securely..." : `Pay ${displayAmount} securely`}
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-[#647066] [text-shadow:none]">
            <LockIcon />
            Secure payment powered by Square
          </p>
        </form>
      </div>
    </section>
  );
}

function Message({ title, children }) {
  return <div className="flex min-h-24 flex-col items-center justify-center gap-2 px-3 py-4 text-center sm:px-4">{title && <h3 className="text-xl">{title}</h3>}<div className="text-sm leading-relaxed sm:text-base">{children}</div></div>;
}

function Button({ onClick, children }) {
  return <button type="button" onClick={onClick} className="mt-3 rounded-xl bg-[#365d3c] px-5 py-3 text-white">{children}</button>;
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
      <rect x="4.5" y="8" width="11" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8V5.75a3 3 0 0 1 6 0V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
