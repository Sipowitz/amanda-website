export default function BookingRequestSummary({ details }) {
  const hasDetails = details.name || details.email || details.phone || details.message;

  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-5 py-4 backdrop-blur-sm sm:px-6">
      <p className="text-xs uppercase tracking-[0.2em] text-[#f1e8ca]/55">
        Request details saved
      </p>
      {hasDetails ? (
        <div className="mt-3 grid gap-x-6 gap-y-2 text-sm text-[#f1e8ca]/78 sm:grid-cols-2">
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
          <p className="min-w-0 break-words sm:col-span-2">
            <span className="text-[#f1e8ca]/45">Topic</span>{" "}
            <span className="text-[#f1e8ca]">{details.message}</span>
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-[#f1e8ca]/60">Loading your saved request…</p>
      )}
    </section>
  );
}
