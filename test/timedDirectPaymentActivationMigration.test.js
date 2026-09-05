import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const filename = "20260904003000_activate_timed_direct_payment.sql";
const migration = async () =>
  (await readFile(new URL(filename, migrations), "utf8"))
    .replace(/--[^\n]*/g, "")
    .trim();

test("activation follows the compatibility migration without replacing it", async () => {
  const files = (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort();
  const compatibility = files.indexOf("20260904002000_direct_payment_compatibility.sql");
  assert.ok(compatibility >= 0);
  assert.equal(files[compatibility + 1], filename);
});

test("activation locks and validates both exact services before any update", async () => {
  const sql = await migration();
  assert.match(sql, /^do \$\$[\s\S]*end;\s*\$\$;$/);
  assert.match(sql, /for expected_service in\s+select \* from \(values\s+\('private-readings', 8500\),\s+\('wheel-of-the-year', 6000\)\s+\) as expected\(slug, price_amount\)\s+order by slug\s+loop/);
  assert.match(sql, /select \* into selected_service\s+from public\.services\s+where slug = expected_service\.slug\s+for update;/);
  assert.match(sql, /if not found then\s+raise exception/);
  assert.match(sql, /if selected_service\.booking_mode is distinct from 'timed'\s+or selected_service\.payment_required is distinct from true\s+or selected_service\.price_amount is distinct from expected_service\.price_amount\s+or selected_service\.currency is distinct from 'USD'\s+or selected_service\.payment_flow is distinct from 'payment_link'\s+then\s+raise exception/);
  assert.ok(sql.indexOf("end loop;") < sql.indexOf("update public.services"));
  assert.doesNotMatch(sql, /exception\s+when/i);
});

test("activation changes only payment_flow on the two target rows and enforces row count", async () => {
  const sql = await migration();
  const updates = sql.match(/\bupdate\s+public\.[\s\S]*?;/g);
  assert.deepEqual(updates, [
    "update public.services\n  set payment_flow = 'direct_payment'\n  where slug in ('private-readings', 'wheel-of-the-year');",
  ]);
  assert.match(sql, /get diagnostics updated_count = row_count;\s+if updated_count <> 2 then\s+raise exception/);
  assert.doesNotMatch(sql, /\b(insert|delete|merge|alter|drop|create|truncate|execute|perform|call)\b/i);
  assert.doesNotMatch(sql, /bookings|snapshot|voice-memo|stripe|updated_at/i);
});
