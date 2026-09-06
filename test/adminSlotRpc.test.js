import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { rolldown } from "rolldown";

const bundle = await rolldown({
  input: new URL("../src/services/adminService.js", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "admin-supabase-boundary",
    resolveId(source) { if (source === "../lib/supabase") return "\0supabase"; },
    load(id) {
      if (id === "\0supabase") return "export const supabase = { rpc: (...args) => globalThis.adminSlotRpc(...args) };";
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
const { generateSlots, deleteSlot } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);

test("slot generation sends only dates and canonical times through the guarded RPC", async () => {
  let call;
  globalThis.adminSlotRpc = async (...args) => { call = args; return { error: null }; };
  await generateSlots({ startDate: "2030-01-01", endDate: "2030-01-01", selectedDays: [0,1,2,3,4,5,6],
    startTime: "00:00", endTime: "01:00", interval: 30 });
  assert.equal(call[0], "create_availability_slots");
  assert.deepEqual(call[1], { p_slots: [
    { slot_date: "2030-01-01", slot_time: "00:00" },
    { slot_date: "2030-01-01", slot_time: "00:30" },
  ] });
});

test("slot deletion passes only the selected ID and propagates protected-history refusal", async () => {
  const refusal = new Error("Slots with booking history cannot be deleted.");
  globalThis.adminSlotRpc = async (name, args) => {
    assert.equal(name, "delete_availability_slot");
    assert.deepEqual(args, { p_slot_id: "test-slot" });
    return { error: refusal };
  };
  await assert.rejects(deleteSlot("test-slot"), (error) => error === refusal);
});
