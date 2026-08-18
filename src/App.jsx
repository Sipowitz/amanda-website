import { Routes, Route, Navigate } from "react-router-dom";

import MainLayout from "./layouts/MainLayout";

import Home from "./pages/Home";
import About from "./pages/About";
import Services from "./pages/Services";
import BookingModal from "./components/booking/BookingModal";
import Events from "./pages/Events";
import Shop from "./pages/Shop";
import Contact from "./pages/Contact";

import AdminLayout from "./components/admin/AdminLayout";
import ProtectedAdminRoute from "./components/admin/ProtectedAdminRoute";

import AdminLogin from "./pages/admin/AdminLogin";
import ResetPassword from "./pages/admin/ResetPassword";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminSlots from "./pages/admin/AdminSlots";
import AdminBookings from "./pages/admin/AdminBookings";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminEmailSettings from "./pages/admin/AdminEmailSettings";
import AdminPaymentSettings from "./pages/admin/AdminPaymentSettings";

export default function App() {
  return (
    <Routes>
      {/* Public Website */}
      <Route element={<MainLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/services" element={<Services />}>
          <Route
            path=":serviceSlug/book"
            element={<BookingModal expectedMode="timed" />}
          />
          <Route
            path=":serviceSlug/request"
            element={<BookingModal expectedMode="untimed" />}
          />
        </Route>
        <Route path="/booking" element={<Navigate to="/services" replace />} />
        <Route path="/events" element={<Events />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/contact" element={<Contact />} />
      </Route>

      {/* Authentication */}
      <Route
        path="/admin"
        element={<Navigate to="/admin/login" replace />}
      />

      <Route path="/admin/login" element={<AdminLogin />} />

      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Protected Admin Area */}
      <Route element={<ProtectedAdminRoute />}>
        <Route element={<AdminLayout />}>
          <Route
            path="/admin/dashboard"
            element={<AdminDashboard />}
          />

          <Route
            path="/admin/bookings"
            element={<AdminBookings />}
          />

          <Route
            path="/admin/availability"
            element={<AdminSlots />}
          />

          <Route
            path="/admin/settings"
            element={<AdminSettings />}
          />

          <Route
            path="/admin/settings/email"
            element={<AdminEmailSettings />}
          />

          <Route
            path="/admin/settings/payments"
            element={<AdminPaymentSettings />}
          />
        </Route>
      </Route>
    </Routes>
  );
}
