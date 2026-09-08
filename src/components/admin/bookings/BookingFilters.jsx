import { adminBookingFilters } from "./bookingDisplay";

export default function BookingFilters({
  search,
  onSearchChange,
  filter,
  onFilterChange,
}) {
  return (
    <section className="rounded-2xl border border-[#ddd9cf] bg-[#fffefa] p-5 shadow-[0_6px_22px_rgba(45,55,45,0.055)] sm:p-6">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <label className="w-full max-w-2xl">
            <span className="sr-only">Search bookings</span>
            <div className="flex items-center gap-3 rounded-lg border border-[#d7d3c8] bg-[#fbfaf6] px-4 py-3 transition focus-within:border-[#6f8c72] focus-within:ring-4 focus-within:ring-[#6f8c72]/10">
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


        </div>

        <div className="flex flex-wrap gap-1 border-b border-[#e4e0d7] pb-0">
          {adminBookingFilters.map(([value, label]) => (
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
