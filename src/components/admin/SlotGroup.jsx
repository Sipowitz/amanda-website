import { format } from "date-fns";

import SlotItem from "./SlotItem";

import AdminCard from "./AdminCard";

export default function SlotGroup({ date, slots, onDelete, onDeleteBooking }) {
  const readableDate = format(new Date(date), "EEEE, MMMM d");

  return (
    <AdminCard className="p-6 sm:p-8">
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.25em] text-[#f1e8ca]/40">
            Schedule
          </p>

          <h3 className="text-3xl text-[#f1e8ca]">{readableDate}</h3>
        </div>

        <div className="grid gap-4">
          {slots.map((slot) => (
            <SlotItem
              key={slot.id}
              slot={slot}
              onDelete={onDelete}
              onDeleteBooking={onDeleteBooking}
            />
          ))}
        </div>
      </section>
    </AdminCard>
  );
}
