import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import SlotGenerator from "../components/admin/SlotGenerator";
import SlotList from "../components/admin/SlotList";

import {
  deleteBooking,
  deleteSlot,
  generateSlots,
  getAdminSlots,
} from "../services/adminService";

export default function Admin() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(null);

  const [slots, setSlots] = useState([]);

  const [generating, setGenerating] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    const storedAuth = sessionStorage.getItem("admin-auth");

    setAuthenticated(storedAuth === "true");
  }, []);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    loadSlots();
  }, [authenticated]);

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

  function handleLogin(event) {
    event.preventDefault();

    if (password === import.meta.env.VITE_ADMIN_PASSWORD) {
      sessionStorage.setItem("admin-auth", "true");

      setAuthenticated(true);
    } else {
      alert("Incorrect password");
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("admin-auth");

    navigate("/");
  }

  if (authenticated === null) {
    return null;
  }

  if (!authenticated) {
    return (
      <section className="px-6 py-24 text-[#f1e8ca]">
        <div className="mx-auto max-w-xl">
          <div className="rounded-[2.5rem] border border-white/10 bg-black/10 p-10 backdrop-blur-xl">
            <p className="mb-4 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
              Admin Access
            </p>

            <h1 className="mb-10 text-5xl">Enter Password</h1>

            <form onSubmit={handleLogin} className="flex flex-col gap-6">
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-5 text-[#f1e8ca] outline-none transition focus:border-[#f1e8ca]/35"
              />

              <button
                type="submit"
                className="rounded-2xl border border-[#f1e8ca]/15 bg-[#f1e8ca]/10 px-8 py-5 text-[#f1e8ca] transition duration-300 hover:bg-[#f1e8ca]/16"
              >
                Enter Admin
              </button>
            </form>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 py-24 text-[#f1e8ca]">
      <div className="mx-auto flex max-w-6xl flex-col gap-16">
        <div className="flex items-center justify-between">
          <div>
            <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
              Booking Management
            </p>

            <h1 className="text-5xl">Admin Dashboard</h1>
          </div>

          <button
            onClick={handleLogout}
            className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm uppercase tracking-[0.18em] text-[#f1e8ca]/70 transition hover:border-[#f1e8ca]/25 hover:text-[#f1e8ca]"
          >
            Logout
          </button>
        </div>

        <SlotGenerator onGenerate={handleGenerateSlots} loading={generating} />

        <section className="flex flex-col gap-8">
          <div>
            <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
              Upcoming Availability
            </p>

            <h2 className="text-4xl text-[#f1e8ca]">Schedule</h2>
          </div>

          {loadingSlots ? (
            <div className="rounded-[2rem] border border-white/10 bg-black/10 p-10 backdrop-blur-xl">
              <p className="text-[#f1e8ca]/60">Loading schedule...</p>
            </div>
          ) : (
            <SlotList
              slots={slots}
              onDelete={handleDeleteSlot}
              onDeleteBooking={handleDeleteBooking}
            />
          )}
        </section>
      </div>
    </section>
  );
}
