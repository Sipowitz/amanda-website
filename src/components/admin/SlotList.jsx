import { useMemo } from "react";

import SlotGroup from "./SlotGroup";

export default function SlotList({ slots, onDelete, onDeleteBooking }) {
  const groupedSlots = useMemo(() => {
    return slots.reduce((groups, slot) => {
      const date = slot.slot_date;

      if (!groups[date]) {
        groups[date] = [];
      }

      groups[date].push(slot);

      return groups;
    }, {});
  }, [slots]);

  const dates = Object.keys(groupedSlots);

  if (dates.length === 0) {
    return (
      <div className="rounded-[2rem] border border-white/10 bg-black/10 p-10 backdrop-blur-xl">
        <p className="text-[#f1e8ca]/60">No slots created yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      {dates.map((date) => (
        <SlotGroup
          key={date}
          date={date}
          slots={groupedSlots[date]}
          onDelete={onDelete}
          onDeleteBooking={onDeleteBooking}
        />
      ))}
    </div>
  );
}
