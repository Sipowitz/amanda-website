function formatTotal(amountMinor, currency) {
  if (!Number.isInteger(amountMinor) || !currency) return "";
  return (amountMinor / 100).toLocaleString("en-US", {
    style: "currency",
    currency,
  });
}

function formatAppointmentDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export default function BookingRequestSummary({ details }) {
  const hasDetails = details.name || details.email || details.phone || details.message;
  const isTimed = details.bookingMode === "timed";
  const total = formatTotal(details.amountMinor, details.currency);

  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-sm sm:px-5">
      <p className="text-xs uppercase tracking-[0.2em] text-[#f1e8ca]/55">
        {isTimed ? "Booking details saved" : "Request details saved"}
      </p>
      {hasDetails ? (
        <div className="mt-2 grid gap-x-6 gap-y-1.5 text-sm text-[#f1e8ca]/78 sm:grid-cols-2">
          {details.serviceName && (
            <p className="min-w-0 break-words">
              <span className="text-[#f1e8ca]/45">Service</span>{" "}
              <span className="text-[#f1e8ca]">{details.serviceName}</span>
            </p>
          )}
          {total && (
            <p className="min-w-0 break-words">
              <span className="text-[#f1e8ca]/45">Total</span>{" "}
              <span className="text-[#f1e8ca]">{total}</span>
            </p>
          )}
          {isTimed && details.appointmentDate && (
            <p className="min-w-0 break-words">
              <span className="text-[#f1e8ca]/45">Date</span>{" "}
              <span className="text-[#f1e8ca]">{formatAppointmentDate(details.appointmentDate)}</span>
            </p>
          )}
          {isTimed && details.appointmentTime && (
            <p className="min-w-0 break-words">
              <span className="text-[#f1e8ca]/45">Time</span>{" "}
              <span className="text-[#f1e8ca]">{details.appointmentTime}</span>
            </p>
          )}
          <p className="min-w-0 truncate">
            <span className="text-[#f1e8ca]/45">Name</span>{" "}
            <span className="text-[#f1e8ca]">{details.name}</span>
          </p>
          <p className="min-w-0 break-words">
            <span className="text-[#f1e8ca]/45">Email</span>{" "}
            <span className="text-[#f1e8ca]">{details.email}</span>
          </p>
          {details.phone && (
            <p className="min-w-0 break-words sm:col-span-2">
              <span className="text-[#f1e8ca]/45">Phone</span>{" "}
              <span className="text-[#f1e8ca]">{details.phone}</span>
            </p>
          )}
          {details.message && (
            <p className="min-w-0 break-words sm:col-span-2">
              <span className="text-[#f1e8ca]/45">{isTimed ? "Message" : "Topic"}</span>{" "}
              <span className="text-[#f1e8ca]">{details.message}</span>
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-[#f1e8ca]/60">Loading your saved request…</p>
      )}
    </section>
  );
}
