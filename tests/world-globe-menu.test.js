// The pause MAP screen's World Globe (OPTIONS > GAME > Map screen = New): which server's continent a stage is on, where your
// place lands on the globe, which screen the row opens, and the fall back to the disc's MAP page.
// Real data (web/assets) is needed for the place tests: they skip when it is not there.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
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

/** a book's "you are here" and an empty places table (the fake stages ignore them) */
const HERE = { server: "asuka", record: 20, name: "Asuka City", icon: null, map: "s200", pos: { x: 100, y: 100 }, entry: null };
const NO_PLACES = { screens: new Map(), here: null };
/** a reveal (the fake stages only pass it on) */
const REVEAL = { tier: 0, areas: { asuka: [1], amaterasu: [] }, visited: { asuka: [20], amaterasu: [] }, fadeIn: { asuka: [], amaterasu: [] }, all: false };
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
        open() {}, status: () => status, place: () => null, targets: () => [], home: () => -1, shown: () => false, want: () => false,
        draw: () => false, close() { closed++; },
    };
    const book = createGlobeBook({
        stage, here: () => HERE, places: () => NO_PLACES, reveal: () => REVEAL, held: () => new Set(), onFail: () => { fails++; },
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

test("controls: arrows turn (at every zoom), L1 zooms in, R1 zooms out, the picture is asked for only by a zoom in, Back closes", async () => {
    const { createGlobeBook } = await import("../web/world-globe-book.js");
    const place = { server: "asuka", record: 20, frame: { x: 0, y: 0 }, lonLat: { lon: 0.1, lat: 0.2 }, marker: null };
    const targets = [{ key: "asuka:20", server: "asuka", record: 20, lonLat: { lon: 0.1, lat: 0.2 }, iconRadius: 0.09 }];
    let asked = 0, opened = null;
    const stage = {
        open(h, p, r) { opened = { h, p, r }; }, status: () => "ready", place: () => place, targets: () => targets, home: () => 0,
        shown: () => true, want: () => { asked++; return true; }, draw: () => false, close() {},
    };
    const held = new Set();
    const book = createGlobeBook({ stage, here: () => HERE, places: () => NO_PLACES, reveal: () => REVEAL, held: () => held, onFail() {} });
    assert.deepEqual(opened, { h: HERE, p: NO_PLACES, r: REVEAL }, "the stage gets where you are, the places and the reveal");
    book.act(new Set());
    const v0 = book.view();
    assert.ok(Math.abs(v0.look.lon - 0.1) < 1e-9 && Math.abs(v0.look.lat - 0.2) < 1e-9, "opens turned to your place");
    assert.deepEqual([v0.z, v0.target, v0.turned], [0, 0, false], "whole globe, your place the target");
    held.add("right");
    book.act(new Set(["right"]));
    assert.ok(book.view().look.lon > v0.look.lon, "right turns east");
    book.act(new Set());
    assert.ok(book.view().look.lon > v0.look.lon, "held right keeps turning");
    held.clear();
    book.act(new Set());
    const lonStop = book.view().look.lon;
    book.act(new Set());
    assert.equal(book.view().look.lon, lonStop, "let go: stops");
    assert.equal(asked, 0, "turning loads no picture");
    held.add("l1");
    book.act(new Set(["l1"]));
    for (let i = 0; i < 200; i++) book.act(new Set());
    assert.equal(book.view().z, 1, "held L1 zooms all the way in");
    assert.ok(asked > 0, "zooming in asks for the picture");
    held.clear();
    book.act(new Set());
    // turning still works with the window filling the view (it pans)
    const z1 = book.view();
    held.add("up");
    book.act(new Set(["up"]));
    for (let i = 0; i < 10; i++) book.act(new Set());
    assert.ok(book.view().look.lat > z1.look.lat, "Up turns at z = 1");
    held.clear();
    book.act(new Set());
    const z = book.view().z;
    held.add("r1");
    book.act(new Set(["r1"]));
    assert.ok(book.view().z < z, "R1 zooms out");
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

test("the globe draws the icons as billboards over the globe (the disc fallback pixel-sharp) and the 'you are here' marker after them", () => {
    const src = readSource(new URL("../web/world-globe-view.js", import.meta.url));
    assert.match(src, /tex\.magFilter = THREE\.NearestFilter;/);
    assert.match(src, /tex\.minFilter = THREE\.NearestFilter;/);
    assert.match(src, /new THREE\.Sprite\(mat\)/);
    assert.match(src, /const ICON_ORDER = 1, HERE_ORDER = 2;/);
    assert.match(src, /lastState = zoom\.update\(\{[^}]*\}\);\s*renderer\.render/);
    assert.match(readSource(new URL("../web/world-globe-zoom-view.js", import.meta.url)), /globe\.faceIcons\(camera\.position\);/);
    assert.doesNotMatch(src, /InstancedMesh\(/, "the yellow pins are gone");
});

// ---- the HD icons (Gemini repaint, web/assets/world-globe/icons-hd/clipNN.png, git-ignored) ----
const HD_DIR = `${GLOBE_DIR}/${G.HD_ICON_DIR}`;
const haveHd = existsSync(HD_DIR);

/** an 8-bit RGBA, non-interlaced PNG's size and alpha bytes (IHDR + inflated IDAT, scanline filters undone) */
const pngAlpha = (file) => {
    const b = readFileSync(file);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], colour = b[25], interlace = b[28];
    const idat = [];
    for (let p = 8; p < b.length;) {
        const len = b.readUInt32BE(p), type = b.toString("ascii", p + 4, p + 8);
        if (type === "IDAT") idat.push(b.subarray(p + 8, p + 8 + len));
        p += 12 + len;
    }
    if (depth !== 8 || colour !== 6 || interlace !== 0) return { w, h, depth, colour, alpha: null };
    const raw = inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp;
    const px = new Uint8Array(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? px[row + x - bpp] : 0, up = y ? px[row - stride + x] : 0, ul = y && x >= bpp ? px[row - stride + x - bpp] : 0;
            const pa = Math.abs(up - ul), pb = Math.abs(a - ul), pc = Math.abs(a + up - 2 * ul);
            const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
            px[row + x] = (raw[src + x] + pred) & 255;
        }
    }
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3];
    return { w, h, depth, colour, alpha };
};

test("HD icons: every clip 1..36 the markers draw has its picture on disk, square RGBA, with transparent and visible px", { skip: !(haveIcons && haveHd) }, () => {
    const records = G.parseMarkerRecords(JSON.parse(readFileSync(UI_FILE, "utf8")));
    assert.deepEqual(G.shownIconClips(continents(), records), [...Array(36).keys()].map((k) => k + 1), "the 45 shown markers draw clips 1..36");
    for (let clip = 1; clip <= 36; clip++) {
        const file = `${GLOBE_DIR}/${G.hdIconFile(clip)}`;
        assert.ok(existsSync(file), `${file} is there`);
        const { w, h, depth, colour, alpha } = pngAlpha(file);
        assert.ok(w > 0 && w === h, `clip ${clip}: square (${w} x ${h})`);
        assert.equal(depth, 8, `clip ${clip}: 8 bit`);
        assert.equal(colour, 6, `clip ${clip}: RGBA`);
        assert.ok(alpha, `clip ${clip}: alpha read`);
        let clear = 0, solid = 0;
        for (const a of alpha) { if (a === 0) clear++; else if (a === 255) solid++; }
        assert.ok(clear > w * h * 0.25, `clip ${clip}: transparent background (${clear} px)`);
        assert.ok(solid > w * h * 0.1, `clip ${clip}: not empty (${solid} opaque px)`);
        // nothing touches the picture's edge: the cut kept all of the repaint
        for (let i = 0; i < w; i++) {
            assert.ok(alpha[i] === 0 && alpha[(h - 1) * w + i] === 0 && alpha[i * w] === 0 && alpha[i * w + w - 1] === 0, `clip ${clip}: clear edge`);
        }
    }
});

test("HD icons: a picture that fails to load leaves its clip on the disc art; the others draw HD at the same scale", async () => {
    assert.equal(G.hdIconFile(7), "icons-hd/clip07.png");
    const asked = [];
    const hd = await G.loadHdIcons([4, 5, 6], "assets/world-globe/", (url) => {
        asked.push(url);
        return url.endsWith("clip05.png") ? Promise.reject(new Error("404")) : Promise.resolve({ url });
    });
    assert.deepEqual(asked, ["assets/world-globe/icons-hd/clip04.png", "assets/world-globe/icons-hd/clip05.png", "assets/world-globe/icons-hd/clip06.png"]);
    assert.deepEqual([...hd.keys()], [4, 6], "the failed clip is left out, nothing rejects");
    const icon = (clip) => ({ server: "asuka", marker: { loc: 1 }, clip, box: { x: 0, y: 0, w: 24, h: 24 }, centre: { x: 0, y: 0 }, lonLat: { lon: 0, lat: 0 }, size: { w: 0.024, h: 0.024 } });
    const miss = G.iconArt(icon(5), hd);
    assert.equal(miss.hd, null);
    assert.deepEqual(miss.size, { w: 0.024, h: 0.024 }, "fallback: the disc clip at its box size");
    const got = G.iconArt(icon(4), hd);
    assert.deepEqual(got.hd, { url: "assets/world-globe/icons-hd/clip04.png" });
    assert.ok(Math.abs(got.size.w - 0.024 * (G.HD_ICON_SPAN / 24)) < 1e-15 && Math.abs(got.size.h - 0.024 * (G.HD_ICON_SPAN / 24)) < 1e-15, "HD: HD_ICON_SPAN px at the icon's own scale");
    assert.deepEqual(G.iconArt(icon(9), new Map()).hd, null, "no HD pictures at all: every clip on the disc art");
    // the view: HD smooth (linear + mipmaps), the disc fallback stays nearest, the sprite takes the art's size, picking keeps the box
    const src = readSource(new URL("../web/world-globe-view.js", import.meta.url));
    assert.match(src, /function hdIconTexture\(image\) \{[^}]*tex\.magFilter = THREE\.LinearFilter;\s*tex\.minFilter = THREE\.LinearMipmapLinearFilter;\s*tex\.generateMipmaps = true;/);
    assert.match(src, /const art = iconArt\(icon, assets\.hdIcons\);/);
    assert.match(src, /map = art\.hd \? hdIconTexture\(art\.hd\) : iconTexture\(sheet, icon\);/);
    assert.match(src, /sprite\.scale\.set\(art\.size\.w, art\.size\.h, 1\);/);
    assert.match(src, /loadHdIcons\(shownIconClips\(cs, rs\), dir, loadHdIconImage\)/);
    assert.match(src, /s\.icon\.size\.w \/ 2 \/ depth/, "picking still uses the clip box");
});
