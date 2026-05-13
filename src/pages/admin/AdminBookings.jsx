import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";
import AdminCard from "../../components/admin/AdminCard";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

import { useToast } from "../../contexts/ToastContext";

import { useConfirm } from "../../contexts/ConfirmContext";

import {
  createAdminBooking,
  deleteBooking,
  getAdminBookings,
  getAvailableAdminSlots,
} from "../../services/adminService";

export default function AdminBookings() {
  const [bookings, setBookings] = useState([]);

  const [availableSlots, setAvailableSlots] = useState([]);

  const [loading, setLoading] = useState(true);

  const [creatingBooking, setCreatingBooking] = useState(false);

  const [showCreatePanel, setShowCreatePanel] = useState(false);

  const [search, setSearch] = useState("");

  const [filter, setFilter] = useState("upcoming");

  const [formData, setFormData] = useState({
    slotId: "",
    name: "",
    email: "",
    phone: "",
    message: "",
  });

  const navigate = useNavigate();

  const { logout } = useAdminAuth();

  const toast = useToast();

  const confirm = useConfirm();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);

      const [bookingsData, slotsData] = await Promise.all([
        getAdminBookings(),
        getAvailableAdminSlots(),
      ]);

      setBookings(bookingsData);

      setAvailableSlots(slotsData);
    } catch (error) {
      console.error(error);

      toast.error("Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }

  function handleFormChange(event) {
    const { name, value } = event.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleCreateBooking(event) {
    event.preventDefault();

    try {
      setCreatingBooking(true);

      await createAdminBooking({
        slotId: formData.slotId,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        message: formData.message,
      });

      await loadData();

      setFormData({
        slotId: "",
        name: "",
        email: "",
        phone: "",
        message: "",
      });

      setShowCreatePanel(false);

      toast.success("Booking created successfully");
    } catch (error) {
      console.error(error);

      toast.error("Failed to create booking");
    } finally {
      setCreatingBooking(false);
    }
  }

  async function handleCancelBooking(bookingId, slotId) {
    const confirmed = await confirm({
      title: "Cancel Booking",
      message: "Are you sure you want to cancel this booking?",
      confirmText: "Cancel Booking",
    });

    if (!confirmed) {
      return;
    }

    try {
      await deleteBooking(bookingId, slotId);

      setBookings((prev) => prev.filter((booking) => booking.id !== bookingId));

      await loadData();

      toast.success("Booking cancelled successfully");
    } catch (error) {
      console.error(error);

      toast.error("Failed to cancel booking");
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

  const filteredBookings = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];

    return bookings
      .filter((booking) => {
        const slot = booking.availability_slots;

        if (!slot) {
          return false;
        }

        const matchesSearch =
          search.trim() === ""
            ? true
            : [
                booking.customer_name,
                booking.customer_email,
                booking.customer_phone,
              ]
                .filter(Boolean)
                .some((value) =>
                  value.toLowerCase().includes(search.toLowerCase()),
                );

        const isUpcoming = slot.slot_date >= today;

        if (filter === "upcoming") {
          return matchesSearch && isUpcoming;
        }

        if (filter === "past") {
          return matchesSearch && !isUpcoming;
        }

        return matchesSearch;
      })
      .sort((a, b) => {
        const dateA = `${a.availability_slots.slot_date} ${a.availability_slots.slot_time}`;

        const dateB = `${b.availability_slots.slot_date} ${b.availability_slots.slot_time}`;

        return new Date(dateA) - new Date(dateB);
      });
  }, [bookings, search, filter]);

  return (
    <div className="flex flex-col gap-16">
      <AdminHeader
        title="Bookings"
        subtitle="Booking Management"
        onLogout={handleLogout}
      />

      {/* Controls */}
      <AdminCard className="p-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            {/* Search */}
            <div className="w-full max-w-xl">
              <input
                type="text"
                placeholder="Search by name, email, or phone..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Filters */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFilter("upcoming")}
                  className={`rounded-full px-5 py-2 text-xs uppercase tracking-[0.18em] transition ${
                    filter === "upcoming"
                      ? "bg-[#f1e8ca]/12 text-[#f1e8ca]"
                      : "text-[#f1e8ca]/45 hover:text-[#f1e8ca]"
                  }`}
                >
                  Upcoming
                </button>

                <button
                  onClick={() => setFilter("past")}
                  className={`rounded-full px-5 py-2 text-xs uppercase tracking-[0.18em] transition ${
                    filter === "past"
                      ? "bg-[#f1e8ca]/12 text-[#f1e8ca]"
                      : "text-[#f1e8ca]/45 hover:text-[#f1e8ca]"
                  }`}
                >
                  Past
                </button>

                <button
                  onClick={() => setFilter("all")}
                  className={`rounded-full px-5 py-2 text-xs uppercase tracking-[0.18em] transition ${
                    filter === "all"
                      ? "bg-[#f1e8ca]/12 text-[#f1e8ca]"
                      : "text-[#f1e8ca]/45 hover:text-[#f1e8ca]"
                  }`}
                >
                  All
                </button>
              </div>

              {/* Create */}
              <button
                onClick={() => setShowCreatePanel((prev) => !prev)}
                className="rounded-full border border-[#f1e8ca]/15 bg-[#f1e8ca]/[0.08] px-5 py-2 text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/75 backdrop-blur-xl transition hover:border-[#f1e8ca]/30 hover:bg-[#f1e8ca]/12 hover:text-[#f1e8ca]"
              >
                {showCreatePanel ? "Close" : "New Booking"}
              </button>
            </div>
          </div>

          {/* Create Panel */}
          {showCreatePanel && (
            <div className="border-t border-white/10 pt-6">
              <form
                onSubmit={handleCreateBooking}
                className="flex flex-col gap-5"
              >
                {/* Slot */}
                <div className="flex flex-col gap-3">
                  <label className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55">
                    Select Slot
                  </label>

                  <select
                    required
                    name="slotId"
                    value={formData.slotId}
                    onChange={handleFormChange}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
                  >
                    <option value="">Select an available slot</option>

                    {availableSlots.map((slot) => (
                      <option key={slot.id} value={slot.id}>
                        {slot.slot_date} — {slot.slot_time}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Customer Fields */}
                <div className="grid gap-5 md:grid-cols-2">
                  <input
                    type="text"
                    required
                    name="name"
                    placeholder="Customer Name"
                    value={formData.name}
                    onChange={handleFormChange}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
                  />

                  <input
                    type="email"
                    required
                    name="email"
                    placeholder="Customer Email"
                    value={formData.email}
                    onChange={handleFormChange}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
                  />

                  <input
                    type="text"
                    name="phone"
                    placeholder="Phone Number"
                    value={formData.phone}
                    onChange={handleFormChange}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
                  />
                </div>

                <textarea
                  rows="4"
                  name="message"
                  placeholder="Internal or customer notes..."
                  value={formData.message}
                  onChange={handleFormChange}
                  className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
                />

                <button
                  type="submit"
                  disabled={creatingBooking}
                  className="w-fit rounded-2xl border border-[#f1e8ca]/15 bg-[#f1e8ca]/10 px-8 py-4 text-[#f1e8ca] transition duration-300 hover:bg-[#f1e8ca]/16 disabled:opacity-50"
                >
                  {creatingBooking ? "Creating..." : "Create Booking"}
                </button>
              </form>
            </div>
          )}
        </div>
      </AdminCard>

      {/* Content */}
      {loading ? (
        <AdminCard className="p-10">
          <p className="text-[#f1e8ca]/60">Loading bookings...</p>
        </AdminCard>
      ) : filteredBookings.length === 0 ? (
        <AdminCard className="p-10">
          <p className="text-[#f1e8ca]/60">No bookings found.</p>
        </AdminCard>
      ) : (
        <div className="flex flex-col gap-5">
          {filteredBookings.map((booking) => {
            const slot = booking.availability_slots;

            return (
              <AdminCard key={booking.id} className="p-6">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  {/* Details */}
                  <div className="flex flex-col gap-5">
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                        Customer
                      </p>

                      <h2 className="text-3xl text-[#f1e8ca]">
                        {booking.customer_name}
                      </h2>
                    </div>

                    <div className="flex flex-col gap-1 text-sm text-[#f1e8ca]/65">
                      <p>{booking.customer_email}</p>

                      {booking.customer_phone && (
                        <p>{booking.customer_phone}</p>
                      )}
                    </div>

                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                        Appointment
                      </p>

                      <div className="flex flex-col gap-1 text-[#f1e8ca]/75">
                        <p>{slot.slot_date}</p>

                        <p>{slot.slot_time}</p>
                      </div>
                    </div>

                    {booking.customer_message && (
                      <div className="max-w-2xl rounded-2xl border border-white/10 bg-black/[0.08] p-4">
                        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#f1e8ca]/40">
                          Message
                        </p>

                        <p className="text-sm leading-relaxed text-[#f1e8ca]/65">
                          {booking.customer_message}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-start">
                    <button
                      onClick={() => handleCancelBooking(booking.id, slot.id)}
                      className="rounded-full border border-[#f1e8ca]/15 bg-[#f1e8ca]/[0.08] px-5 py-2 text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/70 backdrop-blur-xl transition hover:border-[#f1e8ca]/30 hover:bg-[#f1e8ca]/12 hover:text-[#f1e8ca]"
                    >
                      Cancel Booking
                    </button>
                  </div>
                </div>
              </AdminCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
