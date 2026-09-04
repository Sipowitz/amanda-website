import { useState } from "react";

import BookingTimeline from "./BookingTimeline";
import BookingPaymentEditor from "./BookingPaymentEditor";

import {
  formatBookingDate,
  formatCurrency,
  getPaymentLabel,
  getPaymentMethodLabel,
  getPaymentStyles,
  getStatusLabel,
  getStatusStyles,
} from "./bookingDisplay";

function Badge({ children, className }) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] ${className}`}
    >
      {children}
    </span>
  );
}

export default function BookingCard({
  booking,
  isUpdating,
  isSavingPayment,
  paymentPanelOpen,
  paymentForm,
  onTogglePayment,
  onPaymentChange,
  onPaymentSubmit,
  onStatusChange,
  onCancel,
}) {
  const [expanded, setExpanded] = useState(false);

  const slot = booking.availability_slots;
  const isCancelled = booking.status === "cancelled";
  const isDirectPayment =
    booking.service_payment_flow_snapshot === "direct_payment";
  const isSquarePayment = isDirectPayment && booking.payment_provider === "square";
  const isTimed = booking.service_booking_mode_snapshot === "timed";
  const attemptStatus = booking.payment_attempt_status;
  const canCancel = !isDirectPayment || (isSquarePayment &&
    booking.status === "pending_payment" && attemptStatus === "reserved"
  );
  const canCompleteDirectPayment = isSquarePayment &&
    booking.status === "confirmed" &&
    booking.payment_status === "paid" &&
    booking.payment_method === "square" &&
    attemptStatus === "completed";
  const directPaymentState = isDirectPayment
    ? getDirectPaymentState(booking, attemptStatus, isTimed, isSquarePayment)
    : null;
  const outstanding = Math.max(
    Number(booking.amount_due || 0) - Number(booking.amount_paid || 0),
    0,
  );

  const accentClass =
    booking.status === "confirmed"
      ? "before:bg-[#66a16f]"
      : booking.status === "cancelled"
        ? "before:bg-[#c76e6e]"
        : "before:bg-[#efbd62]";

  return (
    <article
      className={`relative overflow-hidden rounded-[1.1rem] border border-[#dfdbd2] bg-white/90 shadow-[0_8px_28px_rgba(45,55,45,0.07)] before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${accentClass} ${
        isCancelled ? "opacity-70" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="grid w-full gap-4 px-5 py-5 text-left transition hover:bg-[#faf8f2] md:grid-cols-[190px_minmax(0,1.3fr)_170px_150px_130px] md:items-center md:px-6"
      >
        <div className="border-[#e4e0d7] md:border-r md:pr-5">
          <p className="text-sm font-medium text-[#525d54]">
            {booking.service_name_snapshot}
          </p>

          {slot ? (
            <>
              <p className="mt-2 text-sm text-[#525d54]">
                {formatBookingDate(slot.slot_date)}
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-[#1f2922]">
                {slot.slot_time}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm font-semibold text-[#1f2922]">
              Untimed request
            </p>
          )}
        </div>

        <div className="min-w-0 md:px-1">
          <p className="truncate text-lg font-semibold text-[#1f2922]">
            {booking.customer_name}
          </p>

          <p className="mt-1 truncate text-sm text-[#4f5b53]">
            {booking.customer_email}
          </p>

          {booking.customer_phone && (
            <p className="mt-1 truncate text-sm text-[#4f5b53]">
              {booking.customer_phone}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 md:flex-col md:items-start">
          <Badge className={getStatusStyles(booking.status)}>
            {getStatusLabel(booking.status)}
          </Badge>

          <Badge className={getPaymentStyles(booking.payment_status)}>
            {getPaymentLabel(booking.payment_status)}
          </Badge>
        </div>

        <div className="border-[#e4e0d7] md:border-l md:pl-5">
          <p className="text-lg font-semibold text-[#1f2922]">
            {formatCurrency(booking.amount_due)}
          </p>

          <p
            className={`mt-1 text-sm ${
              outstanding > 0 ? "text-[#c6472d]" : "text-[#3e8448]"
            }`}
          >
            {outstanding > 0
              ? `Due: ${formatCurrency(outstanding)}`
              : `Paid: ${formatCurrency(booking.amount_paid)}`}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 md:justify-end">
          <span className="rounded-xl border border-[#d8d4ca] bg-[#fbfaf6] px-4 py-2.5 text-sm font-medium text-[#39443c]">
            {expanded ? "Hide details" : "View details"}
          </span>

          <span
            className={`text-[#5f685f] transition ${expanded ? "rotate-180" : ""}`}
          >
           ⌄
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#e3dfd6] bg-[#fbfaf6] px-5 py-6 md:px-6">
          <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-7">
              <div className="grid gap-6 md:grid-cols-2">
                <section>
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7d847c]">
                    Customer
                  </p>

                  <div className="space-y-2 text-sm text-[#445047]">
                    <a
                      href={`mailto:${booking.customer_email}`}
                      className="block transition hover:text-[#1f2922]"
                    >
                      {booking.customer_email}
                    </a>

                    {booking.customer_phone && (
                      <a
                        href={`tel:${booking.customer_phone}`}
                        className="block transition hover:text-[#1f2922]"
                      >
                        {booking.customer_phone}
                      </a>
                    )}
                  </div>
                </section>

                <section>
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7d847c]">
                    Payment
                  </p>

                  <div className="space-y-1.5 text-sm text-[#445047]">
                    <p>Due: {formatCurrency(booking.amount_due)}</p>
                    <p>Paid: {formatCurrency(booking.amount_paid)}</p>
                    <p>
                      Method: {getPaymentMethodLabel(booking.payment_method)}
                    </p>
                    {booking.payment_reference && (
                      <p>Reference: {booking.payment_reference}</p>
                    )}
                  </div>
                </section>
              </div>

              {booking.customer_message && (
                <section className="rounded-xl border border-[#dedad0] bg-white p-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d847c]">
                    Message
                  </p>

                  <p className="text-sm leading-7 text-[#475249]">
                    {booking.customer_message}
                  </p>
                </section>
              )}

              <section>
                <div className="mb-3 flex items-center justify-between gap-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7d847c]">
                    Actions
                  </p>

                  {isDirectPayment ? (
                    <span className="text-right text-sm text-[#6d746b]">
                      <span className="block font-medium text-[#465148]">
                        {directPaymentState.label}
                      </span>
                      {directPaymentState.detail && (
                        <span className="mt-1 block text-xs">
                          {directPaymentState.detail}
                        </span>
                      )}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onTogglePayment(booking)}
                      className="text-sm font-medium text-[#365d3c] transition hover:text-[#243d28]"
                    >
                      {paymentPanelOpen ? "Close payment" : "Manage payment"}
                    </button>
                  )}
                </div>

                {!isCancelled ? (
                  <div className="flex flex-wrap gap-2.5">
                    {!isDirectPayment && booking.status !== "pending" && (
                      <button
                        disabled={isUpdating}
                        onClick={() => onStatusChange(booking, "pending")}
                        className="rounded-xl border border-[#d8d4ca] bg-white px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#576159] disabled:opacity-40"
                      >
                        Pending
                      </button>
                    )}

                    {!isDirectPayment && booking.status !== "confirmed" && (
                      <button
                        disabled={isUpdating}
                        onClick={() => onStatusChange(booking, "confirmed")}
                        className="rounded-xl border border-[#cfe2cf] bg-[#e7f2e7] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2f6b38] disabled:opacity-40"
                      >
                        Confirm
                      </button>
                    )}

                    {booking.status === "confirmed" &&
                      (!isDirectPayment || canCompleteDirectPayment) && (
                      <button
                        disabled={isUpdating}
                        onClick={() => onStatusChange(booking, "completed")}
                        className="rounded-xl border border-[#cbdde9] bg-[#e9f1f6] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#315f7c] disabled:opacity-40"
                      >
                        Complete
                      </button>
                    )}

                    {booking.status === "confirmed" &&
                      (!isDirectPayment || canCompleteDirectPayment) && (
                      <button
                        disabled={isUpdating}
                        onClick={() => onStatusChange(booking, "no_show")}
                        className="rounded-xl border border-[#d8d7d1] bg-[#efeee9] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#68685f] disabled:opacity-40"
                      >
                        No Show
                      </button>
                    )}

                    {canCancel && (
                      <button
                        disabled={isUpdating}
                        onClick={() => onCancel(booking)}
                        className="rounded-xl border border-[#efcccc] bg-[#f8e7e7] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a3a3a] disabled:opacity-40"
                      >
                        {isUpdating ? "Updating..." : "Cancel"}
                      </button>
                    )}

                    {isDirectPayment && ["processing", "unknown"].includes(attemptStatus) && (
                      <p className="w-full text-sm text-[#6d746b]">
                        The Square payment outcome must resolve before administrative
                        changes or cancellation are allowed.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[#777d76]">
                    This booking has been cancelled.
                  </p>
                )}
              </section>

              {paymentPanelOpen && !isDirectPayment && (
                <BookingPaymentEditor
                  booking={booking}
                  form={paymentForm}
                  onChange={(event) => onPaymentChange(booking.id, event)}
                  onSubmit={(event) => onPaymentSubmit(event, booking)}
                  onClose={() => onTogglePayment(booking)}
                  saving={isSavingPayment}
                />
              )}
            </div>

            <BookingTimeline booking={booking} />
          </div>
        </div>
      )}
    </article>
  );
}

function getDirectPaymentState(booking, attemptStatus, isTimed, isSquarePayment) {
  if (booking.status === "payment_expired") {
    return {
      label: "Payment expired",
      detail: isTimed ? "Appointment no longer reserved" : "Payment was not completed",
    };
  }
  if (isSquarePayment && attemptStatus === "reserved" && booking.status === "pending_payment") {
    return { label: "Awaiting Square checkout", detail: isTimed ? "Appointment slot held" : "" };
  }
  if (isSquarePayment && attemptStatus === "processing") {
    return { label: "Square payment processing", detail: "Payment outcome must resolve" };
  }
  if (isSquarePayment && attemptStatus === "unknown") {
    return { label: "Square payment status unknown", detail: "Payment outcome must resolve" };
  }
  if (isSquarePayment && attemptStatus === "completed" && booking.payment_status === "paid") {
    return { label: "Paid via Square", detail: "Provider-confirmed payment" };
  }
  return { label: "Square-managed direct payment", detail: "Administrative payment editing locked" };
}
