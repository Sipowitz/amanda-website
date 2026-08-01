import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import BookingCard from "../../components/admin/bookings/BookingCard";
import BookingFilters from "../../components/admin/bookings/BookingFilters";
import CreateBookingPanel from "../../components/admin/bookings/CreateBookingPanel";

import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";

import {
  cancelBooking,
  createAdminBooking,
  getAdminBookings,
  getAvailableAdminSlots,
  updateBookingPayment,
  updateBookingStatus,
} from "../../services/adminService";

export default function AdminBookings() {
  const [bookings, setBookings] = useState([]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [updatingBookingId, setUpdatingBookingId] = useState(null);
  const [savingPaymentId, setSavingPaymentId] = useState(null);
  const [openPaymentId, setOpenPaymentId] = useState(null);
  const [paymentForms, setPaymentForms] = useState({});
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [search, setSearch] = useState("");
  const location = useLocation();
  const [filter, setFilter] = useState(location.state?.filter || "upcoming");
  const [formData, setFormData] = useState({ slotId: "", name: "", email: "", phone: "", message: "" });

  const navigate = useNavigate();
  const { logout } = useAdminAuth();
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (location.state?.filter) {
      setFilter(location.state.filter);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  async function loadData() {
    try {
      setLoading(true);
      const [bookingsData, slotsData] = await Promise.all([getAdminBookings(), getAvailableAdminSlots()]);
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
    setFormData((previous) => ({ ...previous, [name]: value }));
  }

  function getInitialPaymentForm(booking) {
    return {
      paymentStatus: booking.payment_status || "unpaid",
      amountDue: String(booking.amount_due ?? 0),
      amountPaid: String(booking.amount_paid ?? 0),
      paymentMethod: booking.payment_method || "",
      paymentReference: booking.payment_reference || "",
    };
  }

  function togglePaymentPanel(booking) {
    setOpenPaymentId((currentId) => (currentId === booking.id ? null : booking.id));
    setPaymentForms((previous) => previous[booking.id] ? previous : { ...previous, [booking.id]: getInitialPaymentForm(booking) });
  }

  function handlePaymentFormChange(bookingId, event) {
    const { name, value } = event.target;
    setPaymentForms((previous) => {
      const nextForm = { ...(previous[bookingId] || {}), [name]: value };
      if (name === "paymentStatus") {
        if (value === "unpaid") { nextForm.amountPaid = "0"; nextForm.paymentMethod = ""; }
        if (value === "paid") nextForm.amountPaid = nextForm.amountDue || "0";
        if (value === "waived") { nextForm.amountPaid = "0"; nextForm.paymentMethod = "complimentary"; }
      }
      if (name === "amountDue" && nextForm.paymentStatus === "paid") nextForm.amountPaid = value;
      return { ...previous, [bookingId]: nextForm };
    });
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
      setFormData({ slotId: "", name: "", email: "", phone: "", message: "" });
      setShowCreatePanel(false);
      toast.success("Booking created successfully");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to create booking");
    } finally {
      setCreatingBooking(false);
    }
  }

  async function handleStatusChange(booking, nextStatus) {
    const labels = {
      pending: "return this booking to pending",
      confirmed: "confirm this booking",
      completed: "mark this booking as completed",
      no_show: "mark this customer as a no-show",
    };
    const accepted = await confirm({ title: "Update Booking", message: `Are you sure you want to ${labels[nextStatus]}?`, confirmText: "Update Booking" });
    if (!accepted) return;
    try {
      setUpdatingBookingId(booking.id);
      await updateBookingStatus(booking.id, nextStatus);
      await loadData();
      toast.success({ pending: "Booking returned to pending", confirmed: "Booking confirmed successfully", completed: "Booking marked as completed", no_show: "Booking marked as a no-show" }[nextStatus]);
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to update booking");
    } finally {
      setUpdatingBookingId(null);
    }
  }

  async function handlePaymentSubmit(event, booking) {
    event.preventDefault();
    const paymentForm = paymentForms[booking.id] || getInitialPaymentForm(booking);
    const amountDue = Number(paymentForm.amountDue);
    const amountPaid = Number(paymentForm.amountPaid);
    if (!Number.isFinite(amountDue) || amountDue < 0) return toast.error("Amount due must be zero or greater");
    if (!Number.isFinite(amountPaid) || amountPaid < 0) return toast.error("Amount paid must be zero or greater");
    try {
      setSavingPaymentId(booking.id);
      await updateBookingPayment({ bookingId: booking.id, paymentStatus: paymentForm.paymentStatus, amountDue, amountPaid, paymentMethod: paymentForm.paymentMethod, paymentReference: paymentForm.paymentReference });
      await loadData();
      setOpenPaymentId(null);
      setPaymentForms((previous) => { const next = { ...previous }; delete next[booking.id]; return next; });
      toast.success("Payment details updated successfully");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to update payment");
    } finally {
      setSavingPaymentId(null);
    }
  }

  async function handleCancelBooking(bookingId) {
    const accepted = await confirm({ title: "Cancel Booking", message: "Are you sure you want to cancel this booking? The appointment slot will become available again.", confirmText: "Cancel Booking" });
    if (!accepted) return;
    try {
      setUpdatingBookingId(bookingId);
      await cancelBooking(bookingId);
      await loadData();
      toast.success("Booking cancelled successfully");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to cancel booking");
    } finally {
      setUpdatingBookingId(null);
    }
  }

  async function handleLogout() {
    const accepted = await confirm({ title: "Logout", message: "Are you sure you want to logout?", confirmText: "Logout" });
    if (!accepted) return;
    try {
      await logout();
      toast.success("Logged out successfully");
      navigate("/admin/login", { replace: true });
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
        if (!slot) return false;
        const term = search.trim().toLowerCase();
        const matchesSearch = !term || [booking.customer_name, booking.customer_email, booking.customer_phone].filter(Boolean).some((value) => value.toLowerCase().includes(term));
        const isUpcoming = slot.slot_date >= today;
        if (filter === "upcoming") return matchesSearch && isUpcoming;
        if (filter === "past") return matchesSearch && !isUpcoming;
        if (filter === "payment_due") return matchesSearch && ["unpaid", "part_paid"].includes(booking.payment_status);
        if (filter === "paid") return matchesSearch && booking.payment_status === "paid";
        if (["pending", "confirmed", "completed", "no_show", "cancelled"].includes(filter)) return matchesSearch && booking.status === filter;
        return matchesSearch;
      })
      .sort((a, b) => new Date(`${a.availability_slots.slot_date}T${a.availability_slots.slot_time}`) - new Date(`${b.availability_slots.slot_date}T${b.availability_slots.slot_time}`));
  }, [bookings, search, filter]);

  return (
    <div className="-mx-5 -my-7 min-h-screen bg-[#f5f2ea] px-5 py-7 text-[#283128] sm:-mx-7 sm:px-7 lg:-mx-10 lg:-my-10 lg:px-10 lg:py-10 xl:-mx-14 xl:px-14">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8">
        <header className="flex flex-col gap-6 border-b border-[#dedad1] pb-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#59645b]">
              Booking Management
            </p>

            <h1 className="font-serif text-5xl font-normal leading-tight text-[#1e2821] sm:text-6xl">
              Bookings
            </h1>

            <p className="mt-4 max-w-2xl text-base leading-7 text-[#566158]">
              Review requests, manage payments and progress each appointment through its lifecycle.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-fit rounded-full border border-[#d3cfc5] bg-white/70 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#39443c] transition hover:bg-white"
          >
            Logout
          </button>
        </header>

        <BookingFilters
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        showCreatePanel={showCreatePanel}
        onToggleCreate={() => setShowCreatePanel((value) => !value)}
      />

      {showCreatePanel && (
        <CreateBookingPanel
          availableSlots={availableSlots}
          formData={formData}
          onChange={handleFormChange}
          onSubmit={handleCreateBooking}
          creating={creatingBooking}
        />
      )}

      {loading ? (
        <div className="rounded-[1.1rem] border border-[#dfdbd2] bg-white/85 p-8 shadow-[0_8px_28px_rgba(45,55,45,0.06)]">
          <p className="text-sm text-[#687169]">Loading bookings...</p>
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="rounded-[1.1rem] border border-[#dfdbd2] bg-white/85 p-8 shadow-[0_8px_28px_rgba(45,55,45,0.06)]">
          <p className="text-sm text-[#687169]">No bookings found.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredBookings.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              isUpdating={updatingBookingId === booking.id}
              isSavingPayment={savingPaymentId === booking.id}
              paymentPanelOpen={openPaymentId === booking.id}
              paymentForm={paymentForms[booking.id] || getInitialPaymentForm(booking)}
              onTogglePayment={togglePaymentPanel}
              onPaymentChange={handlePaymentFormChange}
              onPaymentSubmit={handlePaymentSubmit}
              onStatusChange={handleStatusChange}
              onCancel={handleCancelBooking}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
