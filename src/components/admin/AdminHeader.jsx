export default function AdminHeader({
  title,
  subtitle,
  description,
  onLogout,
}) {
  return (
    <header className="flex flex-col gap-6 border-b border-[#dde2da] pb-8 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-3xl">
        {subtitle && (
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#5d6b5d]">
            {subtitle}
          </p>
        )}

        <h1 className="font-serif text-4xl font-normal leading-tight text-[#1f251f] sm:text-5xl">
          {title}
        </h1>

        {description && (
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[#5c645c] sm:text-base">
            {description}
          </p>
        )}
      </div>

      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="w-fit rounded-full border border-[#d6ddd3] bg-white px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#344034] shadow-sm transition hover:border-[#9fb09f] hover:bg-[#f4f6f1]"
        >
          Logout
        </button>
      )}
    </header>
  );
}
