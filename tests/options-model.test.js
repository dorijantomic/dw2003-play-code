// OPTIONS rows, pages and cursor (web/options-model.js): every row writes the same keys F2 does, defaults equal today's, and
// every one of the 99 effect keys has a home.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    DETAIL_KEYS, DETAIL_LEVELS, DETAIL_OFF, EFFECT_CATEGORIES, EXTRA_GROUPS, F2_ONLY_KEYS, OPTIONS_HOME, PAGES, applyDetail, buildRows, createOptionsModel, detailOf,
} from "../web/options-model.js";

const SRC = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
/** [group, key] for every pair of FX_GROUPS, read from the source (ambience.js needs a browser to import). */
const PAIRS = [...SRC.match(/export const FX_GROUPS = \[([\s\S]*?)\n\];/)[1].matchAll(/\["(\w+)", "[^"]*"\]/g)].map((m) => m[1]);
const EXPERIMENTAL = SRC.match(/const EXPERIMENTAL = \[([^\]]*)\];/)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
const BATTLE = ["ownclips", "dw2motion", "smoothanim"];

/** The settings as web/ambience.js starts them: every key on, the EXPERIMENTAL and BATTLE ones off. */
function defaults() {
    const fx = { weatherMode: "auto", quality: "high", todMode: "auto", spriteFilter: "off", battleSpeed: 2, encounterDialMode: "normal", musicVolume: 1, soundVolume: 1 };
    for (const k of PAIRS) fx[k] = !(EXPERIMENTAL.includes(k) || BATTLE.includes(k));
    return fx;
}
const memoryStore = (fx = defaults()) => ({ fx, get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) });
const FILTERS = [["off", "Off"], ["bilinear", "Smooth"], ["epx", "EPX"]];

test("the 99 effect keys are read from ambience.js, and each has exactly one home", () => {
    const keys = PAIRS.filter((k) => k !== "glossary" && k !== "options");
    assert.equal(keys.length, 99);
    assert.deepEqual(keys.filter((k) => !(k in OPTIONS_HOME)), [], "no key without a home");
    assert.deepEqual(Object.keys(OPTIONS_HOME).filter((k) => !PAIRS.includes(k)), [], "no home for a key that does not exist");
    const count = (h) => Object.values(OPTIONS_HOME).filter((v) => v === h).length;
    assert.deepEqual([count("detail"), F2_ONLY_KEYS.length], [35, 26]);
    assert.equal(Object.values(OPTIONS_HOME).filter((v) => v.startsWith("extra:")).length, 5, "only the Quests row is left of the extras");
    assert.equal(Object.values(OPTIONS_HOME).filter((v) => v.startsWith("effects:")).length, 4, "the four sound keys (the other 33 EFFECTS keys are Detail keys too)");
    assert.equal(count("f2"), 55, "26 dev keys, wide x2, hd2d, toon x2, 22 hidden extras keys, glossary, options");
});

test("every home that names a row names a real row, and every row is on a page", () => {
    const rows = buildRows(FILTERS);
    for (const home of new Set(Object.values(OPTIONS_HOME))) {
        if (home.startsWith("effects:")) assert.ok(EFFECT_CATEGORIES.some((c) => `effects:${c.id}` === home), home);
        else if (home !== "detail" && home !== "f2") assert.ok(rows[home], home);
    }
    const onPages = PAGES.flatMap((p) => p.rows).sort();
    assert.deepEqual(onPages, Object.keys(rows).sort());
    assert.deepEqual(PAGES.map((p) => p.rows.length), [3, 4, 2, 6]);
});

test("the four pages are GAME, SCREEN, SOUND, EFFECTS", () => {
    assert.deepEqual(PAGES.map((p) => p.label), ["GAME", "SCREEN", "SOUND", "EFFECTS"]);
});

test("the 35 Detail keys are the F2 groups Terrain, Weather, Atmosphere (minus hd2d and battleatmos), Life (minus villagers), Ground and uisharp", () => {
    assert.equal(new Set(DETAIL_KEYS).size, 35);
    for (const k of DETAIL_KEYS) assert.ok(PAIRS.includes(k), k);
    for (const k of DETAIL_KEYS) assert.ok(!EXPERIMENTAL.includes(k), `${k} is on today, so High = today`);
});

test("at the game's own defaults Detail reads High and every row reads today's behaviour", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    assert.equal(detailOf(store), "high");
    const shown = {};
    for (let p = 0; p < PAGES.length; p++) { for (const r of m.view()) shown[r.id] = r.value; m.switchPage(1); }
    assert.equal(shown.battleSpeed, "x1", "the switch is off, so the game runs x1");
    assert.equal(shown.randomFights, "Normal");
    assert.equal(shown.detail, "High");
    for (const gone of ["wide", "hd2d", "toon", "placeSounds"]) assert.ok(!(gone in shown), `${gone} has no row`);
    assert.equal(shown.timeOfDay, "Auto");
    assert.equal(shown.weather, "Random");
    assert.equal(shown.pixelFilter, "Off");
    assert.deepEqual([shown.musicVolume, shown.soundVolume], ["100", "100"]);
    assert.equal(shown["extra:quests"], "On", "Quests stay on, as today");
    for (const g of EXTRA_GROUPS.filter((x) => x.id !== "quests")) assert.ok(!(`extra:${g.id}` in shown), `${g.id} has no row`);
    for (const c of EFFECT_CATEGORIES) assert.equal(shown[`cat:${c.id}`], "All", c.id);
});

test("Detail Original switches all 35 off, High all on, and each level goes through detailOf and back", () => {
    const store = memoryStore();
    applyDetail(store, "original");
    assert.ok(DETAIL_KEYS.every((k) => store.fx[k] === false));
    assert.equal(store.fx.quality, "low");
    assert.equal(detailOf(store), "original");
    for (const level of DETAIL_LEVELS) { applyDetail(store, level); assert.equal(detailOf(store), level, level); }
    applyDetail(store, "high");
    assert.ok(DETAIL_KEYS.every((k) => store.fx[k] === true));
    assert.equal(store.fx.quality, "high");
});

test("Detail never touches a key outside the 35 (hd2d, widefield, quests, sound stay as they were)", () => {
    const store = memoryStore();
    Object.assign(store.fx, { hd2d: true, widefield: true, sound: false });
    const before = { ...store.fx };
    for (const level of DETAIL_LEVELS) applyDetail(store, level);
    applyDetail(store, "high");
    for (const k of Object.keys(before)) if (!DETAIL_KEYS.includes(k) && k !== "quality") assert.equal(store.fx[k], before[k], k);
});

test("Low switches off at least what Medium does, which switches off at least nothing; all inside the 35", () => {
    const low = new Set(DETAIL_OFF.low), med = new Set(DETAIL_OFF.medium);
    for (const k of med) assert.ok(low.has(k), `${k}: off in Medium so off in Low`);
    for (const k of low) assert.ok(DETAIL_KEYS.includes(k), k);
    assert.ok(low.size >= med.size && med.size < DETAIL_KEYS.length);
});

test("an F2 edit that matches no level reads Custom; right picks the first level and left the last", () => {
    const store = memoryStore();
    store.fx.rain = false;
    store.fx.quality = "medium";
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1);
    const row = m.view()[0];
    assert.deepEqual([row.id, row.value, row.custom], ["detail", "Custom", true]);
    assert.equal(m.change(1), "change");
    assert.equal(detailOf(store), "original");
    store.fx.rain = false; store.fx.quality = "medium";
    assert.equal(m.change(-1), "change");
    assert.equal(detailOf(store), "high");
});

test("battle speed: moving it turns its switch on by itself, x1 turns it off again", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    assert.equal(m.change(1), "change");
    assert.deepEqual([store.fx.battlespeed, store.fx.battleSpeed], [true, 1.5]);
    assert.equal(m.view()[0].value, "x1.5");
    m.change(1); m.change(1);
    assert.deepEqual([store.fx.battlespeed, store.fx.battleSpeed], [true, 3]);
    assert.equal(m.change(1), null, "x3 is the end; no wrap");
    for (let i = 0; i < 3; i++) m.change(-1);
    assert.deepEqual([store.fx.battlespeed, store.fx.battleSpeed], [false, 1]);
    assert.equal(m.view()[0].value, "x1");
});

test("battle speed shows the F2 slider's value when the switch is on, and x1 when it is off", () => {
    const store = memoryStore();
    Object.assign(store.fx, { battlespeed: true, battleSpeed: 2 });
    assert.equal(createOptionsModel(store, FILTERS).view()[0].value, "x2");
    store.fx.battleSpeed = 2.4;
    assert.equal(createOptionsModel(store, FILTERS).view()[0].value, "x2", "nearest position");
    store.fx.battlespeed = false;
    assert.equal(createOptionsModel(store, FILTERS).view()[0].value, "x1");
});

test("random fights: Fewer / More turn the dial on, Normal turns it off; a stored 'none' reads Never", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.moveRow(1);
    m.change(-1);
    assert.deepEqual([store.fx.encounterdial, store.fx.encounterDialMode], [true, "rare"]);
    m.change(1); m.change(1);
    assert.deepEqual([store.fx.encounterdial, store.fx.encounterDialMode], [true, "lure"]);
    m.change(-1);
    assert.deepEqual([store.fx.encounterdial, store.fx.encounterDialMode], [false, "normal"]);
    Object.assign(store.fx, { encounterdial: true, encounterDialMode: "none" });
    assert.equal(m.view()[1].value, "Never");
});

test("weather uses the F2 select's real values (auto, always, storm, clear)", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1); for (let i = 0; i < 2; i++) m.moveRow(1);
    assert.equal(m.view()[2].id, "weather");
    m.change(1); assert.equal(store.fx.weatherMode, "always");
    m.change(1); assert.equal(store.fx.weatherMode, "storm");
    m.change(1); assert.equal(store.fx.weatherMode, "clear");
    assert.equal(m.change(1), null);
});

test("the Quests row moves its whole group (the other EXTRAS rows are gone from OPTIONS)", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.moveRow(2);
    assert.equal(m.view()[2].id, "extra:quests");
    m.change(-1);
    assert.deepEqual(["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob"].map((k) => store.fx[k]), [false, false, false, false, false]);
    m.change(1);
    assert.deepEqual(["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob"].map((k) => store.fx[k]), [true, true, true, true, true]);
});

test("the Quests row reads On when any of its keys is on (F2 can set one by hand) and Off turns them all off", () => {
    const store = memoryStore();
    for (const k of ["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob"]) store.fx[k] = false;
    store.fx.questemotes = true;
    const m = createOptionsModel(store, FILTERS);
    m.moveRow(2);
    assert.equal(m.view()[2].value, "On");
    m.change(-1);
    assert.deepEqual(["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob"].map((k) => store.fx[k]), [false, false, false, false, false]);
});

test("volumes move in tenths from 100 and are stored as 0..1", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1); m.switchPage(1);
    assert.equal(m.view()[0].id, "musicVolume");
    m.change(-1); assert.equal(store.fx.musicVolume, 0.9);
    for (let i = 0; i < 12; i++) m.change(-1);
    assert.equal(store.fx.musicVolume, 0);
    assert.equal(m.view()[0].value, "0");
    assert.equal(m.change(-1), null);
    store.fx.soundVolume = undefined;
    assert.equal(m.view()[1].value, "100", "a missing value reads as today's gain");
});

test("the cursor never wraps, switching page resets the row, and the help line follows the row", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    assert.equal(m.moveRow(-1), null);
    assert.equal(m.moveRow(1), "move");
    assert.match(m.help(), /wild Digimon/);
    assert.equal(m.moveRow(1), "move");
    assert.equal(m.moveRow(1), null, "GAME has three rows");
    assert.equal(m.switchPage(-1), null);
    assert.equal(m.switchPage(1), "move");
    assert.equal(m.row(), 0);
    for (let i = 0; i < 5; i++) m.switchPage(1);
    assert.equal(m.page(), 3);
    assert.equal(m.view().length, 6);
});

test("a pixel filter list drives that row; a stored filter not in the list reads the first", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1); for (let i = 0; i < 3; i++) m.moveRow(1);
    m.change(1);
    assert.equal(store.fx.spriteFilter, "bilinear");
    store.fx.spriteFilter = "xbr";
    assert.equal(m.view()[3].value, "Off");
});

test("every help line fits the 2-line help box (280 px a line, the pause font)", async () => {
    const { wrapToLines } = await import("../web/text-fit.js");
    const { textWidth } = await import("../web/uifont.js");
    const rows = buildRows(FILTERS);
    for (const r of Object.values(rows)) {
        const lines = wrapToLines(r.help, (t) => textWidth(t), 280, 2);
        assert.ok(lines.length <= 2 && lines.join(" ") === r.help, `${r.id}: ${lines.join(" | ")}`);
        assert.match(r.help, /^[A-Za-z0-9 .,x=-]+$/, `${r.id}: letters, digits and plain punctuation only`);
    }
});
