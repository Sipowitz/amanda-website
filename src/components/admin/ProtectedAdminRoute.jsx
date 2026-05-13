import { Navigate, Outlet } from "react-router-dom";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

export default function ProtectedAdminRoute() {
  const { authenticated, loading, loggingOut } = useAdminAuth();

  if (loading || loggingOut) {
    return null;
  }

  if (!authenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
}
