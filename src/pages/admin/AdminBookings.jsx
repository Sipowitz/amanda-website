import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import BookingCard from "../../components/admin/bookings/BookingCard";
import BookingFilters from "../../components/admin/bookings/BookingFilters";
import { normalizeBookingFilter, matchesBookingSearch, isNormalAdminBooking } from "../../components/admin/bookings/bookingDisplay";

import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";

import {
  cancelBooking,
  getAdminBookings,
  updateBookingPayment,
  updateBookingStatus,
} from "../../services/adminService";

export default function AdminBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingBookingId, setUpdatingBookingId] = useState(null);
  const [savingPaymentId, setSavingPaymentId] = useState(null);
  const [openPaymentId, setOpenPaymentId] = useState(null);
  const [paymentForms, setPaymentForms] = useState({});
  const [search, setSearch] = useState("");
  const location = useLocation();
  const [selectedFilter, setSelectedFilter] = useState("confirmed");
  const filter = location.state?.filter ? normalizeBookingFilter(location.state.filter) : selectedFilter;

  const navigate = useNavigate();
  const { logout } = useAdminAuth();
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    loadData();
  }, []);

  function handleFilterChange(value) {
    setSelectedFilter(normalizeBookingFilter(value));
    if (location.state?.filter) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }

  async function loadData() {
    try {
      setLoading(true);
      setBookings(await getAdminBookings());
    } catch (error) {
      console.error(error);
      toast.error("Failed to load bookings");
    } finally {
      setLoading(false);
    }
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

  async function handleCancelBooking(booking) {
    const bookingId = booking.id;
    const message = booking.slot_id
      ? "Are you sure you want to cancel this booking? The appointment slot will become available again."
      : "Are you sure you want to cancel this request?";
    const accepted = await confirm({ title: "Cancel Booking", message, confirmText: "Cancel Booking" });
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
    return bookings
      .filter((booking) => isNormalAdminBooking(booking) && (filter === "all" || booking.status === filter) && matchesBookingSearch(booking, search))
      .sort((a, b) => {
        if (!a.availability_slots && !b.availability_slots) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        if (!a.availability_slots) return -1;
        if (!b.availability_slots) return 1;
        return new Date(a.availability_slots.slot_date + "T" + a.availability_slots.slot_time) - new Date(b.availability_slots.slot_date + "T" + b.availability_slots.slot_time);
      });
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
              Manage appointments and Voice Memo requests awaiting completion.
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
        onFilterChange={handleFilterChange}
      />

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
      {!loading && bookings.some((booking) => booking.service_payment_flow_snapshot !== "direct_payment" && booking.status === "pending" && matchesBookingSearch(booking, search)) && (
        <details className="rounded-xl border border-[#dfdbd2] bg-white/85 p-5">
          <summary className="cursor-pointer text-sm font-medium text-[#39443c]">Legacy requests awaiting confirmation</summary>
          <div className="mt-4 flex flex-col gap-3">
            {bookings.filter((booking) => booking.service_payment_flow_snapshot !== "direct_payment" && booking.status === "pending" && matchesBookingSearch(booking, search)).map((booking) => (
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
        </details>
      )}
      </div>
    </div>
  );
}
