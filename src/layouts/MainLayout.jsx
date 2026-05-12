import Navbar from "../components/Navbar";

export default function MainLayout({ children }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#9ebd9e] text-[#f1e8ca] [transform:translateZ(0)] [backface-visibility:hidden]">
      {/* Atmospheric Background */}
      <div className="pointer-events-none absolute inset-0 [transform:translateZ(0)] [contain:paint]">
        {/* Base atmosphere */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(95,120,95,0.18),transparent_42%)]" />

        {/* Central soft light */}
        <div className="absolute left-1/2 top-[28%] h-[340px] w-[340px] -translate-x-1/2 rounded-full bg-white/[0.05] blur-[40px]" />

        {/* Top fade */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.05] via-transparent to-black/[0.14]" />

        {/* Side depth */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/[0.06] via-transparent to-black/[0.05]" />
      </div>

      {/* Grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] [transform:translateZ(0)]"
        style={{
          backgroundImage:
            "url('https://grainy-gradients.vercel.app/noise.svg')",
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col [transform:translateZ(0)]">
        <Navbar />

        <main className="flex-1 pt-24">{children}</main>
      </div>
    </div>
  );
}
