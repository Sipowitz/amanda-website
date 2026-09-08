import useBusinessClock from "../../hooks/useBusinessClock";
import { isSlotPast } from "../../utils/slotTime";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";
import AdminCard from "../../components/admin/AdminCard";
import { isNormalAdminBooking } from "../../components/admin/bookings/bookingDisplay";
import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { getAdminBookings } from "../../services/adminService";

function formatDate(dateString) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(`${dateString}T12:00:00`));
}

function appointmentTime(booking) {
  return Date.parse(booking.availability_slots.starts_at);
}

export default function AdminDashboard() {
  const [bookingRecords, setBookingRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const { now, timezone, today } = useBusinessClock();
  const navigate = useNavigate();
  const { logout } = useAdminAuth();
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    let active = true;
    getAdminBookings().then((bookings) => {
      if (active) setBookingRecords(bookings);
    }).catch(() => {
      if (active) setError("Failed to load dashboard. Please try again.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [reload]);

  async function handleLogout() {
    const accepted = await confirm({
      title: "Logout", message: "Are you sure you want to logout?", confirmText: "Logout",
    });
    if (!accepted) return;
    try {
      await logout();
      toast.success("Logged out successfully");
      navigate("/admin/login", { replace: true });
    } catch (reason) {
      toast.error(reason.message || "Failed to logout");
    }
  }

  const work = useMemo(() => {
    const confirmed = bookingRecords.filter((booking) =>
      isNormalAdminBooking(booking) && booking.status === "confirmed",
    );
    const timed = confirmed.filter((booking) =>
      booking.service_booking_mode_snapshot === "timed" && booking.availability_slots,
    ).sort((a, b) => appointmentTime(a) - appointmentTime(b));
    return {
      today: timed.filter((booking) => booking.availability_slots.slot_date === today),
      overdue: timed.filter((booking) => booking.availability_slots.slot_date < today),
      upcoming: timed.filter((booking) => booking.availability_slots.slot_date > today),
      memos: confirmed.filter((booking) => booking.service_booking_mode_snapshot === "untimed")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    };
  }, [bookingRecords, today]);

  const legacyNeedsReview = bookingRecords.some((booking) =>
    booking.service_payment_flow_snapshot !== "direct_payment" && (
      booking.status === "pending" ||
      (booking.status === "confirmed" && ["unpaid", "part_paid"].includes(booking.payment_status))
    ),
  );
  const hour = timezone ? Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date(now))) : null;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const currentDateLabel = timezone ? new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: timezone,
  }).format(now) : undefined;
  const openBookings = () => navigate("/admin/bookings", { state: { filter: "confirmed" } });

  function renderWorkRow(booking) {
    const slot = booking.availability_slots;
    const isTimed = booking.service_booking_mode_snapshot === "timed";
    const overdue = isTimed && isSlotPast(slot, now);
    return (
      <button
        key={booking.id}
        type="button"
        onClick={openBookings}
        className="group flex w-full flex-col gap-4 border-b border-[#e1e5df] px-1 py-5 text-left transition last:border-b-0 hover:bg-white/[0.018] sm:flex-row sm:items-center"
      >
        <div className="shrink-0 sm:w-36">
          {isTimed ? <>
            <p className="text-sm text-[#202620]/65">{formatDate(slot.slot_date)}</p>
            <p className="mt-1 text-xl font-light text-[#202620]">{slot.slot_time}</p>
          </> : <p className="text-sm text-[#202620]/65">Untimed request</p>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg text-[#202620]">{booking.customer_name}</p>
          <p className="mt-1 text-sm text-[#202620]/65">{booking.service_name_snapshot}</p>
          <p className="mt-1 truncate text-sm text-[#202620]/50">{booking.customer_email}</p>
        </div>
        {overdue && <span className="w-fit rounded-full border border-[#ead7a6] bg-[#f8edcf] px-3 py-1 text-[10px] font-medium text-[#7b5b12]">Overdue · review outcome</span>}
        <span className="hidden text-[#202620]/25 transition group-hover:translate-x-1 group-hover:text-[#202620]/60 sm:block">→</span>
      </button>
    );
  }

  function renderSection(title, bookings, emptyMessage, { limit, description } = {}) {
    return (
      <section className="flex min-w-0 flex-col gap-5" aria-label={title}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-light text-[#202620]">{title}</h2>
            {description && <p className="mt-2 text-sm text-[#202620]/65">{description}</p>}
          </div>
          <span className="text-xl font-light text-[#202620]/65">{bookings.length}</span>
        </div>
        <AdminCard className="px-5 sm:px-6">
          {bookings.length === 0 ? <p className="py-11 text-sm text-[#202620]/50">{emptyMessage}</p>
            : (limit ? bookings.slice(0, limit) : bookings).map(renderWorkRow)}
          {limit && bookings.length > limit && (
            <button type="button" onClick={openBookings} className="py-4 text-sm text-[#365d3c]">
              View all {bookings.length} upcoming appointments →
            </button>
          )}
        </AdminCard>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <AdminHeader
        title={timezone ? `${greeting}, Amanda` : "Amanda"}
        subtitle={currentDateLabel}
        description="Your appointments and Voice Memos awaiting completion."
        onLogout={handleLogout}
      />
      {loading || !timezone ? <AdminCard className="p-8"><p className="text-sm text-[#202620]/50">Loading dashboard...</p></AdminCard>
        : error ? <AdminCard className="p-8">
          <p role="alert" className="text-sm text-[#202620]">{error}</p>
          <button type="button" className="mt-4 text-sm text-[#365d3c]" onClick={() => {
            setError(""); setLoading(true); setReload((value) => value + 1);
          }}>Try again</button>
        </AdminCard> : <>
          <div className="flex justify-end">
            <button type="button" onClick={openBookings} className="text-sm text-[#365d3c]">Manage bookings →</button>
          </div>
          {work.overdue.length > 0 && renderSection("Overdue appointments", work.overdue, "", {
            description: "These appointments still need an outcome recorded in Bookings.",
          })}
          {renderSection("Today’s appointments", work.today, "Nothing scheduled today.")}
          <div className="grid gap-8 xl:grid-cols-2">
            {renderSection("Upcoming appointments", work.upcoming, "No upcoming appointments.", { limit: 5 })}
            {renderSection("Voice Memos awaiting completion", work.memos, "No Voice Memos awaiting completion.")}
          </div>
          {legacyNeedsReview && <div className="border-t border-[#e1e5df] pt-5">
            <button type="button" onClick={openBookings} className="text-sm text-[#202620]/65">Review historical bookings in Bookings →</button>
          </div>}
        </>}
    </div>
  );
}
