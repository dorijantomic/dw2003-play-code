// The EFFECTS page of OPTIONS (web/options-model.js): six categories, only the "in" keys of web/ship-list.js, each its own
// on/off row written through the same store as F2, Detail still honest, Sound rows not fighting any other row.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    DETAIL_KEYS, EFFECT_CATEGORIES, LIST_ROWS, PAGES, applyDetail, buildRows, createOptionsModel, detailOf,
} from "../web/options-model.js";
import { SHIP, SHIP_IN } from "../web/ship-list.js";

const SRC = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
const BLOCK = SRC.match(/export const FX_GROUPS = \[([\s\S]*?)\n\];/)[1];
/** { Terrain: [keys...], ... } read from the source of FX_GROUPS (ambience.js needs a browser to import). */
const GROUPS = {};
for (const line of BLOCK.split("\n")) {
    const g = line.match(/^\s*\["(\w+)", \[/);
    if (g) GROUPS[g[1]] = [...line.matchAll(/\["(\w+)", "[^"]*"\]/g)].map((m) => m[1]);
}
const FILTERS = [["off", "Off"]];
const defaults = () => {
    const fx = { weatherMode: "auto", quality: "high", todMode: "auto", spriteFilter: "off", battleSpeed: 2, encounterDialMode: "normal", musicVolume: 1, soundVolume: 1 };
    for (const k of SHIP_IN) fx[k] = true;
    for (const k of DETAIL_KEYS) fx[k] = SHIP[k] !== "out";
    return fx;
};
const memoryStore = (fx = defaults()) => ({ fx, get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) });
const OPEN = (m, id) => { while (m.page() < PAGES.length - 1) m.switchPage(1); const i = m.view().findIndex((r) => r.id === id); while (m.row() < i) m.moveRow(1); m.select(); };

test("the EFFECTS page lists Weather, Terrain, Atmosphere, Life, Ground, Sound, in that order, as the last page", () => {
    assert.equal(PAGES[PAGES.length - 1].label, "EFFECTS");
    assert.deepEqual(EFFECT_CATEGORIES.map((c) => c.label), ["Weather", "Terrain", "Atmosphere", "Life", "Ground", "Sound"]);
    const m = createOptionsModel(memoryStore(), FILTERS);
    while (m.page() < PAGES.length - 1) m.switchPage(1);
    assert.deepEqual(m.view().map((r) => r.label), ["Weather", "Terrain", "Atmosphere", "Life", "Ground", "Sound"]);
});

test("each category holds exactly the 'in' keys of its F2 group, and no out or auto key appears anywhere", () => {
    for (const c of EFFECT_CATEGORIES) {
        const want = GROUPS[c.label].filter((k) => SHIP[k] === "in");
        assert.deepEqual(c.items.map((i) => i.key), want, c.label);
    }
    const all = EFFECT_CATEGORIES.flatMap((c) => c.items.map((i) => i.key));
    for (const k of all) assert.equal(SHIP[k], "in", k);
    for (const k of ["devils", "villagers", "hd2d", "battleatmos", "uisharp", "widefield"]) assert.ok(!all.includes(k), k);
    assert.equal(new Set(all).size, all.length, "no key twice");
    assert.equal(all.length, 37);
});

test("no row shows the words 'seam fixes', and every label is plain letters", () => {
    for (const c of EFFECT_CATEGORIES) for (const i of c.items) {
        assert.ok(!/seam/i.test(i.label) && !/seam/i.test(i.help), i.key);
        assert.match(i.label, /^[A-Za-z0-9 ,]+$/, i.key);
    }
});

test("choosing a category opens its switches then Back; Back closes it; the page does not change", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    OPEN(m, "cat:life");
    assert.equal(m.inCategory(), true);
    assert.deepEqual(m.view().map((r) => r.label), ["Falling leaves", "Fireflies", "Back"]);
    assert.equal(m.row(), 0);
    m.moveRow(1); m.moveRow(1);
    assert.equal(m.view()[m.row()].label, "Back");
    assert.equal(m.select(), "move");
    assert.equal(m.inCategory(), false);
    assert.equal(m.page(), PAGES.length - 1);
    assert.equal(m.view()[m.row()].id, "cat:life", "the cursor is back on the category it left");
});

test("the cancel button leaves the category first, and only then the screen (back() says which)", () => {
    const m = createOptionsModel(memoryStore(), FILTERS);
    assert.equal(m.back(), false, "nothing open: the screen may close");
    OPEN(m, "cat:sound");
    assert.equal(m.back(), true);
    assert.equal(m.inCategory(), false);
    assert.equal(m.back(), false);
});

test("a switch writes its own key through the store, by arrows or confirm", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    OPEN(m, "cat:weather");
    const written = [];
    const orig = store.setMany;
    store.setMany = (o) => { written.push({ ...o }); return orig(o); };
    assert.equal(m.view()[0].label, "Rain");
    assert.equal(m.change(-1), "change");
    assert.deepEqual(written, [{ rain: false }]);
    assert.equal(store.fx.rain, false);
    assert.equal(m.view()[0].value, "Off");
    assert.equal(m.select(), "change");
    assert.equal(store.fx.rain, true);
    assert.equal(m.change(1), null, "already on");
});

test("the category row shows All, Some or None from its switches", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    while (m.page() < PAGES.length - 1) m.switchPage(1);
    const life = () => m.view().find((r) => r.id === "cat:life").value;
    assert.equal(life(), "All");
    store.fx.leaves = false; assert.equal(life(), "Some");
    store.fx.fireflies = false; assert.equal(life(), "None");
});

test("the longest category scrolls inside the 9-row window and the cursor never leaves the visible rows", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    OPEN(m, "cat:atmosphere");
    const total = EFFECT_CATEGORIES.find((c) => c.id === "atmosphere").items.length + 1;
    assert.ok(total > LIST_ROWS, "needs scrolling");
    assert.equal(m.view().length, LIST_ROWS);
    assert.deepEqual(m.scroll(), { above: false, below: true });
    for (let i = 0; i < total - 1; i++) { assert.equal(m.moveRow(1), "move"); assert.ok(m.row() >= 0 && m.row() < LIST_ROWS); }
    assert.equal(m.moveRow(1), null, "no wrap");
    assert.equal(m.view()[m.row()].label, "Back");
    assert.deepEqual(m.scroll(), { above: true, below: false });
    for (let i = 0; i < total - 1; i++) m.moveRow(-1);
    assert.equal(m.view()[m.row()].label, "Day and night");
});

test("every category fits or scrolls; none is longer than the whole list could show", () => {
    for (const c of EFFECT_CATEGORIES) assert.ok(c.items.length >= 1, c.id);
    const m = createOptionsModel(memoryStore(), FILTERS);
    for (const c of EFFECT_CATEGORIES) {
        OPEN(m, `cat:${c.id}`);
        let seen = new Set();
        for (let i = 0; i <= c.items.length; i++) { for (const r of m.view()) seen.add(r.label); m.moveRow(1); }
        assert.equal(seen.size, c.items.length + 1, c.id);
        m.back();
    }
});

test("Detail Original switches all 35 off; the footprints, puddles, weather and every other Effects row then read Off", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1);
    assert.equal(m.view()[0].id, "detail");
    while (m.change(-1)) { /* down to Original */ }
    assert.equal(detailOf(store), "original");
    assert.ok(DETAIL_KEYS.every((k) => store.fx[k] === false));
    for (const c of EFFECT_CATEGORIES.filter((c) => c.id !== "sound")) {
        OPEN(m, `cat:${c.id}`);
        assert.ok(m.view().filter((r) => r.id.startsWith("fx:")).every((r) => r.value === "Off"), c.id);
        m.back();
    }
    OPEN(m, "cat:sound");
    assert.ok(m.view().filter((r) => r.id.startsWith("fx:")).every((r) => r.value === "On"), "Detail leaves the sound keys alone");
});

test("one change in an Effects row makes Detail read Custom; Detail then still works from Custom", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    assert.equal(detailOf(store), "high");
    OPEN(m, "cat:ground");
    const puddles = m.view().findIndex((r) => r.id === "fx:puddles");
    while (m.row() < puddles) m.moveRow(1);
    m.change(-1);
    assert.equal(detailOf(store), "custom");
    m.back();
    while (m.page() > 1) m.switchPage(-1);
    const d = m.view()[0];
    assert.deepEqual([d.id, d.value, d.custom], ["detail", "Custom", true]);
    m.change(1);
    assert.equal(detailOf(store), "original");
});

test("Detail High after Original turns the Effects rows back on", () => {
    const store = memoryStore();
    applyDetail(store, "original");
    applyDetail(store, "high");
    const m = createOptionsModel(store, FILTERS);
    OPEN(m, "cat:weather");
    assert.ok(m.view().filter((r) => r.id.startsWith("fx:")).every((r) => r.value === "On"));
});

test("Sound: four own rows write exactly their own key, no other row writes a sound key, and Detail never does", () => {
    const store = memoryStore();
    const sound = EFFECT_CATEGORIES.find((c) => c.id === "sound");
    assert.deepEqual(sound.items.map((i) => i.key), ["sound", "ambience", "musicfx", "footsteps"]);
    const rows = buildRows(FILTERS);
    assert.ok(!("placeSounds" in rows), "the old combined row is folded into the Sound category");
    const m = createOptionsModel(store, FILTERS);
    OPEN(m, "cat:sound");
    m.moveRow(2); m.change(-1);
    assert.deepEqual(["sound", "ambience", "musicfx", "footsteps"].map((k) => store.fx[k]), [true, true, false, true]);
    for (const k of DETAIL_KEYS) assert.ok(!["sound", "ambience", "musicfx", "footsteps"].includes(k));
    const keysWritten = (row) => { const seen = []; const s = { get: () => true, setMany: (o) => seen.push(...Object.keys(o)) }; row.write(s, 0); return seen; };
    for (const r of Object.values(rows)) for (const k of keysWritten(r)) assert.ok(!["sound", "ambience", "musicfx", "footsteps"].includes(k), `${r.id} writes ${k}`);
});

test("OPTIONS no longer carries rows whose keys are all auto or out", () => {
    const rows = buildRows(FILTERS);
    for (const id of ["wide", "hd2d", "toon", "extra:mount", "extra:boss", "extra:giant", "extra:battleideas", "extra:battlemotion", "extra:camera", "extra:villagers", "extra:online"]) assert.ok(!(id in rows), id);
    assert.ok("extra:quests" in rows && "battleSpeed" in rows && "randomFights" in rows && "musicVolume" in rows && "soundVolume" in rows);
    const onPages = PAGES.flatMap((p) => p.rows);
    for (const id of onPages) assert.ok(id in rows, id);
});

test("page changes close an open category", () => {
    const m = createOptionsModel(memoryStore(), FILTERS);
    OPEN(m, "cat:terrain");
    m.switchPage(-1);
    assert.equal(m.inCategory(), false);
    assert.equal(m.page(), PAGES.length - 2);
});
