import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";
import AdminCard from "../../components/admin/AdminCard";

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

const paymentMethods = [
  {
    value: "",
    label: "Select payment method",
  },
  {
    value: "cash",
    label: "Cash",
  },
  {
    value: "bank_transfer",
    label: "Bank Transfer",
  },
  {
    value: "card",
    label: "Card",
  },
  {
    value: "payment_link",
    label: "Payment Link",
  },
  {
    value: "stripe",
    label: "Stripe",
  },
  {
    value: "complimentary",
    label: "Complimentary",
  },
  {
    value: "other",
    label: "Other",
  },
];

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

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
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
    setOpenPaymentId((currentId) =>
      currentId === booking.id ? null : booking.id,
    );

    setPaymentForms((previous) => {
      if (previous[booking.id]) {
        return previous;
      }

      return {
        ...previous,
        [booking.id]: getInitialPaymentForm(booking),
      };
    });
  }

  function handlePaymentFormChange(bookingId, event) {
    const { name, value } = event.target;

    setPaymentForms((previous) => {
      const currentForm = previous[bookingId] || {};

      const nextForm = {
        ...currentForm,
        [name]: value,
      };

      if (name === "paymentStatus") {
        if (value === "unpaid") {
          nextForm.amountPaid = "0";
          nextForm.paymentMethod = "";
        }

        if (value === "paid") {
          nextForm.amountPaid = nextForm.amountDue || "0";
        }

        if (value === "waived") {
          nextForm.amountPaid = "0";
          nextForm.paymentMethod = "complimentary";
        }
      }

      if (
        name === "amountDue" &&
        nextForm.paymentStatus === "paid"
      ) {
        nextForm.amountPaid = value;
      }

      return {
        ...previous,
        [bookingId]: nextForm,
      };
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

    const confirmed = await confirm({
      title: "Update Booking",
      message: `Are you sure you want to ${labels[nextStatus]}?`,
      confirmText: "Update Booking",
    });

    if (!confirmed) {
      return;
    }

    try {
      setUpdatingBookingId(booking.id);

      await updateBookingStatus(booking.id, nextStatus);

      await loadData();

      const successMessages = {
        pending: "Booking returned to pending",
        confirmed: "Booking confirmed successfully",
        completed: "Booking marked as completed",
        no_show: "Booking marked as a no-show",
      };

      toast.success(successMessages[nextStatus]);
    } catch (error) {
      console.error(error);

      toast.error(error.message || "Failed to update booking");
    } finally {
      setUpdatingBookingId(null);
    }
  }

  async function handlePaymentSubmit(event, booking) {
    event.preventDefault();

    const paymentForm =
      paymentForms[booking.id] || getInitialPaymentForm(booking);

    const amountDue = Number(paymentForm.amountDue);

    const amountPaid = Number(paymentForm.amountPaid);

    if (!Number.isFinite(amountDue) || amountDue < 0) {
      toast.error("Amount due must be zero or greater");

      return;
    }

    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      toast.error("Amount paid must be zero or greater");

      return;
    }

    try {
      setSavingPaymentId(booking.id);

      await updateBookingPayment({
        bookingId: booking.id,
        paymentStatus: paymentForm.paymentStatus,
        amountDue,
        amountPaid,
        paymentMethod: paymentForm.paymentMethod,
        paymentReference: paymentForm.paymentReference,
      });

      await loadData();

      setOpenPaymentId(null);

      setPaymentForms((previous) => {
        const nextForms = {
          ...previous,
        };

        delete nextForms[booking.id];

        return nextForms;
      });

      toast.success("Payment details updated successfully");
    } catch (error) {
      console.error(error);

      toast.error(error.message || "Failed to update payment");
    } finally {
      setSavingPaymentId(null);
    }
  }

  async function handleCancelBooking(bookingId) {
    const confirmed = await confirm({
      title: "Cancel Booking",
      message:
        "Are you sure you want to cancel this booking? The appointment slot will become available again.",
      confirmText: "Cancel Booking",
    });

    if (!confirmed) {
      return;
    }

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

      navigate("/admin/login", {
        replace: true,
      });
    } catch (error) {
      console.error(error);

      toast.error("Failed to logout");
    }
  }

  function getStatusStyles(status) {
    switch (status) {
      case "confirmed":
        return "border-emerald-200/20 bg-emerald-500/10 text-emerald-100";

      case "cancelled":
        return "border-red-200/20 bg-red-500/10 text-red-100";

      case "completed":
        return "border-sky-200/20 bg-sky-500/10 text-sky-100";

      case "no_show":
        return "border-white/10 bg-black/15 text-[#f1e8ca]/55";

      case "pending":
      default:
        return "border-amber-200/20 bg-amber-500/10 text-amber-100";
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case "no_show":
        return "No Show";

      case "confirmed":
        return "Confirmed";

      case "cancelled":
        return "Cancelled";

      case "completed":
        return "Completed";

      case "pending":
      default:
        return "Pending";
    }
  }

  function getPaymentStyles(status) {
    switch (status) {
      case "paid":
        return "border-emerald-200/20 bg-emerald-500/10 text-emerald-100";

      case "part_paid":
        return "border-amber-200/20 bg-amber-500/10 text-amber-100";

      case "waived":
        return "border-sky-200/20 bg-sky-500/10 text-sky-100";

      case "refunded":
      case "part_refunded":
        return "border-violet-200/20 bg-violet-500/10 text-violet-100";

      case "unpaid":
      default:
        return "border-red-200/20 bg-red-500/10 text-red-100";
    }
  }

  function getPaymentLabel(status) {
    switch (status) {
      case "part_paid":
        return "Part Paid";

      case "paid":
        return "Paid";

      case "waived":
        return "Waived";

      case "refunded":
        return "Refunded";

      case "part_refunded":
        return "Part Refunded";

      case "unpaid":
      default:
        return "Unpaid";
    }
  }

  function getPaymentMethodLabel(method) {
    const matchingMethod = paymentMethods.find(
      (paymentMethod) => paymentMethod.value === method,
    );

    return matchingMethod?.label || method || "Not recorded";
  }

  function formatCurrency(value) {
    const numericValue = Number(value || 0);

    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(numericValue);
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return null;
    }

    return new Date(timestamp).toLocaleString("en-GB");
  }

  const filteredBookings = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];

    return bookings
      .filter((booking) => {
        const slot = booking.availability_slots;

        if (!slot) {
          return false;
        }

        const searchTerm = search.trim().toLowerCase();

        const matchesSearch =
          searchTerm === ""
            ? true
            : [
                booking.customer_name,
                booking.customer_email,
                booking.customer_phone,
              ]
                .filter(Boolean)
                .some((value) =>
                  value.toLowerCase().includes(searchTerm),
                );

        const isUpcoming = slot.slot_date >= today;

        if (filter === "upcoming") {
          return matchesSearch && isUpcoming;
        }

        if (filter === "past") {
          return matchesSearch && !isUpcoming;
        }

        if (filter === "payment_due") {
          return (
            matchesSearch &&
            ["unpaid", "part_paid"].includes(booking.payment_status)
          );
        }

        if (filter === "paid") {
          return matchesSearch && booking.payment_status === "paid";
        }

        if (
          ["pending", "confirmed", "completed", "no_show", "cancelled"].includes(
            filter,
          )
        ) {
          return matchesSearch && booking.status === filter;
        }

        return matchesSearch;
      })
      .sort((firstBooking, secondBooking) => {
        const firstDate = `${firstBooking.availability_slots.slot_date} ${firstBooking.availability_slots.slot_time}`;

        const secondDate = `${secondBooking.availability_slots.slot_date} ${secondBooking.availability_slots.slot_time}`;

        return new Date(firstDate) - new Date(secondDate);
      });
  }, [bookings, search, filter]);

  return (
    <div className="flex flex-col gap-16">
      <AdminHeader
        title="Bookings"
        subtitle="Booking Management"
        onLogout={handleLogout}
      />

      <AdminCard className="p-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full max-w-xl">
              <input
                type="text"
                placeholder="Search by name, email, or phone..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none backdrop-blur-xl transition placeholder:text-[#f1e8ca]/30 focus:border-[#f1e8ca]/35 focus:bg-white/[0.07]"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowCreatePanel((previous) => !previous)}
              className="w-fit rounded-full border border-[#f1e8ca]/15 bg-[#f1e8ca]/[0.08] px-5 py-2 text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/75 transition hover:border-[#f1e8ca]/30 hover:bg-[#f1e8ca]/12 hover:text-[#f1e8ca]"
            >
              {showCreatePanel ? "Close" : "New Booking"}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              ["upcoming", "Upcoming"],
              ["pending", "Pending"],
              ["confirmed", "Confirmed"],
              ["payment_due", "Payment Due"],
              ["paid", "Paid"],
              ["completed", "Completed"],
              ["no_show", "No Show"],
              ["cancelled", "Cancelled"],
              ["past", "Past"],
              ["all", "All"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.16em] transition ${
                  filter === value
                    ? "bg-[#f1e8ca]/12 text-[#f1e8ca]"
                    : "text-[#f1e8ca]/45 hover:text-[#f1e8ca]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {showCreatePanel && (
            <div className="border-t border-white/10 pt-6">
              <form
                onSubmit={handleCreateBooking}
                className="flex flex-col gap-5"
              >
                <div className="flex flex-col gap-3">
                  <label
                    htmlFor="admin-booking-slot"
                    className="text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/55"
                  >
                    Select Slot
                  </label>

                  <select
                    id="admin-booking-slot"
                    required
                    name="slotId"
                    value={formData.slotId}
                    onChange={handleFormChange}
                    className="rounded-2xl border border-white/10 bg-[#718971] px-5 py-4 text-[#f1e8ca] outline-none transition focus:border-[#f1e8ca]/35"
                  >
                    <option value="">Select an available slot</option>

                    {availableSlots.map((slot) => (
                      <option key={slot.id} value={slot.id}>
                        {slot.slot_date} — {slot.slot_time}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <input
                    type="text"
                    required
                    name="name"
                    placeholder="Customer Name"
                    value={formData.name}
                    onChange={handleFormChange}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none transition placeholder:text-[#f1e8ca]/30 focus:border-[#f1e8ca]/35"
                  />

                  <input
                    type="email"
                    required
                    name="email"
                    placeholder="Customer Email"
                    value={formData.email}
                    onChange={handleFormChange}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none transition placeholder:text-[#f1e8ca]/30 focus:border-[#f1e8ca]/35"
                  />

                  <input
                    type="text"
                    name="phone"
                    placeholder="Phone Number"
                    value={formData.phone}
                    onChange={handleFormChange}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none transition placeholder:text-[#f1e8ca]/30 focus:border-[#f1e8ca]/35"
                  />
                </div>

                <textarea
                  rows="4"
                  name="message"
                  placeholder="Internal or customer notes..."
                  value={formData.message}
                  onChange={handleFormChange}
                  className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none transition placeholder:text-[#f1e8ca]/30 focus:border-[#f1e8ca]/35"
                />

                <button
                  type="submit"
                  disabled={creatingBooking}
                  className="w-fit rounded-2xl border border-[#f1e8ca]/15 bg-[#f1e8ca]/10 px-8 py-4 text-[#f1e8ca] transition hover:bg-[#f1e8ca]/16 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creatingBooking ? "Creating..." : "Create Booking"}
                </button>
              </form>
            </div>
          )}
        </div>
      </AdminCard>

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

            const isCancelled = booking.status === "cancelled";

            const isUpdating = updatingBookingId === booking.id;

            const isSavingPayment = savingPaymentId === booking.id;

            const paymentPanelOpen = openPaymentId === booking.id;

            const paymentForm =
              paymentForms[booking.id] || getInitialPaymentForm(booking);

            return (
              <AdminCard
                key={booking.id}
                className={`overflow-hidden transition ${
                  isCancelled ? "opacity-65" : "opacity-100"
                }`}
              >
                <div className="p-6">
                  <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex flex-col gap-5">
                      <div className="flex flex-wrap items-start gap-4">
                        <div>
                          <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                            Customer
                          </p>

                          <h2 className="text-3xl text-[#f1e8ca]">
                            {booking.customer_name}
                          </h2>
                        </div>

                        <span
                          className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${getStatusStyles(
                            booking.status,
                          )}`}
                        >
                          {getStatusLabel(booking.status)}
                        </span>

                        <span
                          className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${getPaymentStyles(
                            booking.payment_status,
                          )}`}
                        >
                          {getPaymentLabel(booking.payment_status)}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1 text-sm text-[#f1e8ca]/65">
                        <a
                          href={`mailto:${booking.customer_email}`}
                          className="transition hover:text-[#f1e8ca]"
                        >
                          {booking.customer_email}
                        </a>

                        {booking.customer_phone && (
                          <a
                            href={`tel:${booking.customer_phone}`}
                            className="transition hover:text-[#f1e8ca]"
                          >
                            {booking.customer_phone}
                          </a>
                        )}
                      </div>

                      <div className="grid gap-5 sm:grid-cols-2">
                        <div>
                          <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                            Appointment
                          </p>

                          <div className="flex flex-col gap-1 text-[#f1e8ca]/75">
                            <p>{slot.slot_date}</p>

                            <p>{slot.slot_time}</p>
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                            Payment
                          </p>

                          <div className="flex flex-col gap-1 text-sm text-[#f1e8ca]/70">
                            <p>
                              Due: {formatCurrency(booking.amount_due)}
                            </p>

                            <p>
                              Paid: {formatCurrency(booking.amount_paid)}
                            </p>

                            {booking.payment_method && (
                              <p>
                                Method:{" "}
                                {getPaymentMethodLabel(
                                  booking.payment_method,
                                )}
                              </p>
                            )}

                            {booking.payment_reference && (
                              <p>
                                Reference: {booking.payment_reference}
                              </p>
                            )}
                          </div>
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

                      <div className="flex flex-col gap-1 text-xs text-[#f1e8ca]/40">
                        {booking.confirmed_at && (
                          <p>
                            Confirmed{" "}
                            {formatTimestamp(booking.confirmed_at)}
                          </p>
                        )}

                        {booking.paid_at && (
                          <p>
                            Paid {formatTimestamp(booking.paid_at)}
                          </p>
                        )}

                        {booking.completed_at && (
                          <p>
                            Completed{" "}
                            {formatTimestamp(booking.completed_at)}
                          </p>
                        )}

                        {booking.cancelled_at && (
                          <p>
                            Cancelled{" "}
                            {formatTimestamp(booking.cancelled_at)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex max-w-md flex-wrap justify-start gap-3 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => togglePaymentPanel(booking)}
                        className="rounded-full border border-[#f1e8ca]/15 bg-[#f1e8ca]/[0.08] px-5 py-2 text-xs uppercase tracking-[0.16em] text-[#f1e8ca]/75 transition hover:border-[#f1e8ca]/30 hover:bg-[#f1e8ca]/12 hover:text-[#f1e8ca]"
                      >
                        {paymentPanelOpen
                          ? "Close Payment"
                          : "Manage Payment"}
                      </button>

                      {isCancelled ? (
                        <span className="rounded-full border border-white/10 bg-black/[0.08] px-5 py-2 text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/35">
                          Booking Cancelled
                        </span>
                      ) : (
                        <>
                          {booking.status !== "pending" && (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() =>
                                handleStatusChange(booking, "pending")
                              }
                              className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-2 text-xs uppercase tracking-[0.16em] text-[#f1e8ca]/65 transition hover:border-white/20 hover:text-[#f1e8ca] disabled:opacity-40"
                            >
                              Pending
                            </button>
                          )}

                          {booking.status !== "confirmed" && (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() =>
                                handleStatusChange(booking, "confirmed")
                              }
                              className="rounded-full border border-emerald-200/20 bg-emerald-500/10 px-5 py-2 text-xs uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-40"
                            >
                              Confirm
                            </button>
                          )}

                          {booking.status === "confirmed" && (
                            <>
                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() =>
                                  handleStatusChange(
                                    booking,
                                    "completed",
                                  )
                                }
                                className="rounded-full border border-sky-200/20 bg-sky-500/10 px-5 py-2 text-xs uppercase tracking-[0.16em] text-sky-100 transition hover:bg-sky-500/15 disabled:opacity-40"
                              >
                                Complete
                              </button>

                              <button
                                type="button"
                                disabled={isUpdating}
                                onClick={() =>
                                  handleStatusChange(
                                    booking,
                                    "no_show",
                                  )
                                }
                                className="rounded-full border border-white/10 bg-black/10 px-5 py-2 text-xs uppercase tracking-[0.16em] text-[#f1e8ca]/60 transition hover:text-[#f1e8ca] disabled:opacity-40"
                              >
                                No Show
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() =>
                              handleCancelBooking(booking.id)
                            }
                            className="rounded-full border border-red-200/15 bg-red-500/[0.08] px-5 py-2 text-xs uppercase tracking-[0.16em] text-red-100/75 transition hover:border-red-200/30 hover:bg-red-500/12 disabled:opacity-40"
                          >
                            {isUpdating ? "Updating..." : "Cancel"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {paymentPanelOpen && (
                  <div className="border-t border-white/10 bg-black/[0.05] p-6">
                    <form
                      onSubmit={(event) =>
                        handlePaymentSubmit(event, booking)
                      }
                      className="flex flex-col gap-5"
                    >
                      <div>
                        <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#f1e8ca]/40">
                          Payment Management
                        </p>

                        <h3 className="text-2xl text-[#f1e8ca]">
                          Update Payment
                        </h3>
                      </div>

                      <div className="grid gap-5 md:grid-cols-2">
                        <div className="flex flex-col gap-2">
                          <label
                            htmlFor={`payment-status-${booking.id}`}
                            className="text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/50"
                          >
                            Payment Status
                          </label>

                          <select
                            id={`payment-status-${booking.id}`}
                            name="paymentStatus"
                            value={paymentForm.paymentStatus}
                            onChange={(event) =>
                              handlePaymentFormChange(
                                booking.id,
                                event,
                              )
                            }
                            className="rounded-2xl border border-white/10 bg-[#718971] px-5 py-4 text-[#f1e8ca] outline-none focus:border-[#f1e8ca]/35"
                          >
                            <option value="unpaid">Unpaid</option>
                            <option value="part_paid">
                              Part Paid
                            </option>
                            <option value="paid">Paid</option>
                            <option value="waived">Waived</option>
                          </select>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label
                            htmlFor={`payment-method-${booking.id}`}
                            className="text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/50"
                          >
                            Payment Method
                          </label>

                          <select
                            id={`payment-method-${booking.id}`}
                            name="paymentMethod"
                            value={paymentForm.paymentMethod}
                            disabled={
                              paymentForm.paymentStatus === "unpaid" ||
                              paymentForm.paymentStatus === "waived"
                            }
                            onChange={(event) =>
                              handlePaymentFormChange(
                                booking.id,
                                event,
                              )
                            }
                            className="rounded-2xl border border-white/10 bg-[#718971] px-5 py-4 text-[#f1e8ca] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {paymentMethods.map((method) => (
                              <option
                                key={method.value}
                                value={method.value}
                              >
                                {method.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label
                            htmlFor={`amount-due-${booking.id}`}
                            className="text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/50"
                          >
                            Amount Due
                          </label>

                          <input
                            id={`amount-due-${booking.id}`}
                            type="number"
                            name="amountDue"
                            min="0"
                            step="0.01"
                            required
                            value={paymentForm.amountDue}
                            onChange={(event) =>
                              handlePaymentFormChange(
                                booking.id,
                                event,
                              )
                            }
                            className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none focus:border-[#f1e8ca]/35"
                          />
                        </div>

                        <div className="flex flex-col gap-2">
                          <label
                            htmlFor={`amount-paid-${booking.id}`}
                            className="text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/50"
                          >
                            Amount Paid
                          </label>

                          <input
                            id={`amount-paid-${booking.id}`}
                            type="number"
                            name="amountPaid"
                            min="0"
                            step="0.01"
                            required
                            value={paymentForm.amountPaid}
                            disabled={
                              paymentForm.paymentStatus === "unpaid" ||
                              paymentForm.paymentStatus === "waived"
                            }
                            onChange={(event) =>
                              handlePaymentFormChange(
                                booking.id,
                                event,
                              )
                            }
                            className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <label
                          htmlFor={`payment-reference-${booking.id}`}
                          className="text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/50"
                        >
                          Payment Reference
                        </label>

                        <input
                          id={`payment-reference-${booking.id}`}
                          type="text"
                          name="paymentReference"
                          placeholder="Optional transaction or payment reference"
                          value={paymentForm.paymentReference}
                          onChange={(event) =>
                            handlePaymentFormChange(
                              booking.id,
                              event,
                            )
                          }
                          className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-[#f1e8ca] outline-none placeholder:text-[#f1e8ca]/30 focus:border-[#f1e8ca]/35"
                        />
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="submit"
                          disabled={isSavingPayment}
                          className="rounded-2xl border border-emerald-200/20 bg-emerald-500/10 px-7 py-3 text-sm text-emerald-100 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingPayment
                            ? "Saving..."
                            : "Save Payment"}
                        </button>

                        <button
                          type="button"
                          disabled={isSavingPayment}
                          onClick={() => setOpenPaymentId(null)}
                          className="rounded-2xl border border-white/10 bg-white/[0.04] px-7 py-3 text-sm text-[#f1e8ca]/65 transition hover:text-[#f1e8ca] disabled:opacity-50"
                        >
                          Close
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </AdminCard>
            );
          })}
        </div>
      )}
    </div>
  );
}