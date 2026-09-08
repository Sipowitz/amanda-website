export default function AdminCard({
  children,
  className = "",
  interactive = false,
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-[#d9ded5] bg-[#fffefa] shadow-[0_6px_22px_rgba(45,60,45,0.055)] transition ${
        interactive
          ? "hover:-translate-y-0.5 hover:border-[#b8c8b8] hover:shadow-[0_10px_28px_rgba(45,60,45,0.09)]"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
