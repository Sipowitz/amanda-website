export default function AdminHeader({
  title,
  subtitle,
  description,
  onLogout,
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-[#dfe4dc] pb-7 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-3xl">
        {subtitle && (
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#5d6b5d]">
            {subtitle}
          </p>
        )}

        <h1 className="font-serif text-3xl font-normal leading-tight text-[#1f251f] sm:text-4xl">
          {title}
        </h1>

        {description && (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5c645c] sm:text-[15px]">
            {description}
          </p>
        )}
      </div>

      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="w-fit rounded-lg border border-[#cfd8ce] bg-white px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#344034] shadow-sm transition hover:border-[#9fb09f] hover:bg-[#f4f6f1] focus:outline-none focus:ring-4 focus:ring-[#55735b]/15"
        >
          Logout
        </button>
      )}
    </header>
  );
}
