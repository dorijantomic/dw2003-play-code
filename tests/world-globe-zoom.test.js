// World Globe zoom (maths web/world-globe-zoom.js, screens web/world-globe-places.js; drawn by web/world-globe-zoom-view.js in
// the dev page web/world-globe.html and the pause MAP book web/world-globe-book.js). Checks with the real code, the game's own
// tables and the real three.js camera:
// - every place on both continents (records 1..45) resolves a screen whose picture exists on disk (HD tiles or the native png);
// - the zoom target is the place whose icon is nearest the view's centre (against an independent three.js projection);
// - the icon fades out exactly as the window fades in (sum 1 at every z), the window starts at the icon's size and only grows;
// - your position: state x, y (native map px) -> globe -> screen -> back within 0.5 px on real stages of both continents;
// - indoors: the kept entry, the game's return door, the room's own exit, else the main screen without a dot;
// - turning works at every zoom (the dev page's drag and the menu's arrows), and the dev page has no orbit control left.
// The real data runs when it is there (web/assets is local, not in the repo); the maths with stand-ins always runs.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as THREE from "../web/lib3d/three.module.js";
import * as Z from "../web/world-globe-zoom.js";
import * as G from "../web/world-globe-map.js";
import * as P from "../web/world-globe-places.js";
import { isOpenAirMapName } from "../web/map-open-air.js";

const UI_FILE = "web/assets/data/status_ui.json", MANIFEST = "web/assets/manifest.json", TILES = "web/assets-hd/map-tiles/index.json";
const haveData = [UI_FILE, MANIFEST, "web/assets/scenes/s350.json", "web/assets/world-globe/asuka.json", "web/assets/world-globe/amaterasu.json"].every((f) => existsSync(f));
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const pngSize = (file) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const FOV = Z.ZOOM.fovDeg, VIEW_H = 1080;
const ASPECTS = { "4:3": 4 / 3, "16:9": 16 / 9, "21:9": 21 / 9, "book": 304 / 142 };
const STEPS = 1000;
const SERVERS = ["asuka", "amaterasu"];

/** the game's tables, read once */
const data = haveData ? (() => {
    const ui = readJson(UI_FILE);
    const walker = P.parseWalkerMap(ui);
    const maps = P.parsePlaceMaps(readJson(MANIFEST).maps);
    const raw = {};
    for (const m of maps) { const f = `web/assets/scenes/${m.id}.json`; if (existsSync(f)) raw[m.id] = readJson(f); }
    const scenes = P.parsePlaceScenes(raw);
    const records = G.parseMarkerRecords(ui);
    const icons = SERVERS.flatMap((server) => {
        const c = { data: G.parseGlobeMap(readJson(`web/assets/world-globe/${server}.json`)) };
        c.band = G.continentBand(c.data);
        const sheet = `web/assets/ui/${G.ICON_PACK[server]}_sheet`;
        return G.markerIcons(c, records, G.parseIconSheet(readJson(`${sheet}.json`)), pngSize(`${sheet}.png`));
    });
    // the zoom's targets exactly as web/world-globe-zoom-view.js zoomTargets makes them
    const targets = icons.map((i) => ({ key: P.placeKey(i.server, i.marker.loc), server: i.server, record: i.marker.loc, lonLat: i.lonLat, iconRadius: Math.max(i.size.w, i.size.h) / 2 }));
    return { walker, maps, scenes, targets, byId: new Map(maps.map((m) => [m.id, m])) };
})() : null;

/** stand-in targets: a ring of places round (0.3, 0.15) */
const fakeTargets = () => Array.from({ length: 12 }, (_, i) => ({
    key: `asuka:${i + 1}`, server: "asuka", record: i + 1, iconRadius: 0.09,
    lonLat: { lon: 0.3 + 0.25 * Math.cos(i), lat: 0.15 + 0.2 * Math.sin(i * 1.7) },
}));
const targets = data ? data.targets : fakeTargets();
const always = () => true;
const env = (home = -1, aspect = 16 / 9, ready = always) => ({ targets, home, aspect, fovDeg: FOV, ready });

/** the camera exactly as web/world-globe-zoom-view.js sets it */
function cameraFor(c, aspect, near = 0.01, far = 10) {
    const cam = new THREE.PerspectiveCamera(FOV, aspect, near, far);
    cam.position.set(c.camera.x, c.camera.y, c.camera.z);
    cam.up.set(c.up.x, c.up.y, c.up.z);
    cam.lookAt(c.target.x, c.target.y, c.target.z);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
}
const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
const toScreen = (cam, aspect, p) => { const n = v3(p).project(cam); return { x: (n.x + 1) / 2 * VIEW_H * aspect, y: (1 - n.y) / 2 * VIEW_H }; };
/** the window circle's area on screen as the radius of a circle of that area (px), from 128 points on its edge */
function windowScreenRadius(st, cam, aspect) {
    const pts = [];
    for (let i = 0; i < 128; i++) {
        const a = (i / 128) * 2 * Math.PI;
        pts.push(toScreen(cam, aspect, Z.mapPxToWorld(st, { x: st.centre.x + st.radius * Math.cos(a), y: st.centre.y + st.radius * Math.sin(a) })));
    }
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.y - q.x * p.y; }
    return Math.sqrt(Math.abs(area) / 2 / Math.PI);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const deg = (r) => (r * 180) / Math.PI;

/** the picture a screen loads (web/world-globe-zoom-view.js loadZoomPicture): HD tiles when the index lists it, else the png */
function picturePath(map, tiles) {
    const t = tiles ? Z.parseTileInfo(tiles, map) : null;
    if (t) {
        const dir = `web/assets-hd/map-tiles/${map}`;
        const skip = new Set(t.skip);
        const missing = [];
        for (let c = 0; c < t.cols; c++) for (let r = 0; r < t.rows; r++) if (!skip.has(`${c}_${r}`) && !existsSync(`${dir}/${c}_${r}.webp`)) missing.push(`${c}_${r}`);
        return { path: dir, ok: missing.length === 0, hd: true, scale: t.scale, w: t.w, h: t.h, missing };
    }
    const png = `web/assets/maps/${map}.png`;
    return { path: png, ok: existsSync(png), hd: false };
}

test("every place 1..45 on both continents: a main screen, its picture on disk, the size the window is drawn at", { skip: !haveData }, () => {
    const screens = P.placeScreens(data.walker, data.maps, data.scenes);
    const tiles = existsSync(TILES) ? readJson(TILES) : null;
    const rules = { "open-air": 0, "no-open-air": 0 }, sources = { hd: 0, png: 0 };
    for (const server of SERVERS) {
        const records = data.targets.filter((t) => t.server === server).map((t) => t.record).sort((a, b) => a - b);
        assert.ok(records.length >= 45, `${server}: ${records.length} icons`);
        for (const record of records) {
            const key = P.placeKey(server, record), s = screens.get(key);
            assert.ok(s, `${key}: no screen`);
            const m = data.byId.get(s.map);
            assert.deepEqual([s.w, s.h], [m.width, m.height], `${key}: size = the manifest's`);
            const pic = picturePath(s.map, tiles);
            assert.ok(pic.ok, `${key} ${s.map}: picture missing (${pic.path} ${pic.missing ?? ""})`);
            if (pic.hd) assert.deepEqual([pic.w / pic.scale, pic.h / pic.scale], [s.w, s.h], `${key} ${s.map}: HD tiles = native x scale`);
            // the main screen is one of the place's stages, open air when it has any
            assert.ok(s.stages.includes(s.map));
            const open = s.stages.filter((id) => isOpenAirMapName(data.byId.get(id).name));
            assert.equal(s.rule, open.length ? "open-air" : "no-open-air");
            if (open.length) assert.ok(open.includes(s.map), `${key}: main screen ${s.map} is not open air`);
            rules[s.rule]++; sources[pic.hd ? "hd" : "png"]++;
        }
        console.log(`# ${server}: ${records.length} places, records ${records[0]}..${records[records.length - 1]}`);
    }
    console.log(`# rules: ${JSON.stringify(rules)}; pictures: ${JSON.stringify(sources)}`);
    // the rule: most links among the open-air stages (ties: lowest stage); spot checks the walker table backs
    const links = P.linkCounts(data.scenes);
    for (const s of screens.values()) {
        const pool = s.rule === "open-air" ? s.stages.filter((id) => isOpenAirMapName(data.byId.get(id).name)) : s.stages;
        const best = Math.max(...pool.map((id) => links.get(id) ?? 0));
        assert.equal(s.links, best, `${s.key}: not the most linked`);
        const first = pool.find((id) => (links.get(id) ?? 0) === best);
        assert.equal(s.map, first, `${s.key}: tie not broken to the lowest stage`);
    }
    assert.equal(screens.get("asuka:21").map, "s355", "West Wire Forest: s355 has more links than s350");
});

test("zoom target = the place whose icon is nearest the view's centre (independent three.js projection)", () => {
    let rnd = 12345;
    const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
    let checked = 0, none = 0;
    for (let i = 0; i < 400; i++) {
        const t = targets[Math.floor(rand() * targets.length)];
        const look = { lon: t.lonLat.lon + (rand() - 0.5) * 0.8, lat: Math.max(-1, Math.min(1, t.lonLat.lat + (rand() - 0.5) * 0.6)) };
        const z = rand() * Z.ZOOM_BANDS.swap[0];
        const aspect = Object.values(ASPECTS)[i % 4];
        const zc = Z.zoomCamera(look, z), cam = cameraFor(zc, aspect);
        // independent: three.js projects each icon; in front of the camera and on the camera's side of the globe; distance on the
        // image plane in units of the vertical half-height (x scaled by the aspect)
        let best = -1, bestD = Infinity;
        targets.forEach((tg, j) => {
            const p = v3(G.lonLatToPoint(tg.lonLat, Z.ZOOM.pinR));
            if (p.clone().normalize().dot(cam.position) <= 1) return;
            const local = p.clone().applyMatrix4(cam.matrixWorldInverse);
            if (!(local.z < 0)) return;
            const n = p.clone().project(cam);
            const d = Math.hypot(n.x * aspect, n.y);
            if (d < bestD) { bestD = d; best = j; }
        });
        const v = Z.zoomView({ ...Z.startZoomView(look, -1), turned: true, z }, z, env(-1, aspect));
        assert.equal(v.target, best, `view ${i}: picked ${targets[v.target]?.key}, nearest ${targets[best]?.key}`);
        if (best < 0) none++; else checked++;
    }
    console.log(`# ${checked} views matched the nearest icon (${none} with none in sight), ${targets.length} targets`);
    // before any turn your own place is the target; from the swap on the target is kept while you pan
    const home = 3;
    assert.equal(Z.zoomView(Z.startZoomView(targets[0].lonLat, home), 0.05, env(home)).target, home);
    let v = Z.zoomView(Z.startZoomView(targets[home].lonLat, home), 0.5, env(home));
    v = Z.turnView(v, 0.05, 0.02, env(home), G.GLOBE_VIEW.latMax);
    assert.equal(v.target, home, "kept while panning over its window");
});

test("icon <-> window: opacities sum to 1 at every z, the window starts at the icon's size and only grows on screen from the swap", () => {
    const B = Z.ZOOM_BANDS, tg = targets[0];
    for (const [name, aspect] of Object.entries(ASPECTS)) {
        const inp = { look: tg.lonLat, place: tg.lonLat, mapW: 1536, mapH: 768, spot: { x: 312, y: 122 }, iconRadius: tg.iconRadius, aspect, fovDeg: FOV };
        let prev = null, prevH = null, worst = Infinity, maxSumErr = 0, minMax = 1;
        const steps = [];
        for (let i = 0; i <= STEPS; i++) {
            const z = i / STEPS, st = Z.zoomState(z, inp);
            maxSumErr = Math.max(maxSumErr, Math.abs(st.iconAlpha + st.windowAlpha - 1));
            minMax = Math.min(minMax, Math.max(st.iconAlpha, st.windowAlpha));
            if (z <= B.swap[0]) {
                assert.equal(st.windowAlpha, 0, `${name} z ${z}: window before the swap`);
                assert.ok(Math.abs(st.worldRadius - tg.iconRadius) < 1e-12, `${name} z ${z}: window radius != icon's`);
            }
            if (z >= B.swap[1]) assert.equal(st.iconAlpha, 0, `${name} z ${z}: icon after the swap`);
            if (z < B.swap[0]) continue;
            const r = windowScreenRadius(st, cameraFor(st, aspect, st.near, st.far), aspect);
            if (prev !== null) {
                assert.ok(r > prev, `${name}: window shrank at z ${z.toFixed(3)} (${prev} -> ${r})`);
                const d = Math.log(r / prev);
                steps.push(d);
                worst = Math.min(worst, d - Math.log(prevH / st.height));
            }
            prev = r; prevH = st.height;
        }
        const ratio = Math.max(...steps) / median(steps);
        console.log(`# ${name}: |icon + window - 1| max ${maxSumErr.toExponential(1)}, min of the larger ${minMax.toFixed(3)}; window log step max/median ${ratio.toFixed(3)}, window minus globe min ${worst.toExponential(2)}`);
        assert.ok(maxSumErr < 1e-12);
        assert.ok(minMax >= 0.5 - 1e-12, "a gap: both under half");
        assert.ok(ratio < 2, `${name}: a spike in the window's growth`);
        assert.ok(worst > 0, `${name}: the window grew slower than the globe from the swap`);
    }
});

test("your position: state x, y (native map px) -> globe -> screen -> back within 0.5 px on real stages of both continents", { skip: !haveData }, () => {
    // the arrival points of real exits (where the field puts you): Asuka s350 / s200, Amaterasu s201 / s331
    const cases = [["s335", "s350"], ["s210", "s200"], ["s211", "s201"], ["s206", "s331"]];
    for (const [from, map] of cases) {
        const ex = data.scenes[from].exits.find((e) => e.to === map && e.spawnX != null);
        assert.ok(ex, `${from} -> ${map}`);
        const pos = { x: ex.spawnX, y: ex.spawnY };
        const p = P.placeOfMap(data.walker, map);
        const places = P.globePlaces(data.walker, data.maps, data.scenes, { ...p, map, pos, entry: null });
        assert.equal(places.here.how, "current");
        const key = P.placeKey(p.server, p.record), tg = data.targets.find((t) => t.key === key);
        assert.ok(tg, `${key}: has an icon`);
        const s = P.screenForTarget(key, places);
        assert.deepEqual([s.map, s.mine, s.spot], [map, true, pos], `${map}: your own screen and dot`);
        let worstErr = 0;
        for (const aspect of Object.values(ASPECTS)) {
            for (const z of [0.3, 0.5, 0.75, 1]) {
                const look = Z.zoomView(Z.startZoomView(tg.lonLat, 0), z, { ...env(0, aspect), targets: [tg] }).look;
                const st = Z.zoomState(z, { look, place: tg.lonLat, mapW: s.w, mapH: s.h, spot: s.spot, iconRadius: tg.iconRadius, aspect, fovDeg: FOV });
                const w = Z.mapPxToWorld(st, pos);
                const m = new THREE.Matrix4().fromArray(Z.mapPxMatrix(st));
                const wm = new THREE.Vector3(pos.x, pos.y, 0).applyMatrix4(m);
                const cam = cameraFor(st, aspect, st.near, st.far);
                const ndc = v3(w).project(cam);
                const ray = new THREE.Raycaster();
                ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
                const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(v3(st.frame.normal), v3(st.frame.origin));
                const viaScreen = Z.worldToMapPx(st, ray.ray.intersectPlane(plane, new THREE.Vector3()));
                const err = Math.max(Math.hypot(viaScreen.x - pos.x, viaScreen.y - pos.y), wm.distanceTo(v3(w)) / st.scale);
                worstErr = Math.max(worstErr, err);
                assert.ok(err < 0.5, `${map} z ${z}: ${err} px`);
                // the dot is inside the window's opaque part and in view once the window shows
                const inside = Math.hypot(pos.x - st.centre.x, pos.y - st.centre.y) / st.radius;
                assert.ok(inside <= 1 - Z.ZOOM.feather - Z.ZOOM.wobble + 1e-9, `${map} z ${z}: dot in the soft edge (${inside})`);
                assert.ok(Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1, `${map} z ${z}: dot out of view`);
            }
        }
        console.log(`# ${p.server} ${map} (${s.w} x ${s.h}) at ${pos.x}, ${pos.y}: round trip worst ${worstErr.toExponential(2)} px`);
    }
});

test("indoors: kept entry, the game's return door, the room's own exit, else the main screen with no dot", { skip: !haveData }, () => {
    const isOpen = (id) => isOpenAirMapName(data.byId.get(id)?.name ?? "");
    const here = (map, entry = null, scenes = data.scenes) => {
        const p = P.placeOfMap(data.walker, map);
        return P.globePlaces(data.walker, data.maps, scenes, { ...p, map, pos: { x: 100, y: 100 }, entry }).here;
    };
    // Asuka City Main Lobby (s210), walked into from Asuka City (s200) at its door
    const door = { x: 1000, y: 220 };
    const entry = P.nextGlobeEntry(null, "s200", "s210", door, isOpen);
    assert.deepEqual(entry, { from: "s200", ...door });
    assert.deepEqual(P.nextGlobeEntry(entry, "s210", "s235", { x: 5, y: 5 }, isOpen), entry, "room to room keeps it");
    assert.equal(P.nextGlobeEntry(entry, "s210", "s200", { x: 5, y: 5 }, isOpen), null, "back outdoors drops it");
    const a = here("s210", entry);
    assert.deepEqual([a.how, a.map, a.spot], ["entered", "s200", door]);
    // no kept entry (a loaded save): the game's synthesized return door says where you came in
    const withReturn = { ...data.scenes, s210: { exits: [...data.scenes.s210.exits.filter((e) => e.to !== "s200"), { to: "s200", spawnX: 812, spawnY: 300, _entranceReturn: true }] } };
    const b = here("s210", null, withReturn);
    assert.deepEqual([b.how, b.map, b.spot], ["entered", "s200", { x: 812, y: 300 }]);
    // neither: the room's own exit to the one outdoor screen, dot at its arrival point
    const ex = data.scenes.s210.exits.find((e) => e.to === "s200");
    const c = here("s210");
    assert.deepEqual([c.how, c.map, c.spot], ["door", "s200", { x: ex.spawnX, y: ex.spawnY }]);
    // two doors to the same screen at different points (Smith's Shop s245): that screen, no dot
    const d = here("s245");
    assert.deepEqual([d.how, d.map, d.spot], ["door", "s200", null]);
    // a room with no exit to its place's open air: the place's main screen, no dot
    const screens = P.placeScreens(data.walker, data.maps, data.scenes);
    const deep = data.maps.find((m) => {
        const p = P.placeOfMap(data.walker, m.id);
        if (!p || isOpen(m.id) || screens.get(P.placeKey(p.server, p.record))?.rule !== "open-air") return false;
        return !(data.scenes[m.id]?.exits ?? []).some((e) => e.to && isOpen(e.to) && P.placeOfMap(data.walker, e.to)?.record === p.record && P.placeOfMap(data.walker, e.to)?.server === p.server);
    });
    assert.ok(deep, "a deep room exists");
    const e = here(deep.id), pd = P.placeOfMap(data.walker, deep.id);
    assert.deepEqual([e.how, e.map, e.spot], ["main", screens.get(P.placeKey(pd.server, pd.record)).map, null]);
    console.log(`# s210 entered -> s200 at ${door.x}, ${door.y}; return door -> 812, 300; own exit -> ${ex.spawnX}, ${ex.spawnY}; s245 -> s200 no dot; deep room ${deep.id} (${deep.name}) -> main ${e.map} no dot`);
});

test("turning works at every zoom: drag on the dev page, arrows in the menu; the picture gates the swap", () => {
    const home = 0, tg = targets[home], e = env(home);
    for (const z of [0, 0.2, 0.5, 0.8, 1]) {
        const v = Z.zoomView(Z.startZoomView(tg.lonLat, home), z, e);
        assert.ok(Math.abs(v.z - z) < 1e-12);
        // a 40 px drag right on a 1080 px view: the look point moves west, the camera with it
        const r = Z.dragTurn(v.z, 40, 0, VIEW_H, FOV);
        const t = Z.turnView(v, r.east, r.north, e, G.GLOBE_VIEW.latMax);
        const before = Z.zoomCamera(v.look, v.z).camera, after = Z.zoomCamera(t.look, t.z).camera;
        const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
        assert.ok(moved > 1e-6, `z ${z}: drag did not move the camera`);
        assert.ok(t.look.lon < v.look.lon || Math.abs(t.look.lon - v.look.lon) > Math.PI, `z ${z}: drag right should show what lies west`);
        // held "up" in the menu: one second of frames moves the look north
        let m = v;
        for (let i = 0; i < 50; i++) m = Z.stepZoomView(m, { left: false, right: false, up: true, down: false, zoomIn: false, zoomOut: false }, e, 1 / 50, G.GLOBE_VIEW.latMax);
        assert.ok(m.look.lat > v.look.lat, `z ${z}: arrows did not turn`);
        assert.ok(Math.abs(m.z - v.z) < 1e-12, `z ${z}: turning changed the zoom`);
        console.log(`# z ${z}: drag 40 px moves the camera ${moved.toFixed(5)}, 1 s of Up turns ${deg(m.look.lat - v.look.lat).toFixed(3)} deg`);
    }
    // over a window the pan stays near the place
    let v = Z.zoomView(Z.startZoomView(tg.lonLat, home), 1, e);
    for (let i = 0; i < 500; i++) v = Z.turnView(v, 0.01, 0, e, G.GLOBE_VIEW.latMax);
    const reach = Z.ZOOM.panReach * Z.zoomHeight(1) * Math.tan((FOV * Math.PI) / 360);
    assert.ok(Z.arcBetween(v.look, tg.lonLat) <= reach + 1e-9, "pan left the window");
    // the swap waits for the picture: not ready -> stops at the swap start; asked only when zooming in
    let asked = 0;
    const notReady = env(home, 16 / 9, () => { asked++; return false; });
    const w = Z.zoomView(Z.startZoomView(tg.lonLat, home), 1, notReady);
    assert.equal(w.z, Z.ZOOM_BANDS.swap[0]);
    assert.equal(asked, 1);
    Z.turnView(w, 0.01, 0, notReady, G.GLOBE_VIEW.latMax);
    Z.zoomView(w, w.z, notReady);
    assert.equal(asked, 1, "a turn at a held z must not load a picture");
});

test("dev page and menu source: no orbit control, drag and arrows drive the one zoom view", () => {
    const page = readFileSync("web/world-globe.js", "utf8");
    assert.doesNotMatch(page, /OrbitControls|controls\.enabled/, "the dev page's camera has one driver: the zoom view");
    assert.match(page, /const r = dragTurn\(view\.z, dx, dy, cv\.clientHeight, ZOOM\.fovDeg\);\s*view = turnView\(view, r\.east, r\.north, env, GLOBE_VIEW\.latMax\);/);
    assert.match(page, /view = stepZoomView\(view, \{\s*left: keysHeld\.has\("arrowleft"\)/);
    assert.doesNotMatch(page, /zfx|cloud/i, "grid only");
    const html = readFileSync("web/world-globe.html", "utf8");
    assert.doesNotMatch(html, /zoom-on|zfx|cloud/i);
    const book = readFileSync("web/world-globe-book.js", "utf8");
    assert.match(book, /view = stepZoomView\(view, \{/);
});

test("bands, tile index, eased z", () => {
    const B = Z.ZOOM_BANDS;
    const inp = { look: { lon: 0.3, lat: 0.1 }, place: { lon: 0.3, lat: 0.1 }, mapW: 1536, mapH: 768, spot: null, iconRadius: 0.09, aspect: 16 / 9, fovDeg: FOV };
    for (const z of [0, 0.44, 0.71, 1]) assert.equal(Z.zoomState(z, inp).gridAmount, 0, `no grid at z ${z}`);
    assert.equal(Z.zoomState(0.575, inp).gridAmount, 1);
    assert.ok(B.swap[1] < B.transition[0], "the window is whole before the grid runs");
    const a = Z.zoomState(B.sweep[0], inp), b = Z.zoomState(B.sweep[1], inp);
    assert.ok(a.sweepY + a.sweepSoft < a.centre.y - a.radius && b.sweepY - b.sweepSoft > b.centre.y + b.radius);
    assert.equal(Z.parseTileInfo({ tile: 1024, gutter: 4, scale: 4, maps: {} }, "s350"), null);
    assert.deepEqual(Z.parseTileInfo({ tile: 1024, gutter: 4, scale: 4, maps: { s350: { w: 6144, h: 3072, cols: 6, rows: 3, skip: [[1, 2]] } } }, "s350").skip, ["1_2"]);
    assert.throws(() => Z.parseTileInfo({ tile: 1024, gutter: 4, scale: 4, maps: { s350: { w: "x" } } }, "s350"), /not a number/);
    let z = 0;
    for (let i = 0; i < 200; i++) { const n = Z.stepZoom(z, 0.8, 1 / 60); assert.ok(n >= z && n <= 0.8); z = n; }
    assert.equal(z, 0.8);
});
