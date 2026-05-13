import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";

import AdminCard from "../../components/admin/AdminCard";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

import { useToast } from "../../contexts/ToastContext";

import { useConfirm } from "../../contexts/ConfirmContext";

import { getAdminSlots } from "../../services/adminService";

export default function AdminDashboard() {
  const [slots, setSlots] = useState([]);

  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  const { logout } = useAdminAuth();

  const toast = useToast();

  const confirm = useConfirm();

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      setLoading(true);

      const data = await getAdminSlots();

      setSlots(data);
    } catch (error) {
      console.error(error);

      toast.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    const confirmed = await confirm({
      title: "Logout",
      message: "Are you sure you want to logout?",
      confirmText: "Logout",
    });

    if (!confirmed) {
      return;
    }

    try {
      await logout();

      toast.success("Logged out successfully");
    } catch (error) {
      console.error(error);

      toast.error("Failed to logout");
    }
  }

  const today = new Date().toISOString().split("T")[0];

  const weekFromNow = new Date();

  weekFromNow.setDate(weekFromNow.getDate() + 7);

  const bookedSlots = useMemo(() => {
    return slots.filter((slot) => slot.bookings && slot.bookings.length > 0);
  }, [slots]);

  const todaysBookings = useMemo(() => {
    return bookedSlots.filter((slot) => slot.slot_date === today);
  }, [bookedSlots, today]);

  const weeksBookings = useMemo(() => {
    return bookedSlots.filter((slot) => {
      const slotDate = new Date(slot.slot_date);

      return slotDate >= new Date(today) && slotDate <= weekFromNow;
    });
  }, [bookedSlots, today, weekFromNow]);

  const availableSlots = useMemo(() => {
    return slots.filter((slot) => slot.is_available);
  }, [slots]);

  function renderBookingList(bookings) {
    if (bookings.length === 0) {
      return (
        <AdminCard className="p-6">
          <p className="text-[#f1e8ca]/60">No bookings found.</p>
        </AdminCard>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {bookings.map((slot) => {
          const booking = slot.bookings?.[0];

          return (
            <AdminCard key={slot.id} className="p-6">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                      Appointment
                    </p>

                    <h3 className="text-2xl text-[#f1e8ca]">
                      {booking?.customer_name}
                    </h3>
                  </div>

                  <div className="flex flex-col gap-1 text-sm text-[#f1e8ca]/60">
                    <p>{slot.slot_date}</p>

                    <p>{slot.slot_time}</p>

                    <p>{booking?.customer_email}</p>

                    {booking?.customer_phone && <p>{booking.customer_phone}</p>}
                  </div>
                </div>
              </div>
            </AdminCard>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <AdminHeader
        title="Dashboard"
        subtitle="Booking Management"
        onLogout={handleLogout}
      />

      {loading ? (
        <AdminCard className="p-10">
          <p className="text-[#f1e8ca]/60">Loading dashboard...</p>
        </AdminCard>
      ) : (
        <>
          {/* Stats */}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AdminCard className="p-6">
              <p className="mb-3 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                Today
              </p>

              <h2 className="text-4xl text-[#f1e8ca]">
                {todaysBookings.length}
              </h2>

              <p className="mt-2 text-sm text-[#f1e8ca]/55">Bookings today</p>
            </AdminCard>

            <AdminCard className="p-6">
              <p className="mb-3 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                Upcoming
              </p>

              <h2 className="text-4xl text-[#f1e8ca]">
                {weeksBookings.length}
              </h2>

              <p className="mt-2 text-sm text-[#f1e8ca]/55">
                Bookings this week
              </p>
            </AdminCard>

            <AdminCard className="p-6">
              <p className="mb-3 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                Availability
              </p>

              <h2 className="text-4xl text-[#f1e8ca]">
                {availableSlots.length}
              </h2>

              <p className="mt-2 text-sm text-[#f1e8ca]/55">Available slots</p>
            </AdminCard>

            <AdminCard className="p-6">
              <p className="mb-3 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                Total
              </p>

              <h2 className="text-4xl text-[#f1e8ca]">{bookedSlots.length}</h2>

              <p className="mt-2 text-sm text-[#f1e8ca]/55">Total bookings</p>
            </AdminCard>
          </section>

          {/* Today's Bookings */}
          <section className="flex flex-col gap-6">
            <div>
              <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
                Priority
              </p>

              <h2 className="text-4xl text-[#f1e8ca]">Today's Bookings</h2>
            </div>

            {renderBookingList(todaysBookings)}
          </section>

          {/* Week's Bookings */}
          <section className="flex flex-col gap-6">
            <div>
              <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
                Upcoming
              </p>

              <h2 className="text-4xl text-[#f1e8ca]">This Week</h2>
            </div>

            {renderBookingList(weeksBookings)}
          </section>
        </>
      )}
    </div>
  );
}
