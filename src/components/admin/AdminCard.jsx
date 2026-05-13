export default function AdminCard({ children, className = "" }) {
  return (
    <div
      className={`relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/10 backdrop-blur-2xl ${className}`}
    >
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_38%)]" />

        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-black/[0.08]" />
      </div>

      <div className="relative z-10">{children}</div>
    </div>
  );
}
