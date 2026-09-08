import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [layout, indexCss] = await Promise.all([
  read("src/layouts/MainLayout.jsx"),
  read("src/index.css"),
]);

test("public layout uses a restrained continuous atmosphere", () => {
  assert.match(layout, /bg-\[#9ebd9e\]/);
  assert.match(layout, /radial-gradient\(ellipse_125%_85%/);
  assert.match(layout, /radial-gradient\(ellipse_110%_120%/);
  assert.match(layout, /pointer-events-none absolute inset-0/);
  assert.match(layout, /opacity-\[0\.03\]/);
  assert.doesNotMatch(layout, /h-\[340px\].*blur-\[40px\]/);
});

test("public atmosphere remains isolated from admin styling", () => {
  assert.doesNotMatch(layout, /admin-(input|button|select|card)/i);
  assert.match(indexCss, /background: #9ebd9e/);
});
