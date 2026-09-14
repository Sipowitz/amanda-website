import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

import React from "react";
import { act, create } from "react-test-renderer";
import { rolldown } from "rolldown";

const require = createRequire(import.meta.url);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const bundle = await rolldown({
  input: new URL("../src/components/Navbar.jsx", import.meta.url).pathname,
  platform: "node",
  plugins: [{
    name: "public-navigation-test-boundaries",
    resolveId(source) {
      if (source === "react-router-dom") return "\0router";
      if (source === "framer-motion") return "\0motion";
      if (source === "react" || source.startsWith("react/")) {
        return { id: pathToFileURL(require.resolve(source)).href, external: true };
      }
    },
    load(id) {
      if (id === "\0router") return `
        import React from "react";
        export const Link = ({to, ...props}) => React.createElement("a", {...props, href: to});
        export const useLocation = () => globalThis.publicNavigationTest.location;
        export const useNavigate = () => globalThis.publicNavigationTest.navigate;
      `;
      if (id === "\0motion") return `
        import React from "react";
        const element = (tag) => ({children, ...props}) => React.createElement(tag, props, children);
        export const motion = {span: element("span"), div: element("div")};
      `;
    },
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
const { default: Navbar } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function label(node) {
  return (node.children || []).filter((child) => typeof child === "string").join("");
}

async function mount(t, pathname = "/services") {
  const previousDocument = globalThis.document;
  globalThis.document = { body: { style: {} } };
  globalThis.publicNavigationTest = {
    calls: [],
    location: { pathname },
    navigate: (...args) => globalThis.publicNavigationTest.calls.push(args),
  };
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(Navbar));
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    globalThis.document = previousDocument;
  });
  return renderer.root;
}

function servicesLinks(root) {
  return root.findAllByType("a").filter((link) => label(link) === "Services");
}

function event() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

test("public navigation shows Services, About, Contact in that order on desktop and mobile", async (t) => {
  const root = await mount(t);
  const links = root.findAllByType("a");
  assert.deepEqual(links.slice(0, 3).map(label), ["Services", "About", "Contact"]);
  assert.deepEqual(links.slice(3).map(label), ["Services", "About", "Contact"]);
  assert.equal(links.some((link) => label(link) === "Home"), false);
  assert.equal(links.filter((link) => label(link) === "Services").every((link) => link.props.href === "/services"), true);
});

test("the root route redirects to Services while retaining the Home source", async () => {
  const [app, home] = await Promise.all([read("src/App.jsx"), read("src/pages/Home.jsx")]);
  assert.match(app, /<Route path="\/" element=\{<Navigate to="\/services" replace \/>\} \/>/);
  assert.doesNotMatch(app, /<Route path="\/" element=\{<Home \/>\} \/>/);
  assert.ok(home.length > 0);
});

test("normal Services activation preserves its normal link behavior", async (t) => {
  const root = await mount(t);
  const click = event();
  await act(async () => servicesLinks(root)[0].props.onClick(click));
  assert.equal(click.prevented, false);
  assert.deepEqual(globalThis.publicNavigationTest.calls, []);
});

test("only three rapid Services activations enter admin", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = await mount(t);
  for (let count = 1; count <= 2; count += 1) {
    const click = event();
    await act(async () => servicesLinks(root)[0].props.onClick(click));
    assert.equal(click.prevented, false);
    assert.deepEqual(globalThis.publicNavigationTest.calls, []);
  }
  const third = event();
  await act(async () => servicesLinks(root)[0].props.onClick(third));
  assert.equal(third.prevented, true);
  assert.deepEqual(globalThis.publicNavigationTest.calls, [["/admin"]]);
});

test("Services activations outside the 1.2-second window do not enter admin", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = await mount(t);
  await act(async () => servicesLinks(root)[0].props.onClick(event()));
  t.mock.timers.tick(1201);
  await act(async () => servicesLinks(root)[0].props.onClick(event()));
  await act(async () => servicesLinks(root)[0].props.onClick(event()));
  assert.deepEqual(globalThis.publicNavigationTest.calls, []);
});

test("mobile Services keeps normal navigation and closes the menu", async (t) => {
  const root = await mount(t);
  const menuButton = root.findByProps({ "aria-label": "Toggle Menu" });
  await act(async () => menuButton.props.onClick());
  const mobileServices = servicesLinks(root)[1];
  const click = event();
  await act(async () => mobileServices.props.onClick(click));
  assert.equal(click.prevented, false);
  assert.deepEqual(globalThis.publicNavigationTest.calls, []);
});

test("three rapid mobile Services activations enter admin", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = await mount(t);
  const menuButton = root.findByProps({ "aria-label": "Toggle Menu" });
  for (let count = 1; count <= 3; count += 1) {
    await act(async () => menuButton.props.onClick());
    const click = event();
    await act(async () => servicesLinks(root)[1].props.onClick(click));
    assert.equal(click.prevented, count === 3);
  }
  assert.deepEqual(globalThis.publicNavigationTest.calls, [["/admin"]]);
});

test("hamburger interactions only open and close the mobile menu", async (t) => {
  const root = await mount(t);
  const menuButton = root.findByProps({ "aria-label": "Toggle Menu" });
  for (let count = 0; count < 4; count += 1) {
    await act(async () => menuButton.props.onClick());
  }
  assert.deepEqual(globalThis.publicNavigationTest.calls, []);
});

test("About and Contact remain ordinary links and Services is active on Services routes", async (t) => {
  const root = await mount(t, "/services/private-readings/book");
  const links = root.findAllByType("a");
  const [services, about, contact] = links;
  assert.match(services.props.className, /text-\[#f1e8ca\]/);
  assert.match(about.props.className, /text-\[#f1e8ca\]\/78/);
  assert.match(contact.props.className, /text-\[#f1e8ca\]\/78/);
  assert.equal(about.props.onClick, undefined);
  assert.equal(contact.props.onClick, undefined);
});
