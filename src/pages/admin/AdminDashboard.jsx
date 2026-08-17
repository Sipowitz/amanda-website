import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";
import AdminCard from "../../components/admin/AdminCard";

import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";

import { getAdminBookings, getAdminSlots } from "../../services/adminService";

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();

  const month = String(date.getMonth() + 1).padStart(2, "0");

  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function formatDate(dateString, options = {}) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...options,
  }).format(new Date(`${dateString}T12:00:00`));
}

function getBookingStatusLabel(status) {
  switch (status) {
    case "confirmed":
      return "Confirmed";

    case "completed":
      return "Completed";

    case "no_show":
      return "No Show";

    case "cancelled":
      return "Cancelled";

    case "pending":
    default:
      return "Pending";
  }
}

function getPaymentStatusLabel(status) {
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

function getStatusStyles(status) {
  switch (status) {
    case "confirmed":
      return "border-emerald-200/15 bg-emerald-500/[0.08] text-emerald-100/85";

    case "completed":
      return "border-sky-200/15 bg-sky-500/[0.08] text-sky-100/85";

    case "cancelled":
      return "border-red-200/15 bg-red-500/[0.08] text-red-100/75";

    case "no_show":
      return "border-[#d9dfd6] bg-[#f3f5f1] text-[#202620]/50";

    case "pending":
    default:
      return "border-amber-200/15 bg-amber-500/[0.08] text-amber-100/85";
  }
}

function getPaymentStyles(status) {
  switch (status) {
    case "paid":
      return "border-emerald-200/15 bg-emerald-500/[0.08] text-emerald-100/85";

    case "part_paid":
      return "border-amber-200/15 bg-amber-500/[0.08] text-amber-100/85";

    case "waived":
      return "border-sky-200/15 bg-sky-500/[0.08] text-sky-100/80";

    case "unpaid":
    default:
      return "border-orange-200/15 bg-orange-500/[0.08] text-orange-100/80";
  }
}

export default function AdminDashboard() {
  const [slots, setSlots] = useState([]);
  const [bookingRecords, setBookingRecords] = useState([]);

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

      const [slotsData, bookingsData] = await Promise.all([
        getAdminSlots(),
        getAdminBookings(),
      ]);

      setSlots(slotsData);
      setBookingRecords(bookingsData);
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

      navigate("/admin/login", {
        replace: true,
      });
    } catch (error) {
      console.error(error);

      toast.error("Failed to logout");
    }
  }

  const today = getLocalDateString();

  const endOfWeek = useMemo(() => {
    const date = new Date();

    date.setDate(date.getDate() + 7);

    return getLocalDateString(date);
  }, []);

  const bookings = useMemo(() => {
    return bookingRecords
      .filter((booking) => booking.status !== "cancelled")
      .map((booking) => ({
        ...booking,
        slot: booking.availability_slots || null,
      }));
  }, [bookingRecords]);

  const upcomingBookings = useMemo(() => {
    return bookings
      .filter((booking) => booking.slot?.slot_date >= today)
      .sort((first, second) => {
        const firstDate = `${first.slot.slot_date}T${first.slot.slot_time}`;

        const secondDate = `${second.slot.slot_date}T${second.slot.slot_time}`;

        return new Date(firstDate) - new Date(secondDate);
      });
  }, [bookings, today]);

  const todaysBookings = useMemo(() => {
    return upcomingBookings.filter(
      (booking) => booking.slot.slot_date === today,
    );
  }, [upcomingBookings, today]);

  const weeksBookings = useMemo(() => {
    return upcomingBookings.filter(
      (booking) => booking.slot.slot_date <= endOfWeek,
    );
  }, [upcomingBookings, endOfWeek]);

  const pendingBookings = useMemo(() => {
    return bookings.filter((booking) => booking.status === "pending");
  }, [bookings]);

  const paymentDueBookings = useMemo(() => {
    return bookings.filter(
      (booking) =>
        ["unpaid", "part_paid"].includes(booking.payment_status) &&
        Number(booking.amount_due || 0) >
          Number(booking.amount_paid || 0),
    );
  }, [bookings]);

  const outstandingAmount = useMemo(() => {
    return paymentDueBookings.reduce((total, booking) => {
      const amountDue = Number(booking.amount_due || 0);

      const amountPaid = Number(booking.amount_paid || 0);

      return total + Math.max(amountDue - amountPaid, 0);
    }, 0);
  }, [paymentDueBookings]);

  const receivedAmount = useMemo(() => {
    return bookings.reduce(
      (total, booking) => total + Number(booking.amount_paid || 0),
      0,
    );
  }, [bookings]);

  const needsAttention = useMemo(() => {
    const items = [];

    pendingBookings.forEach((booking) => {
      items.push({
        id: `pending-${booking.id}`,
        booking,
        type: "confirmation",
        eyebrow: "Awaiting confirmation",
        detail: booking.slot
          ? `${formatDate(booking.slot.slot_date)} · ${booking.slot.slot_time}`
          : `${booking.service_name_snapshot} · Untimed request`,
        priority: 1,
      });
    });

    paymentDueBookings.forEach((booking) => {
      const remaining =
        Number(booking.amount_due || 0) -
        Number(booking.amount_paid || 0);

      items.push({
        id: `payment-${booking.id}`,
        booking,
        type: "payment",
        eyebrow:
          booking.payment_status === "part_paid"
            ? "Balance outstanding"
            : "Payment outstanding",
        detail: `${formatCurrency(remaining)} remaining`,
        priority: 2,
      });
    });

    return items
      .sort((first, second) => first.priority - second.priority)
      .slice(0, 6);
  }, [pendingBookings, paymentDueBookings]);

  const nextUpcomingBookings = useMemo(() => {
    return upcomingBookings
      .filter((booking) => booking.slot.slot_date > today)
      .slice(0, 5);
  }, [upcomingBookings, today]);

  const attentionCount = needsAttention.length;

  const currentDateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  function openBookings(filter) {
    navigate("/admin/bookings", {
      state: {
        filter,
      },
    });
  }

  function renderScheduleRow(booking) {
    return (
      <button
        key={booking.id}
        type="button"
        onClick={() => navigate("/admin/bookings")}
        className="group flex w-full flex-col gap-4 border-b border-[#e1e5df] px-1 py-5 text-left transition last:border-b-0 hover:bg-white/[0.018] sm:flex-row sm:items-center"
      >
        <div className="w-20 shrink-0">
          <p className="text-xl font-light text-[#202620]">
            {booking.slot.slot_time}
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-lg text-[#202620]">
            {booking.customer_name}
          </p>

          <p className="mt-1 truncate text-sm text-[#202620]/42">
            {booking.customer_email}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:justify-end">
          <span
            className={`rounded-full border px-3 py-1 text-[9px] font-medium uppercase tracking-[0.16em] ${getStatusStyles(
              booking.status,
            )}`}
          >
            {getBookingStatusLabel(booking.status)}
          </span>

          <span
            className={`rounded-full border px-3 py-1 text-[9px] font-medium uppercase tracking-[0.16em] ${getPaymentStyles(
              booking.payment_status,
            )}`}
          >
            {getPaymentStatusLabel(booking.payment_status)}
          </span>
        </div>

        <span className="hidden text-[#202620]/25 transition group-hover:translate-x-1 group-hover:text-[#202620]/60 sm:block">
          →
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <AdminHeader
        title={`${getGreeting()}, Amanda`}
        subtitle={currentDateLabel}
        description={
          attentionCount > 0
            ? `You have ${attentionCount} ${
                attentionCount === 1 ? "item" : "items"
              } requiring attention.`
            : "Everything is up to date. There are no urgent actions waiting."
        }
        onLogout={handleLogout}
      />

      {loading ? (
        <AdminCard className="p-8">
          <p className="text-sm text-[#202620]/50">Loading dashboard...</p>
        </AdminCard>
      ) : (
        <>
          {/* Summary */}
          <section>
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-[#202620]/35">
                  Overview
                </p>

                <h2 className="mt-2 text-2xl font-light text-[#202620]">
                  Today’s summary
                </h2>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AdminCard interactive className="p-5">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[#202620]/36">
                  Today
                </p>

                <div className="mt-4 flex items-end justify-between gap-4">
                  <p className="text-4xl font-light text-[#202620]">
                    {todaysBookings.length}
                  </p>

                  <p className="pb-1 text-xs text-[#202620]/38">
                    Appointments
                  </p>
                </div>
              </AdminCard>

              <button
                type="button"
                onClick={() => openBookings("pending")}
                className="text-left"
              >
                <AdminCard interactive className="h-full p-5">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-[#202620]/36">
                    Pending
                  </p>

                  <div className="mt-4 flex items-end justify-between gap-4">
                    <p className="text-4xl font-light text-[#202620]">
                      {pendingBookings.length}
                    </p>

                    <p className="pb-1 text-xs text-[#202620]/38">
                      Requests
                    </p>
                  </div>
                </AdminCard>
              </button>

              <button
                type="button"
                onClick={() => openBookings("payment_due")}
                className="text-left"
              >
                <AdminCard interactive className="h-full p-5">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-[#202620]/36">
                    Outstanding
                  </p>

                  <div className="mt-4 flex items-end justify-between gap-4">
                    <p className="text-3xl font-light text-[#202620]">
                      {formatCurrency(outstandingAmount)}
                    </p>

                    <p className="pb-1 text-xs text-[#202620]/38">
                      To collect
                    </p>
                  </div>
                </AdminCard>
              </button>

              <AdminCard interactive className="p-5">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[#202620]/36">
                  Received
                </p>

                <div className="mt-4 flex items-end justify-between gap-4">
                  <p className="text-3xl font-light text-[#202620]">
                    {formatCurrency(receivedAmount)}
                  </p>

                  <p className="pb-1 text-xs text-[#202620]/38">
                    Recorded
                  </p>
                </div>
              </AdminCard>
            </div>
          </section>

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            {/* Needs attention */}
            <section className="flex min-w-0 flex-col gap-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-[#202620]/35">
                    Priority
                  </p>

                  <h2 className="mt-2 text-2xl font-light text-[#202620]">
                    Needs attention
                  </h2>
                </div>

                {attentionCount > 0 && (
                  <span className="rounded-full border border-amber-200/15 bg-amber-500/[0.08] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-100/80">
                    {attentionCount} open
                  </span>
                )}
              </div>

              <AdminCard>
                {needsAttention.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[#d9dfd6] bg-white/[0.025] text-[#202620]/45">
                      ✓
                    </div>

                    <h3 className="mt-4 text-xl font-light text-[#202620]">
                      Everything is up to date
                    </h3>

                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#202620]/42">
                      There are no booking requests or outstanding payments
                      requiring attention.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.07]">
                    {needsAttention.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          openBookings(
                            item.type === "confirmation"
                              ? "pending"
                              : "payment_due",
                          )
                        }
                        className="group flex w-full items-center gap-4 px-5 py-5 text-left transition hover:bg-white/[0.022]"
                      >
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                            item.type === "confirmation"
                              ? "bg-amber-200/70"
                              : "bg-orange-200/70"
                          }`}
                        />

                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#202620]/36">
                            {item.eyebrow}
                          </p>

                          <p className="mt-1 truncate text-lg text-[#202620]">
                            {item.booking.customer_name}
                          </p>

                          <p className="mt-1 text-sm text-[#202620]/42">
                            {item.detail}
                          </p>
                        </div>

                        <span className="text-[#202620]/25 transition group-hover:translate-x-1 group-hover:text-[#202620]/60">
                          →
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </AdminCard>
            </section>

            {/* This week */}
            <section className="flex min-w-0 flex-col gap-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-[#202620]/35">
                    Next seven days
                  </p>

                  <h2 className="mt-2 text-2xl font-light text-[#202620]">
                    This week
                  </h2>
                </div>

                <p className="text-2xl font-light text-[#202620]/65">
                  {weeksBookings.length}
                </p>
              </div>

              <AdminCard className="p-5">
                <div className="space-y-5">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#202620]/35">
                      Confirmed
                    </p>

                    <p className="mt-2 text-3xl font-light text-[#202620]">
                      {
                        weeksBookings.filter(
                          (booking) => booking.status === "confirmed",
                        ).length
                      }
                    </p>
                  </div>

                  <div className="h-px bg-white/[0.07]" />

                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#202620]/35">
                      Awaiting confirmation
                    </p>

                    <p className="mt-2 text-3xl font-light text-[#202620]">
                      {
                        weeksBookings.filter(
                          (booking) => booking.status === "pending",
                        ).length
                      }
                    </p>
                  </div>

                  <div className="h-px bg-white/[0.07]" />

                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#202620]/35">
                      Available slots
                    </p>

                    <p className="mt-2 text-3xl font-light text-[#202620]">
                      {
                        slots.filter(
                          (slot) =>
                            slot.is_available &&
                            slot.slot_date >= today &&
                            slot.slot_date <= endOfWeek,
                        ).length
                      }
                    </p>
                  </div>
                </div>
              </AdminCard>
            </section>
          </div>

          {/* Today's schedule */}
          <section className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-[#202620]/35">
                  Schedule
                </p>

                <h2 className="mt-2 text-2xl font-light text-[#202620]">
                  Today’s appointments
                </h2>
              </div>

              <button
                type="button"
                onClick={() => navigate("/admin/bookings")}
                className="text-xs text-[#202620]/42 transition hover:text-[#202620]/80"
              >
                View all bookings →
              </button>
            </div>

            <AdminCard className="px-5 sm:px-6">
              {todaysBookings.length === 0 ? (
                <div className="py-11">
                  <h3 className="text-xl font-light text-[#202620]">
                    Nothing scheduled today
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-[#202620]/42">
                    Today’s calendar is currently clear.
                  </p>
                </div>
              ) : (
                todaysBookings.map(renderScheduleRow)
              )}
            </AdminCard>
          </section>

          {/* Upcoming */}
          <section className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-[#202620]/35">
                  Looking ahead
                </p>

                <h2 className="mt-2 text-2xl font-light text-[#202620]">
                  Upcoming appointments
                </h2>
              </div>
            </div>

            <AdminCard>
              {nextUpcomingBookings.length === 0 ? (
                <div className="px-6 py-11">
                  <h3 className="text-xl font-light text-[#202620]">
                    No upcoming appointments
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-[#202620]/42">
                    Future bookings will appear here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.07]">
                  {nextUpcomingBookings.map((booking) => (
                    <button
                      key={booking.id}
                      type="button"
                      onClick={() => navigate("/admin/bookings")}
                      className="group grid w-full gap-3 px-5 py-5 text-left transition hover:bg-white/[0.022] sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center sm:px-6"
                    >
                      <div>
                        <p className="text-sm text-[#202620]/65">
                          {formatDate(booking.slot.slot_date)}
                        </p>

                        <p className="mt-1 text-xl font-light text-[#202620]">
                          {booking.slot.slot_time}
                        </p>
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-lg text-[#202620]">
                          {booking.customer_name}
                        </p>

                        <p className="mt-1 truncate text-sm text-[#202620]/38">
                          {booking.customer_email}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full border px-3 py-1 text-[9px] uppercase tracking-[0.16em] ${getStatusStyles(
                            booking.status,
                          )}`}
                        >
                          {getBookingStatusLabel(booking.status)}
                        </span>

                        <span className="text-[#202620]/20 transition group-hover:translate-x-1 group-hover:text-[#202620]/55">
                          →
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </AdminCard>
          </section>
        </>
      )}
    </div>
  );
}