import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260908110000_self_heal_timed_checkout_markers.sql", import.meta.url), "utf8");

test("stale checkout migration preserves the protected cleanup boundary", () => {
  assert.match(sql, /create table if not exists private\.timed_checkout_cleanup_tombstone/);
  assert.match(sql, /capability_hash bytea not null/);
  assert.match(sql, /retained_until timestamptz not null/);
  assert.match(sql, /deadline \+ interval '14 days'/);
  assert.match(sql, /create or replace function public\.cleanup_timed_checkout\(\s*p_booking_id uuid,\s*p_attempt_id uuid,\s*p_cleanup_capability text/s);
  assert.match(sql, /errcode = 'P0002'/);
  assert.match(sql, /capability\.attempt_id is null/);
  assert.match(sql, /tombstone\.attempt_id is not null/);
  assert.match(sql, /capability_hash = extensions\.digest\(p_cleanup_capability, 'sha256'\)/);
  assert.match(sql, /capability\.capability_hash is distinct from extensions\.digest\(p_cleanup_capability, 'sha256'\)/);
  assert.match(sql, /attempt\.submitted_at is not null/);
  assert.match(sql, /grant execute on function public\.cleanup_timed_checkout\(uuid, uuid, text\)\s+to service_role/s);
  assert.doesNotMatch(sql, /grant execute on function[^\n]+\bto (anon|authenticated|public)\b/i);
});
