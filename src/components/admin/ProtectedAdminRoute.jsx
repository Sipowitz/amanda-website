import { Navigate, Outlet } from "react-router-dom";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

export default function ProtectedAdminRoute() {
  const { authenticated, loading } = useAdminAuth();

  if (loading) {
    return null;
  }

  if (!authenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
}
