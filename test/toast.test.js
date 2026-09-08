import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/contexts/ToastContext.jsx", import.meta.url), "utf8");

test("toast variants use explicit high-contrast surfaces and foregrounds", () => {
  assert.match(source, /background: "bg-\[#243b2b\]\/95"/);
  assert.match(source, /background: "bg-\[#3f2928\]\/95"/);
  assert.match(source, /text-\[#fff8e7\]/);
  assert.match(source, /shadow-\[0_16px_45px_rgba\(20,35,24,0\.28\)\]/);
});

test("toast dismissal remains an accessible button", () => {
  assert.match(source, /<button[\s\S]*(?:aria-label="Dismiss notification"[\s\S]*onClick=\{\(\) => removeToast\(toast\.id\)|onClick=\{\(\) => removeToast\(toast\.id\)\}[\s\S]*aria-label="Dismiss notification")/);
});
