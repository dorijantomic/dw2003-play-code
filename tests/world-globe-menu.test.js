// The pause MAP screen's World Globe (OPTIONS > GAME > Map screen = New): which server's continent a stage is on, where your
// place lands on the globe, which screen the row opens, and the fall back to the disc's MAP page.
// Real data (web/assets) is needed for the place tests: they skip when it is not there.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { readSource } from "./helpers/source.js";

const UI_FILE = "web/assets/data/status_ui.json";
const GLOBE_DIR = "web/assets/world-globe";
const haveUi = existsSync(UI_FILE);
const haveGlobe = haveUi && existsSync(`${GLOBE_DIR}/asuka.json`) && existsSync(`${GLOBE_DIR}/amaterasu.json`);

globalThis.fetch = async (url) => ({ json: async () => JSON.parse(readFileSync(`web/${String(url)}`, "utf8")) });
if (typeof globalThis.localStorage === "undefined") {
    const mem = Object.create(null);
    globalThis.localStorage = {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
    };
}
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

const G = await import("../web/world-globe-map.js");
const { mapGlobeHere } = await import("../web/menu/pure.js");

const stateOn = (stage) => ({ manifest: { maps: [{ id: stage }] }, mapIdx: 0, keys: new Set() });
const continents = () => ["asuka", "amaterasu"].map((s) => {
    const data = G.parseGlobeMap(JSON.parse(readFileSync(`${GLOBE_DIR}/${s}.json`, "utf8")));
    return { data, band: G.continentBand(data) };
});

test("the server comes from the PS1 stage: < 0x270 Asuka, 0x270..0x2D6 Amaterasu, from 0x2D7 no map", () => {
    assert.equal(G.globeServerOfStage(0x26f), "asuka");
    assert.equal(G.globeServerOfStage(0x270), "amaterasu");
    assert.equal(G.globeServerOfStage(0x2d6), "amaterasu");
    assert.equal(G.globeServerOfStage(0x2d7), null);
    assert.equal(G.globeServerOfStage(Number.NaN), null);
});

test("s202 (Asuka City) lands on its own marker and area of the Asuka continent", { skip: !haveGlobe }, () => {
    const ui = JSON.parse(readFileSync(UI_FILE, "utf8"));
    const here = mapGlobeHere(stateOn("s202"), ui);
    assert.deepEqual([here.server, here.record, here.name], ["asuka", 20, "Asuka City"]);
    const cs = continents(), place = G.globePlace(cs, here);
    assert.ok(place, "a place");
    assert.equal(place.marker?.name, "Asuka City");
    const c = cs.find((k) => k.data.server === "asuka");
    const f = G.lonLatToFrame(c.band, place.lonLat);
    assert.ok(Math.abs(f.x - place.frame.x) < 1e-6 && Math.abs(f.y - place.frame.y) < 1e-6, "lon/lat goes back to the same frame point");
    const area = G.areaAt(c.data, f.x, f.y);
    assert.equal(area?.area, place.marker.area, "the point is inside the marker's area");
    assert.ok(Math.abs(G.angleDelta(place.lonLat.lon, G.CONTINENT_LON.asuka)) < G.MAP_LON_SPAN / 2, "on the Asuka half");
});

test("s201 (Amaterasu City) lands on the Amaterasu continent", { skip: !haveGlobe }, () => {
    const ui = JSON.parse(readFileSync(UI_FILE, "utf8"));
    const here = mapGlobeHere(stateOn("s201"), ui);
    assert.deepEqual([here.server, here.record, here.name], ["amaterasu", 20, "Amaterasu City"]);
    const cs = continents(), place = G.globePlace(cs, here);
    assert.equal(place?.server, "amaterasu");
    assert.equal(place.marker?.name, "Amaterasu City");
    const c = cs.find((k) => k.data.server === "amaterasu");
    const f = G.lonLatToFrame(c.band, place.lonLat);
    assert.equal(G.areaAt(c.data, f.x, f.y)?.area, place.marker.area);
    assert.ok(Math.abs(G.angleDelta(place.lonLat.lon, G.CONTINENT_LON.amaterasu)) < G.MAP_LON_SPAN / 2, "on the Amaterasu half");
});

test("a record missing from the globe file uses the status_ui icon centre; a stage past 0x2D6 has no place", { skip: !haveGlobe }, () => {
    const cs = continents();
    const p = G.globePlace(cs, { server: "asuka", record: 999, name: "", icon: { x: 100, y: 50 } });
    assert.deepEqual(p?.frame, { x: 100 + G.MARKER_ICON_CENTRE, y: 50 + G.MARKER_ICON_CENTRE });
    assert.equal(p.marker, null);
    assert.equal(G.globePlace(cs, { server: "asuka", record: 999, name: "", icon: null }), null);
    const ui = JSON.parse(readFileSync(UI_FILE, "utf8"));
    const far = mapGlobeHere(stateOn("s780"), ui);
    assert.equal(far.server, null, "s780 is PS1 stage 727 = 0x2D7");
    assert.equal(G.globePlace(cs, far), null);
});

test("the OPTIONS row: New opens the globe, Classic the disc's MAP page", async () => {
    const { buildRows } = await import("../web/options-model.js");
    const rows = buildRows(), fx = {};
    const store = { get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) };
    const gpu = () => true;
    assert.equal(G.mapScreenRoute(fx.mapScreen, "asuka", gpu), "classic", "no choice passed = Classic");
    rows.mapScreen.write(store, 1);
    assert.equal(G.mapScreenRoute(fx.mapScreen, "asuka", gpu), "globe");
    assert.equal(G.mapScreenRoute(fx.mapScreen, "amaterasu", gpu), "globe");
    rows.mapScreen.write(store, 0);
    assert.equal(fx.mapScreen, "classic");
    assert.equal(G.mapScreenRoute(fx.mapScreen, "asuka", gpu), "classic");
});

test("no pick: the mode decides (HD Remaster = globe, Authentic = classic)", () => {
    const gpu = () => true, fx = {};
    assert.equal(G.mapScreenRoute(G.effectiveMapScreen(fx.mapScreen, true), "asuka", gpu), "globe", "no pick + HD = globe");
    assert.equal(G.mapScreenRoute(G.effectiveMapScreen(fx.mapScreen, false), "asuka", gpu), "classic", "no pick + Authentic = classic");
    assert.equal(G.effectiveMapScreen("junk", true), "new", "an unknown saved value counts as no pick");
});

test("a saved pick wins in both modes", async () => {
    const { buildRows } = await import("../web/options-model.js");
    const gpu = () => true, fx = {};
    const store = { get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) };
    buildRows([["off", "Off"]], () => true).mapScreen.write(store, 0);
    assert.equal(fx.mapScreen, "classic", "the pick is saved");
    assert.equal(G.mapScreenRoute(G.effectiveMapScreen(fx.mapScreen, true), "asuka", gpu), "classic", "pick Classic + HD = classic");
    buildRows([["off", "Off"]], () => false).mapScreen.write(store, 1);
    assert.equal(fx.mapScreen, "new");
    assert.equal(G.mapScreenRoute(G.effectiveMapScreen(fx.mapScreen, false), "asuka", gpu), "globe", "pick New + Authentic = globe");
});

test("the OPTIONS row shows the value in force: no pick shows New in HD Remaster and Classic in Authentic; a pick shows the pick", async () => {
    const { createOptionsModel } = await import("../web/options-model.js");
    const fx = {};
    const store = { get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) };
    const shown = (hd) => createOptionsModel(store, [["off", "Off"]], () => hd).view().find((r) => r.id === "mapScreen")?.value;
    assert.equal(shown(true), "New");
    assert.equal(shown(false), "Classic");
    fx.mapScreen = "classic";
    assert.equal(shown(true), "Classic");
    fx.mapScreen = "new";
    assert.equal(shown(false), "New");
    delete fx.mapScreen;
    const m = createOptionsModel(store, [["off", "Off"]], () => true);
    while (m.view()[m.row()]?.id !== "mapScreen") assert.equal(m.moveRow(1), "move");
    m.change(-1);
    assert.equal(fx.mapScreen, "classic", "HD, no pick (New), Left = a saved Classic pick");
});

test("no GPU WebGL (or no map) falls back to the disc's MAP page; the GPU is not even asked for Classic", () => {
    let asked = 0;
    const noGpu = () => { asked++; return false; };
    assert.equal(G.mapScreenRoute("new", "asuka", noGpu), "classic");
    assert.equal(asked, 1);
    assert.equal(G.mapScreenRoute("new", null, noGpu), "classic", "no map here: the disc page refuses as before");
    assert.equal(G.mapScreenRoute("classic", "asuka", noGpu), "classic");
    assert.equal(asked, 1);
});

test("a globe that fails to load shuts the book once and the game opens the disc's MAP page on the same row", async () => {
    const { createGlobeBook } = await import("../web/world-globe-book.js");
    let status = "loading", fails = 0, closed = 0;
    const stage = {
        open() {}, status: () => status, place: () => null, draw: () => false, close() { closed++; },
    };
    const book = createGlobeBook({
        stage, here: () => ({ server: "asuka", record: 20, name: "Asuka City", icon: null }), held: () => new Set(), onFail: () => { fails++; },
    });
    assert.equal(book.act(new Set()), null, "still loading: stays open");
    status = "failed";
    assert.equal(book.act(new Set()), "back");
    assert.equal(book.act(new Set()), "back");
    assert.equal(fails, 1);
    book.close();
    assert.equal(closed, 1);
    const vars = readSource(new URL("../web/game/vars.js", import.meta.url));
    assert.match(vars, /if \(book === "mapscreen" && globeFellBack\) openPauseMap\(\{ state, status, menu, row \}\);/);
    const home = readSource(new URL("../web/pause-home.js", import.meta.url));
    assert.match(home, /openPage\(state, "map", /);
});

test("controls: arrows turn, L1 zooms in, R1 zooms out, Back closes", async () => {
    const { createGlobeBook } = await import("../web/world-globe-book.js");
    const place = { server: "asuka", record: 20, frame: { x: 0, y: 0 }, lonLat: { lon: 0.1, lat: 0.2 }, marker: null };
    const stage = { open() {}, status: () => "ready", place: () => place, draw: () => false, close() {} };
    const held = new Set();
    const book = createGlobeBook({ stage, here: () => ({ server: "asuka", record: 20, name: "", icon: null }), held: () => held, onFail() {} });
    book.act(new Set());
    const v0 = book.view();
    assert.ok(Math.abs(v0.lon - 0.1) < 1e-9 && Math.abs(v0.lat - 0.2) < 1e-9, "opens turned to your place");
    assert.equal(v0.dist, G.GLOBE_VIEW.distStart);
    held.add("right");
    book.act(new Set(["right"]));
    assert.ok(book.view().lon > v0.lon, "right turns east");
    book.act(new Set());
    assert.ok(book.view().lon > v0.lon, "held right keeps turning");
    held.clear();
    book.act(new Set());
    const lonStop = book.view().lon;
    book.act(new Set());
    assert.equal(book.view().lon, lonStop, "let go: stops");
    held.add("l1");
    book.act(new Set(["l1"]));
    assert.ok(book.view().dist < G.GLOBE_VIEW.distStart, "L1 zooms in");
    held.clear();
    book.act(new Set());
    const d = book.view().dist;
    held.add("r1");
    book.act(new Set(["r1"]));
    assert.ok(book.view().dist > d, "R1 zooms out");
    assert.equal(book.act(new Set(["cross"])), "back");
});

// ---- the original map icons on the globe's place markers (web/world-globe-map.ts markerIcons, web/world-globe-view.ts) ----
const UI_SHEET_DIR = "web/assets/ui";
const haveIcons = haveGlobe && ["stwmp0icon", "stwmp1icon"].every((p) => existsSync(`${UI_SHEET_DIR}/${p}_sheet.json`) && existsSync(`${UI_SHEET_DIR}/${p}_sheet.png`));
/** a PNG's width and height from its IHDR chunk */
const pngSize = (file) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const iconSets = () => {
    const records = G.parseMarkerRecords(JSON.parse(readFileSync(UI_FILE, "utf8")));
    return continents().map((c) => {
        const pack = G.ICON_PACK[c.data.server];
        const sheet = G.parseIconSheet(JSON.parse(readFileSync(`${UI_SHEET_DIR}/${pack}_sheet.json`, "utf8")));
        const size = pngSize(`${UI_SHEET_DIR}/${pack}_sheet.png`);
        return { c, pack, records, sheet, size, icons: G.markerIcons(c, records, sheet, size) };
    });
};

test("every shown marker has its disc icon clip, and every layer of that clip lies inside its sheet", { skip: !haveIcons }, () => {
    assert.deepEqual(G.ICON_PACK, { asuka: "stwmp0icon", amaterasu: "stwmp1icon" });
    for (const { c, pack, records, sheet, size, icons } of iconSets()) {
        for (const icon of icons) {
            const rec = records.find((r) => r.loc === icon.marker.loc);
            assert.ok(rec, `${pack}: record ${icon.marker.loc}`);
            assert.ok(Number.isInteger(icon.clip) && icon.clip === rec.clip, `${pack}: marker ${icon.marker.loc} draws the disc's clip`);
            assert.equal(icon.server, c.data.server);
            const clip = sheet.get(icon.clip);
            assert.ok(clip && clip.layers.length > 0, `${pack}: clip ${icon.clip} exists`);
            for (const l of clip.layers)
                assert.ok(l.x >= 0 && l.y >= 0 && l.w > 0 && l.h > 0 && l.x + l.w <= size.w && l.y + l.h <= size.h, `${pack} clip ${icon.clip}: layer inside ${size.w} x ${size.h}`);
            // the icon box centre is the globe file's marker point to within half a px (the files hold record + 12.5)
            assert.ok(Math.abs(icon.centre.x - icon.marker.x) <= 0.5 && Math.abs(icon.centre.y - icon.marker.y) <= 0.5, `${pack}: icon ${icon.marker.loc} on its marker`);
        }
    }
    // a missing clip or one outside the sheet makes the globe fail to load (the MAP row then opens the disc's page)
    const [{ c, records, size }] = iconSets();
    assert.throws(() => G.markerIcons(c, records, new Map(), size), /has no clip/);
    const one = new Map([...Array(64).keys()].map((k) => [k, { layers: [{ x: size.w - 8, y: 0, w: 24, h: 24, dx: 0, dy: 0 }] }]));
    assert.throws(() => G.markerIcons(c, records, one, size), /outside the sheet/);
    assert.throws(() => G.markerIcons(c, [], one, size), /no record/);
});

test("45 icons are placed on each continent, records 1..45, each on its own continent's half", { skip: !haveIcons }, () => {
    const sets = iconSets();
    assert.equal(sets.length, 2);
    for (const { c, icons } of sets) {
        assert.equal(icons.length, 45, `${c.data.server}: 45 icons`);
        assert.deepEqual(icons.map((i) => i.marker.loc).sort((a, b) => a - b), [...Array(45).keys()].map((k) => k + 1));
        for (const icon of icons) {
            const f = G.lonLatToFrame(c.band, icon.lonLat);
            assert.ok(Math.abs(f.x - icon.centre.x) < 1e-6 && Math.abs(f.y - icon.centre.y) < 1e-6, "lon/lat goes back to the icon centre");
            assert.ok(Math.abs(G.angleDelta(icon.lonLat.lon, G.CONTINENT_LON[c.data.server])) < G.MAP_LON_SPAN / 2, `${icon.marker.name} on its half`);
        }
    }
});

test("icon size rule: box px times the map's local scale, so an icon covers on the globe what it covers on the map", { skip: !haveIcons }, () => {
    for (const { c, icons } of iconSets()) {
        for (const icon of icons) {
            const s = G.frameScaleAt(c.band, icon.lonLat.lat);
            assert.ok(Math.abs(icon.size.w - icon.box.w * s) < 1e-12 && Math.abs(icon.size.h - icon.box.h * s) < 1e-12);
            // in longitude the icon spans exactly box.w / frameW of the map's longitude span (Mercator: same scale both ways)
            const lonSpan = icon.size.w / Math.cos(icon.lonLat.lat);
            assert.ok(Math.abs(lonSpan - (icon.box.w / c.data.frameW) * G.MAP_LON_SPAN) < 1e-12);
            assert.deepEqual([icon.box.w, icon.box.h], [24, 24], "the disc's location icons are 24 x 24 boxes");
        }
        // on the equator a 24 px icon is 24 / 392 of the map's width there (arc length in globe radii)
        assert.ok(Math.abs(24 * G.frameScaleAt(c.band, 0) - (24 / 392) * G.MAP_LON_SPAN) < 1e-12);
    }
});

test("the globe draws the icons pixel-sharp billboards over the globe and the 'you are here' marker after them", () => {
    const src = readSource(new URL("../web/world-globe-view.js", import.meta.url));
    assert.match(src, /tex\.magFilter = THREE\.NearestFilter;/);
    assert.match(src, /tex\.minFilter = THREE\.NearestFilter;/);
    assert.match(src, /new THREE\.Sprite\(mat\)/);
    assert.match(src, /const ICON_ORDER = 1, HERE_ORDER = 2;/);
    assert.match(src, /built\.faceIcons\(p\);\s*renderer\.render/);
    assert.doesNotMatch(src, /InstancedMesh\(/, "the yellow pins are gone");
});
