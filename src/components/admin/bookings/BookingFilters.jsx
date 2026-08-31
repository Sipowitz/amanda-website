const filters = [
  ["upcoming", "Upcoming"],
  ["pending", "Pending"],
  ["pending_payment", "Pending Payment"],
  ["payment_expired", "Payment Expired"],
  ["confirmed", "Confirmed"],
  ["payment_due", "Payment Due"],
  ["paid", "Paid"],
  ["completed", "Completed"],
  ["no_show", "No Show"],
  ["cancelled", "Cancelled"],
  ["past", "Past"],
  ["all", "All"],
];

export default function BookingFilters({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  showCreatePanel,
  onToggleCreate,
}) {
  return (
    <section className="rounded-[1.35rem] border border-[#ddd9cf] bg-white/80 p-5 shadow-[0_10px_35px_rgba(45,55,45,0.08)] backdrop-blur-xl sm:p-6">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <label className="w-full max-w-2xl">
            <span className="sr-only">Search bookings</span>
            <div className="flex items-center gap-3 rounded-xl border border-[#d7d3c8] bg-[#fbfaf6] px-4 py-3.5 transition focus-within:border-[#6f8c72] focus-within:ring-2 focus-within:ring-[#6f8c72]/10">
              <span className="text-lg text-[#6d746b]">⌕</span>
              <input
                type="search"
                placeholder="Search by name, email, or phone..."
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                className="w-full bg-transparent text-sm text-[#283128] outline-none placeholder:text-[#8a9088]"
              />
            </div>
          </label>

          <button
            type="button"
            onClick={onToggleCreate}
            className="w-fit rounded-xl bg-[#365d3c] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white shadow-sm transition hover:bg-[#2d5133]"
          >
            {showCreatePanel ? "Close" : "+ New Booking"}
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-[#e4e0d7] pb-0">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                filter === value
                  ? "border-[#365d3c] text-[#253429]"
                  : "border-transparent text-[#757b73] hover:text-[#344238]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
