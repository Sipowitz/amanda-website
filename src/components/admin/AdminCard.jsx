export default function AdminCard({
  children,
  className = "",
  interactive = false,
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[1.35rem] border border-[#d9ded5] bg-white shadow-[0_10px_35px_rgba(45,60,45,0.07)] transition ${
        interactive
          ? "hover:-translate-y-0.5 hover:border-[#b8c8b8] hover:shadow-[0_14px_40px_rgba(45,60,45,0.10)]"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
