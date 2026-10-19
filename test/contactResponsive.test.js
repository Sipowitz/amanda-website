import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contactPage = () => readFile(
  new URL("../src/pages/Contact.jsx", import.meta.url),
  "utf8",
);

test("Contact keeps its detail rows constrained and long links break on mobile", async () => {
  const source = await contactPage();

  assert.match(source, /<section className="px-4 pb-16 sm:px-6 sm:pb-24">/);
  assert.match(source, /flex min-w-0 items-start gap-3 sm:items-center sm:gap-5/);
  assert.match(source, /min-w-0 flex-1 text-base leading-7/);
  assert.match(source, /className="break-all transition-colors duration-300 hover:text-\[#fff9e5\] sm:break-words"/);
  assert.match(source, /className="mt-1 break-all text-base text-\[#f1e8ca\] sm:break-words sm:text-lg"/);
});

test("Contact detail text remains within the mobile row budget", () => {
  const mobileTextWidth = (viewportWidth) =>
    viewportWidth
    - 32 // section: px-4
    - 2 // card borders
    - 32 // card: p-4
    - 48 // fixed icon
    - 12; // row gap-3

  for (const viewportWidth of [320, 375, 390, 430]) {
    assert.ok(mobileTextWidth(viewportWidth) > 0, `${viewportWidth}px has text width`);
  }
  assert.equal(mobileTextWidth(320), 194);
});

test("Contact restores its existing desktop spacing and type scale at sm and above", async () => {
  const source = await contactPage();

  assert.match(source, /sm:p-8 md:p-10/);
  assert.match(source, /sm:text-5xl md:text-7xl/);
  assert.match(source, /sm:mb-8 sm:text-3xl/);
  assert.match(source, /sm:gap-5 sm:p-5/);
});
