export default function AdminHeader({ title, subtitle, onLogout }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
          {subtitle}
        </p>

        <h1 className="text-5xl">{title}</h1>
      </div>

      <button
        onClick={onLogout}
        className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/70 transition hover:border-[#f1e8ca]/25 hover:text-[#f1e8ca]"
      >
        Logout
      </button>
    </div>
  );
}
