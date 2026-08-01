import { formatTimestamp } from "./bookingDisplay";

export default function BookingTimeline({ booking }) {
  const steps = [
    { label: "Requested", complete: true, timestamp: booking.created_at },
    { label: "Confirmed", complete: Boolean(booking.confirmed_at), timestamp: booking.confirmed_at },
    { label: "Paid", complete: booking.payment_status === "paid", timestamp: booking.paid_at },
    { label: "Completed", complete: booking.status === "completed", timestamp: booking.completed_at },
  ];

  if (booking.status === "cancelled") {
    steps.push({
      label: "Cancelled",
      complete: true,
      timestamp: booking.cancelled_at,
      destructive: true,
    });
  }

  return (
    <section className="rounded-xl border border-[#dfdbd2] bg-[#faf8f2] p-5">
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7c837a]">
        Timeline
      </p>

      <div className="flex flex-col">
        {steps.map((step, index) => (
          <div key={step.label} className="flex gap-3">
            <div className="flex w-4 flex-col items-center">
              <span
                className={`mt-1.5 h-2.5 w-2.5 rounded-full border ${
                  step.complete
                    ? step.destructive
                      ? "border-[#d08b8b] bg-[#c85e5e]"
                      : "border-[#557b5b] bg-[#557b5b]"
                    : "border-[#cfd0c8] bg-[#efeee8]"
                }`}
              />

              {index < steps.length - 1 && (
                <span className="min-h-8 w-px flex-1 bg-[#dddcd4]" />
              )}
            </div>

            <div className="pb-4">
              <p className={step.complete ? "text-sm font-medium text-[#344038]" : "text-sm text-[#a3a69f]"}>
                {step.label}
              </p>

              {step.timestamp && (
                <p className="mt-1 text-xs text-[#8a8f87]">
                  {formatTimestamp(step.timestamp)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
