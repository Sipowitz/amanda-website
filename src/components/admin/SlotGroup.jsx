import { format } from "date-fns";

import SlotItem from "./SlotItem";

export default function SlotGroup({ date, slots, onDelete, onDeleteBooking }) {
  const readableDate = format(new Date(date), "EEEE, MMMM d");

  return (
    <section className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-sm uppercase tracking-[0.25em] text-[#f1e8ca]/40">
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
  );
}
