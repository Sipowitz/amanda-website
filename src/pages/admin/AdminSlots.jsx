import useBusinessClock from "../../hooks/useBusinessClock";
import { isSlotPast } from "../../utils/slotTime";
import { useEffect, useMemo, useState } from "react";

import { format } from "date-fns";

import { Link, useNavigate } from "react-router-dom";

import SlotGenerator from "../../components/admin/SlotGenerator";
import SlotItem from "../../components/admin/SlotItem";

import AdminHeader from "../../components/admin/AdminHeader";
import AdminCard from "../../components/admin/AdminCard";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

import { useToast } from "../../contexts/ToastContext";

import { useConfirm } from "../../contexts/ConfirmContext";

import {
  deleteSlot,
  generateSlots,
  getAdminSlots,
} from "../../services/adminService";

export default function AdminSlots() {
  const { now, timezone } = useBusinessClock();


  const [slots, setSlots] = useState([]);

  const [generating, setGenerating] = useState(false);

  const [loadingSlots, setLoadingSlots] = useState(true);

  const [selectedDate, setSelectedDate] = useState(null);

  const navigate = useNavigate();

  const { logout } = useAdminAuth();

  const toast = useToast();

  const confirm = useConfirm();

  useEffect(() => {
    async function loadInitialSlots() {
      try {
        setLoadingSlots(true);
        const data = await getAdminSlots();

        setSlots(data);

        if (data.length > 0) {
          setSelectedDate((data.find((slot) => !isSlotPast(slot, Date.now())) || data[0]).slot_date);
        }
      } catch (error) {
        console.error(error);

        toast.error("Failed to load slots");
      } finally {
        setLoadingSlots(false);
      }
    }

    loadInitialSlots();
  }, [toast]);

  async function loadSlots() {
    try {
      setLoadingSlots(true);

      const data = await getAdminSlots();

      setSlots(data);

      if (data.length > 0 && !selectedDate) {
        setSelectedDate((data.find((slot) => !isSlotPast(slot, Date.now())) || data[0]).slot_date);
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

      toast.error("That time is no longer available to delete. The schedule was refreshed.");
      await loadSlots();
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

  const filteredSlots = useMemo(() => {
    let result = slots.filter((slot) => !isSlotPast(slot, now));

    if (selectedDate) {
      result = result.filter((slot) => slot.slot_date === selectedDate);
    }

    return result.sort((a, b) => a.slot_time.localeCompare(b.slot_time));
  }, [slots, selectedDate, now]);

  const availableDates = useMemo(() => {
    return [...new Set(slots.filter((slot) => !isSlotPast(slot, now)).map((slot) => slot.slot_date))];
  }, [slots, now]);

  return (
    <div className="flex flex-col gap-10">
      <AdminHeader
        title="Availability"
        subtitle="Appointment times"
        onLogout={handleLogout}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-[#202620]/60">Timezone: {timezone || "loading…"}</p>
        <Link to="/admin/bookings" className="admin-button-secondary min-h-10 px-4 py-2 text-xs uppercase tracking-[0.14em]">
          View bookings
        </Link>
      </div>
      <SlotGenerator onGenerate={handleGenerateSlots} loading={generating} />

      <section className="flex flex-col gap-8">
        <div>
          <div>
            <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#202620]/45">Upcoming times</p>
            <h2 className="text-3xl text-[#202620]">Choose a day</h2>
          </div>
        </div>

        {/* Date Selector */}
        <AdminCard className="p-5">
          <div className="mb-5">
            <p className="mb-2 text-xs uppercase tracking-[0.24em] text-[#202620]/40">Schedule navigation</p>
            <h3 className="text-2xl text-[#202620]">Select day</h3>
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
                    {format(new Date(`${date}T12:00:00`), "EEE")}
                  </p>

                  <p className="text-lg text-[#202620]">
                    {format(new Date(`${date}T12:00:00`), "MMM d")}
                  </p>
                </button>
              );
            })}
          </div>
        </AdminCard>

        {/* Schedule */}
        {loadingSlots ? (
          <AdminCard className="p-10">
            <p className="text-[#202620]/60">Loading schedule...</p>
          </AdminCard>
        ) : filteredSlots.length === 0 ? (
          <AdminCard className="p-10">
            <p className="text-[#202620]/60">No availability has been added for this date.</p>
          </AdminCard>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#202620]/45">
                Daily Schedule
              </p>

              <h2 className="text-3xl text-[#202620]">
                {format(new Date(`${selectedDate}T12:00:00`), "EEEE, MMMM d")}
              </h2>
            </div>

            <div className="flex flex-col gap-4">
              {filteredSlots.map((slot) => {
                return (
                  <SlotItem
                    key={slot.id}
                    now={now}
                    slot={{
                      ...slot,
                      bookings: slot.bookings || [],
                    }}
                    onDelete={handleDeleteSlot}
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
