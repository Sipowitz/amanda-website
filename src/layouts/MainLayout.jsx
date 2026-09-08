import { Outlet } from "react-router-dom";

import Navbar from "../components/Navbar";

export default function MainLayout() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#9ebd9e] text-[#f1e8ca] [transform:translateZ(0)] [backface-visibility:hidden]">
      {/* Atmospheric Background */}
      <div className="pointer-events-none absolute inset-0 [transform:translateZ(0)] [contain:paint]">
        {/* One continuous, deliberately broad atmosphere across the public canvas. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_125%_85%_at_50%_-8%,rgba(255,255,255,0.18),transparent_62%),radial-gradient(ellipse_110%_120%_at_104%_106%,rgba(67,94,69,0.32),transparent_68%),radial-gradient(ellipse_90%_100%_at_-8%_70%,rgba(255,255,255,0.06),transparent_70%)]" />

        {/* A low-contrast edge falloff keeps the sage base matte rather than glossy. */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#4f7053]/[0.14]" />
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

        <main className="flex-1 pt-24">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
