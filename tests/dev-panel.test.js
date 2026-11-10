// The F2 page (web/dev-panel.js) and how web/ambience.js wires it: lazy build, tabs, search, filter, Open buttons,
// Controls kept, All on / All off, keys, and nothing running while it is closed. No browser: a tiny fake element.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDevView, DEV_PANEL_CSS } from "../web/dev-panel.js";
import { DEV_OPEN, DEV_ROWS } from "../web/dev-panel-model.js";

const rd = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
const AMB = rd("ambience.js"), DEV = rd("dev-panel.js");

function fakeEl() {
    const l = {};
    return { innerHTML: "", scrollTop: 0, value: "", l, classList: { toggle() {} }, setAttribute() {},
        addEventListener(t, f) { l[t] = f; }, querySelector: () => null, querySelectorAll: () => [] };
}
function mount(fx = {}, extra = {}) {
    const panel = fakeEl(), main = fakeEl(), tabs = fakeEl(), search = fakeEl();
    panel.querySelector = (s) => (s === ".dp-main" ? main : s === ".dp-tabs" ? tabs : s === "[data-dp-search]" ? search : null);
    let first = 0;
    const view = createDevView(panel, { fx, spriteFilters: [["off", "Off"]], dialMode: () => "normal", onFirstOpen: () => { first++; }, ...extra });
    const click = (map) => panel.l.click({ target: { closest: (s) => map[s] || null } });
    return { panel, main, tabs, search, view, click, firstCount: () => first };
}
const keysIn = (html) => [...html.matchAll(/data-fx="(\w+)"/g)].map((m) => m[1]);

test("nothing is built until the first open (a closed page costs nothing)", () => {
    const m = mount();
    assert.equal(m.panel.innerHTML, "");
    assert.equal(m.view.isBuilt(), false);
    m.view.sync(); m.view.setNa(new Set(["rain"]));       // safe while closed
    assert.equal(m.panel.innerHTML, "");
    assert.equal(m.firstCount(), 0);
    m.view.show();
    assert.equal(m.view.isBuilt(), true);
    assert.equal(m.firstCount(), 1);
    m.view.show();
    assert.equal(m.firstCount(), 1, "the first-open hook runs once");
});

test("opening shows the World tab: 43 rows, each with a switch, a name, a line and a badge", () => {
    const m = mount(); m.view.show();
    assert.equal(keysIn(m.main.innerHTML).length, 43);
    for (const w of ["Terrain", "Weather", "Atmosphere", "Life", "Ground", "Sound", "Screen", "Menus"]) assert.ok(m.main.innerHTML.includes(`>${w}</h4>`), w);
    assert.equal((m.main.innerHTML.match(/class="dr-b dr-b-(in|auto|out)"/g) || []).length, 43);
    assert.match(m.panel.innerHTML, /data-dp-tab="info"[^>]*>Info pages/);
    for (const t of ["world", "quests", "battle", "online", "info", "test", "controls"]) assert.ok(m.panel.innerHTML.includes(`data-dp-tab="${t}"`), t);
});

test("a tab click shows only that tab; Online has four rows and no Open button", () => {
    const m = mount(); m.view.show();
    m.click({ "[data-dp-tab]": { dataset: { dpTab: "online" }, blur() {} } });
    assert.deepEqual(keysIn(m.main.innerHTML), ["mpbubbles", "mpcredit", "serverchamp", "chatqueue"]);
    assert.ok(!m.main.innerHTML.includes("data-act=\"open:"));
});

test("page-type rows carry an Open button; the old long stack of Open rows is gone", () => {
    const m = mount(); m.view.show();
    m.click({ "[data-dp-tab]": { dataset: { dpTab: "info" }, blur() {} } });
    const opens = [...m.main.innerHTML.matchAll(/data-act="open:(\w+)"/g)].map((x) => x[1]);
    assert.deepEqual(opens.sort(), Object.keys(DEV_OPEN).filter((k) => DEV_ROWS.find((r) => r.key === k).tab === "info").sort());
    assert.ok(!/Open the /.test(AMB) && !/fx-open-/.test(AMB));
});

test("typing in the search box searches every tab; the filter narrows by In / Auto / Out", () => {
    const m = mount({}, { shipOf: (k) => (k === "omen" ? "out" : "in") }); m.view.show();
    m.search.value = "wild fight"; m.search.l.input();
    const keys = keysIn(m.main.innerHTML);
    assert.ok(keys.includes("omen") && keys.includes("practice2v2"));
    assert.match(m.main.innerHTML, /found across all tabs/);
    m.click({ "[data-dp-filter]": { dataset: { dpFilter: "out" }, blur() {} } });
    assert.deepEqual(keysIn(m.main.innerHTML), ["omen"]);
    m.search.value = "zzzzzz"; m.search.l.input();
    assert.match(m.main.innerHTML, /No switch matches that/);
    m.search.value = ""; m.search.l.input();
    assert.equal(keysIn(m.main.innerHTML).filter((k) => k !== "omen").length, 0, "filter Out still applies to the World tab");
});

test("Controls keeps every old control", () => {
    const m = mount(); m.view.show();
    m.click({ "[data-dp-tab]": { dataset: { dpTab: "controls" }, blur() {} } });
    const h = m.main.innerHTML;
    for (const s of ["data-preset", "data-mode", "data-tod", "data-quality", "data-spritefilter", "data-slider=\"lightGain\"", "data-slider=\"hd2dStrength\"",
        "data-slider=\"battleSpeed\"", "data-act=\"photo\"", "data-act=\"shot\"", "data-act=\"rec\"", "data-all=\"1\"", "data-all=\"0\"",
        ...[1, 2, 3].flatMap((n) => [`data-act="save:${n}"`, `data-act="load:${n}"`])]) assert.ok(h.includes(s), s);
    assert.equal(keysIn(h).length, 0);
});

test("the encounter dial sits in its Battle row and follows its switch", () => {
    const m = mount(); m.view.show();
    m.click({ "[data-dp-tab]": { dataset: { dpTab: "battle" }, blur() {} } });
    assert.match(m.main.innerHTML, /data-show-when="encounterdial" hidden><select data-dial/);
});

test("ambience.js: All on / All off still sit behind data-all and the page is built lazily", () => {
    assert.match(AMB, /closest\("\[data-all\]"\)/);
    assert.ok(!/panel\.innerHTML\s*=/.test(AMB), "the panel starts empty; dev-panel.js builds it");
    assert.match(AMB, /if \(!panel\.hidden\) dev\.show\(\)/);
    assert.match(AMB, /if \(!panel \|\| panel\.hidden \|\| !dev \|\| !dev\.isBuilt\(\)\) return;/, "a closed page is never refreshed");
    assert.match(AMB, /if \(panel && !panel\.hidden && lastMarked !== map\.id\) markApplicable/, "no per-map work while closed");
    assert.ok(!/fetch\("\/__dw2003\/status"\)/.test(AMB.split("onFirstOpen")[0]), "the disc-status request waits for the first open");
});

test("keys: typing never reaches the game; F2 and Escape close the page", () => {
    assert.match(AMB, /panel\.addEventListener\("keydown", \(e\) => \{ if \(e\.key === "F2"\)[^}]*toggle\(\); \} e\.stopPropagation\(\); \}\);/);
    assert.match(AMB, /panel\.addEventListener\("keyup", \(e\) => e\.stopPropagation\(\)\);/);
    assert.match(AMB, /e\.key === "Escape" && !panel\.hidden\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); toggle\(\); \}\s*\}, true\)/);
});

test("installed copy: still no panel, no gear, no F2 (SHIPPED guard untouched)", () => {
    assert.match(AMB, /export function installFxPanel\(stageEl\) \{\s*\n\s*if \(panel \|\| !stageEl \|\| SHIPPED\) return;/);
});

test("the page is DOM only: no canvas, no GPU, no timers; readable and scrolling", () => {
    assert.ok(!/canvas|WebGL|getContext|requestAnimationFrame|setInterval|setTimeout/i.test(DEV));
    assert.match(DEV_PANEL_CSS, /\.dp-main \{[^}]*overflow-y:auto/);
    assert.match(DEV_PANEL_CSS, /@media \(max-width:640px\)/);
    assert.match(DEV_PANEL_CSS, /#fx-panel \{[^}]*font:14px/);
});
