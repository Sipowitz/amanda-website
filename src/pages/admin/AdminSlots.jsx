import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import SlotGenerator from "../../components/admin/SlotGenerator";
import SlotList from "../../components/admin/SlotList";
import AdminHeader from "../../components/admin/AdminHeader";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

import {
  deleteBooking,
  deleteSlot,
  generateSlots,
  getAdminSlots,
} from "../../services/adminService";

export default function AdminSlots() {
  const [slots, setSlots] = useState([]);

  const [generating, setGenerating] = useState(false);

  const [loadingSlots, setLoadingSlots] = useState(true);

  const [viewMode, setViewMode] = useState("all");

  const navigate = useNavigate();

  const { logout } = useAdminAuth();

  useEffect(() => {
    loadSlots();
  }, []);

  async function loadSlots() {
    try {
      setLoadingSlots(true);

      const data = await getAdminSlots();

      setSlots(data);
    } catch (error) {
      console.error(error);

      alert("Failed to load slots");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function handleGenerateSlots(data) {
    try {
      setGenerating(true);

      await generateSlots(data);

      await loadSlots();

      alert("Slots generated successfully");
    } catch (error) {
      console.error(error);

      alert("Failed to generate slots");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteSlot(slotId) {
    const confirmed = confirm("Delete this slot?");

    if (!confirmed) {
      return;
    }

    try {
      await deleteSlot(slotId);

      setSlots((prev) => prev.filter((slot) => slot.id !== slotId));
    } catch (error) {
      console.error(error);

      alert("Failed to delete slot");
    }
  }

  async function handleDeleteBooking(bookingId, slotId) {
    const confirmed = confirm("Cancel this booking?");

    if (!confirmed) {
      return;
    }

    try {
      await deleteBooking(bookingId, slotId);

      await loadSlots();
    } catch (error) {
      console.error(error);

      alert("Failed to cancel booking");
    }
  }

  async function handleLogout() {
    try {
      await logout();

      navigate("/");
    } catch (error) {
      console.error(error);

      alert("Failed to logout");
    }
  }

  const filteredSlots = useMemo(() => {
    if (viewMode === "bookings") {
      return slots.filter((slot) => slot.bookings && slot.bookings.length > 0);
    }

    return slots;
  }, [slots, viewMode]);

  return (
    <div className="flex flex-col gap-16">
      <AdminHeader
        title="Slot Management"
        subtitle="Booking Management"
        onLogout={handleLogout}
      />

      <SlotGenerator onGenerate={handleGenerateSlots} loading={generating} />

      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
              Upcoming Availability
            </p>

            <h2 className="text-4xl text-[#f1e8ca]">Schedule</h2>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] p-1">
            <button
              onClick={() => setViewMode("all")}
              className={`rounded-full px-5 py-2 text-xs uppercase tracking-[0.18em] transition ${
                viewMode === "all"
                  ? "bg-[#f1e8ca]/12 text-[#f1e8ca]"
                  : "text-[#f1e8ca]/45 hover:text-[#f1e8ca]"
              }`}
            >
              All Slots
            </button>

            <button
              onClick={() => setViewMode("bookings")}
              className={`rounded-full px-5 py-2 text-xs uppercase tracking-[0.18em] transition ${
                viewMode === "bookings"
                  ? "bg-[#f1e8ca]/12 text-[#f1e8ca]"
                  : "text-[#f1e8ca]/45 hover:text-[#f1e8ca]"
              }`}
            >
              Bookings Only
            </button>
          </div>
        </div>

        {loadingSlots ? (
          <div className="rounded-[2rem] border border-white/10 bg-black/10 p-10 backdrop-blur-xl">
            <p className="text-[#f1e8ca]/60">Loading schedule...</p>
          </div>
        ) : (
          <SlotList
            slots={filteredSlots}
            onDelete={handleDeleteSlot}
            onDeleteBooking={handleDeleteBooking}
          />
        )}
      </section>
    </div>
  );
}
