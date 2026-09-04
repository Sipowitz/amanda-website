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

export default function SquareCardPayment({ bookingId, paymentAccessToken, service, onBookingRecovered, onPaymentVerified }) {
  const cardRef = useRef(null);
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  const [context, setContext] = useState({
    amountMinor: service.price_amount,
    currency: service.currency,
    buyerContact: null,
  });
  const [attemptId, setAttemptId] = useState(null);
  const [state, setState] = useState(
    applicationId && locationId && sdkUrl ? "loading" : "configuration_missing",
  );
  const [error, setError] = useState("");

  const handleStatus = useCallback((status) => {
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
    if (current.bookingDetails) onBookingRecovered?.(current.bookingDetails);
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
      buyerContact: current.buyerContact,
    });
    const Square = await loadSquareSdk();
    if (!Square || !mountedRef.current) throw new Error("Secure card form is unavailable.");
    const payments = Square.payments(applicationId, locationId);
    const card = await payments.card();
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

  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-3 backdrop-blur-sm sm:p-4">
      <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#f1e8ca]/55">Secure card payment</p>
      <div className="rounded-2xl border border-white/10 bg-[#f8f7f2] p-3 text-[#29312b] sm:p-4">
        {state === "configuration_missing" && <Message title="Square configuration required">Secure payment is not configured in this environment. Your request remains saved for recovery.</Message>}
        {state === "loading" && <Message>Loading secure payment...</Message>}
        {state === "error" && <Message title="Payment is temporarily unavailable"><p>{error}</p><Button onClick={() => initialize(false)}>Try again</Button></Message>}
        {state === "verifying" && <Message title="Verifying your payment"><p>Do not pay again. The secure server is confirming the existing payment attempt.</p>{error && <p>{error}</p>}<Button onClick={() => checkStatus()}>Check payment</Button></Message>}
        {state === "restart" && <Message title="Payment was not completed"><p>{error || "No charge was recorded for the previous attempt."}</p><Button onClick={() => initialize(true)}>Try payment again</Button></Message>}
        {state === "success" && <Message title="Payment confirmed">Your Voice Memo Reading is confirmed and a confirmation email has been sent. Thank you.</Message>}
        <form onSubmit={submit} className={state === "ready" || state === "tokenizing" ? "block" : "hidden"}>
          <div id="square-card-container" className="min-h-24" />
          {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
          <button disabled={state !== "ready"} className="w-full rounded-xl bg-[#365d3c] px-5 py-3 text-white disabled:opacity-50">{state === "tokenizing" ? "Submitting..." : "Pay securely"}</button>
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
