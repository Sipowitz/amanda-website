import { Outlet } from "react-router-dom";

import AdminSidebar from "./AdminSidebar";

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-[#9ebd9e] px-6 py-10 text-[#f1e8ca]">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[260px_1fr]">
        <div>
          <AdminSidebar />
        </div>

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
