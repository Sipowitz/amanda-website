import { useEffect, useMemo, useRef, useState } from "react";

import { format } from "date-fns";

import { useNavigate } from "react-router-dom";

import SlotGenerator from "../../components/admin/SlotGenerator";
import SlotItem from "../../components/admin/SlotItem";

import AdminHeader from "../../components/admin/AdminHeader";
import AdminCard from "../../components/admin/AdminCard";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

import { useToast } from "../../contexts/ToastContext";

import { useConfirm } from "../../contexts/ConfirmContext";

import {
  cancelBooking,
  deletePastAvailabilitySlots,
  deleteSlot,
  generateSlots,
  getAdminSlots,
} from "../../services/adminService";

export default function AdminSlots() {
  const cleanupStartedRef = useRef(false);

  const [slots, setSlots] = useState([]);

  const [generating, setGenerating] = useState(false);

  const [loadingSlots, setLoadingSlots] = useState(true);

  const [cancellingBookingId, setCancellingBookingId] = useState(null);

  const [viewMode, setViewMode] = useState("all");

  const [selectedDate, setSelectedDate] = useState(null);

  const navigate = useNavigate();

  const { logout } = useAdminAuth();

  const toast = useToast();

  const confirm = useConfirm();

  useEffect(() => {
    if (cleanupStartedRef.current) {
      return;
    }

    cleanupStartedRef.current = true;

    async function cleanUpAndLoadSlots() {
      try {
        setLoadingSlots(true);

        await deletePastAvailabilitySlots();

        const data = await getAdminSlots();

        setSlots(data);

        if (data.length > 0) {
          setSelectedDate(data[0].slot_date);
        }
      } catch (error) {
        console.error(error);

        toast.error("Failed to load slots");
      } finally {
        setLoadingSlots(false);
      }
    }

    cleanUpAndLoadSlots();
  }, [toast]);

  async function loadSlots() {
    try {
      setLoadingSlots(true);

      const data = await getAdminSlots();

      setSlots(data);

      if (data.length > 0 && !selectedDate) {
        setSelectedDate(data[0].slot_date);
      }
    } catch (error) {
      console.error(error);

      toast.error("Failed to load slots");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function handleGenerateSlots(data) {
    try {
      setGenerating(true);

      await generateSlots(data);

      await loadSlots();

      toast.success("Slots generated successfully");
    } catch (error) {
      console.error(error);

      toast.error("Failed to generate slots");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteSlot(slotId) {
    const confirmed = await confirm({
      title: "Delete Slot",
      message:
        "Are you sure you want to delete this slot? This action cannot be undone.",
      confirmText: "Delete Slot",
    });

    if (!confirmed) {
      return;
    }

    try {
      await deleteSlot(slotId);

      setSlots((prev) => prev.filter((slot) => slot.id !== slotId));

      toast.success("Slot deleted successfully");
    } catch (error) {
      console.error(error);

      toast.error(error.message || "Failed to delete slot");
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
      setCancellingBookingId(bookingId);

      await cancelBooking(bookingId);

      await loadSlots();

      toast.success("Booking cancelled successfully");
    } catch (error) {
      console.error(error);

      toast.error(error.message || "Failed to cancel booking");
    } finally {
      setCancellingBookingId(null);
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

  function getActiveBookings(slot) {
    if (!slot.bookings) {
      return [];
    }

    return slot.bookings.filter(
      (booking) => booking.status !== "cancelled",
    );
  }

  const filteredSlots = useMemo(() => {
    let result = [...slots];

    if (viewMode === "bookings") {
      result = result.filter((slot) => getActiveBookings(slot).length > 0);
    }

    if (selectedDate) {
      result = result.filter((slot) => slot.slot_date === selectedDate);
    }

    return result.sort((a, b) => a.slot_time.localeCompare(b.slot_time));
  }, [slots, viewMode, selectedDate]);

  const availableDates = useMemo(() => {
    return [...new Set(slots.map((slot) => slot.slot_date))];
  }, [slots]);

  const selectedDateStats = useMemo(() => {
    const total = filteredSlots.length;

    const booked = filteredSlots.filter(
      (slot) => getActiveBookings(slot).length > 0,
    ).length;

    const available = total - booked;

    return {
      total,
      booked,
      available,
    };
  }, [filteredSlots]);

  return (
    <div className="flex flex-col gap-10">
      <AdminHeader
        title="Availability"
        subtitle="Booking Management"
        onLogout={handleLogout}
      />

      <SlotGenerator onGenerate={handleGenerateSlots} loading={generating} />

      <section className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#202620]/45">
              Schedule Overview
            </p>

            <h2 className="text-4xl text-[#202620]">Availability</h2>
          </div>

          <AdminCard className="p-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode("all")}
                className={`rounded-full px-5 py-2 text-xs uppercase tracking-[0.18em] transition ${
                  viewMode === "all"
                    ? "bg-[#dce8da] text-[#202620]"
                    : "text-[#202620]/45 hover:text-[#202620]"
                }`}
              >
                All Slots
              </button>

              <button
                type="button"
                onClick={() => setViewMode("bookings")}
                className={`rounded-full px-5 py-2 text-xs uppercase tracking-[0.18em] transition ${
                  viewMode === "bookings"
                    ? "bg-[#dce8da] text-[#202620]"
                    : "text-[#202620]/45 hover:text-[#202620]"
                }`}
              >
                Bookings Only
              </button>
            </div>
          </AdminCard>
        </div>

        {/* Date Selector */}
        <AdminCard className="p-5">
          <div className="mb-5">
            <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#202620]/40">
              Schedule Navigation
            </p>

            <h3 className="text-2xl text-[#202620]">Select Day</h3>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2">
            {availableDates.map((date) => {
              const active = selectedDate === date;

              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelectedDate(date)}
                  className={`min-w-[140px] rounded-2xl border px-4 py-4 text-left transition ${
                    active
                      ? "border-[#f1e8ca]/25 bg-[#e5eee3]"
                      : "border-[#d9dfd6] bg-[#f7f8f5] hover:border-[#b9c9b7] hover:bg-white"
                  }`}
                >
                  <p className="mb-1 text-xs uppercase tracking-[0.18em] text-[#202620]/40">
                    {format(new Date(date), "EEE")}
                  </p>

                  <p className="text-lg text-[#202620]">
                    {format(new Date(date), "MMM d")}
                  </p>
                </button>
              );
            })}
          </div>
        </AdminCard>

        {/* Day Overview */}
        {selectedDate && (
          <div className="grid gap-4 sm:grid-cols-3">
            <AdminCard className="p-5">
              <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#202620]/40">
                Total
              </p>

              <h3 className="text-3xl text-[#202620]">
                {selectedDateStats.total}
              </h3>
            </AdminCard>

            <AdminCard className="p-5">
              <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#202620]/40">
                Available
              </p>

              <h3 className="text-3xl text-[#202620]">
                {selectedDateStats.available}
              </h3>
            </AdminCard>

            <AdminCard className="p-5">
              <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#202620]/40">
                Booked
              </p>

              <h3 className="text-3xl text-[#202620]">
                {selectedDateStats.booked}
              </h3>
            </AdminCard>
          </div>
        )}

        {/* Schedule */}
        {loadingSlots ? (
          <AdminCard className="p-10">
            <p className="text-[#202620]/60">Loading schedule...</p>
          </AdminCard>
        ) : filteredSlots.length === 0 ? (
          <AdminCard className="p-10">
            <p className="text-[#202620]/60">No slots found for this day.</p>
          </AdminCard>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#202620]/45">
                Daily Schedule
              </p>

              <h2 className="text-4xl text-[#202620]">
                {format(new Date(selectedDate), "EEEE, MMMM d")}
              </h2>
            </div>

            <div className="flex flex-col gap-4">
              {filteredSlots.map((slot) => {
                const activeBookings = getActiveBookings(slot);

                return (
                  <SlotItem
                    key={slot.id}
                    slot={{
                      ...slot,
                      bookings: activeBookings,
                    }}
                    onDelete={handleDeleteSlot}
                    onDeleteBooking={handleCancelBooking}
                    cancellingBookingId={cancellingBookingId}
                  />
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}