// World Globe reveal (web/world-globe-reveal.js, rules read in web/menu/pure.js mapGlobeReveal): the disc MAP page's reveal
// tier from the story ordinal, its area list per server and tier, the mist over the areas not in the list (on the real
// reveal mask, at each area's deepest point taken from the globe files' own area runs, not from the mask), the fade of a
// newly revealed area, icons shown only when visited (your own place always), and the zoom going only into shown places.
// Synthetic cases always run; the real data (web/assets) runs when it is there.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { decodePng } from "./helpers/png.js";

if (typeof globalThis.localStorage === "undefined") {
    const mem = Object.create(null);
    globalThis.localStorage = {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
    };
}
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

const R = await import("../web/world-globe-reveal.js");
const G = await import("../web/world-globe-map.js");
const Z = await import("../web/world-globe-zoom.js");
const { mapRevealTier, mapTierThresholds, mapRevealAreas, mapGlobeReveal, mapVisitedRecords, mapSeenFlag, mapMarkerRecord } = await import("../web/menu/pure.js");

const UI_FILE = "web/assets/data/status_ui.json";
const GLOBE_DIR = "web/assets/world-globe";
const MASK_FILE = `${GLOBE_DIR}/${R.REVEAL.maskFile}`;
const SERVERS = ["asuka", "amaterasu"];
const haveUi = existsSync(UI_FILE);
const haveGlobe = haveUi && SERVERS.every((s) => existsSync(`${GLOBE_DIR}/${s}.json`));
const haveMask = haveGlobe && existsSync(MASK_FILE);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const ui = haveUi ? readJson(UI_FILE) : null;

// ---- tier and area lists ----

test("tier from the story ordinal: thresholds 7 / 15 / 27 / 30 (0x7 / 0xF / 0x1B / 0x1E)", () => {
    const want = { 6: 0, 7: 1, 14: 1, 15: 2, 26: 2, 27: 3, 29: 3, 30: 4 };
    for (const [ord, tier] of Object.entries(want)) assert.equal(mapRevealTier(Number(ord), [7, 15, 27, 30]), tier, `ordinal ${ord}`);
});

test("status_ui.json holds those thresholds, and the tier from it is the same", { skip: !haveUi }, () => {
    assert.deepEqual(mapTierThresholds(ui), [0x7, 0xf, 0x1b, 0x1e]);
    const want = { 6: 0, 7: 1, 14: 1, 15: 2, 26: 2, 27: 3, 29: 3, 30: 4 };
    for (const [ord, tier] of Object.entries(want)) {
        assert.equal(mapRevealTier(Number(ord), mapTierThresholds(ui)), tier, `ordinal ${ord}`);
        assert.equal(mapGlobeReveal({ progressOrdinal: Number(ord) }, null, ui).tier, tier, `reveal tier at ordinal ${ord}`);
    }
});

test("each server's revealed areas = tier_area_lists[server * 5 + tier] for every tier", { skip: !haveUi }, () => {
    const lists = ui.screens.map.tier_area_lists;
    const ordOfTier = [0, 7, 15, 27, 30];
    for (let tier = 0; tier <= 4; tier++) {
        const r = mapGlobeReveal({ progressOrdinal: ordOfTier[tier] }, null, ui);
        assert.equal(r.tier, tier);
        assert.deepEqual(r.areas.asuka, lists[tier], `Asuka tier ${tier}`);
        assert.deepEqual(r.areas.amaterasu, lists[5 + tier], `Amaterasu tier ${tier}`);
        assert.deepEqual(mapRevealAreas(0, tier, ui), lists[tier]);
        assert.deepEqual(mapRevealAreas(1, tier, ui), lists[5 + tier]);
        assert.deepEqual([r.fadeIn.asuka, r.fadeIn.amaterasu], [[], []], "no last tier: nothing fades");
    }
});

test("a tier rise since the last open fades in exactly the new areas; the same or a lower tier fades nothing", { skip: !haveUi }, () => {
    const lists = ui.screens.map.tier_area_lists;
    const r = mapGlobeReveal({ progressOrdinal: 15 }, 1, ui);
    assert.deepEqual(r.fadeIn.asuka, lists[2].filter((a) => !lists[1].includes(a)));
    assert.deepEqual(r.fadeIn.amaterasu, lists[7].filter((a) => !lists[6].includes(a)));
    assert.ok(r.fadeIn.asuka.length > 0);
    assert.deepEqual(mapGlobeReveal({ progressOrdinal: 15 }, 2, ui).fadeIn, { asuka: [], amaterasu: [] });
    assert.deepEqual(mapGlobeReveal({ progressOrdinal: 15 }, 4, ui).fadeIn, { asuka: [], amaterasu: [] });
});

test("fade: a newly revealed area goes 0 -> 1 over REVEAL.fadeSec (1.5 s), the others are clear at once, the rest 0", () => {
    const none = { asuka: [], amaterasu: [] };
    const rv = { tier: 2, areas: { asuka: [1, 2], amaterasu: [3] }, visited: none, fadeIn: { asuka: [2], amaterasu: [] }, all: false };
    const at = (sec) => R.revealValues(rv, sec);
    assert.equal(R.REVEAL.fadeSec, 1.5);
    assert.equal(at(0)[R.revealId("asuka", 2)], 0);
    assert.ok(Math.abs(at(0.75)[R.revealId("asuka", 2)] - 0.5) < 1e-6);
    assert.equal(at(1.5)[R.revealId("asuka", 2)], 1);
    assert.equal(at(99)[R.revealId("asuka", 2)], 1);
    for (const sec of [0, 0.75, 1.5]) {
        assert.equal(at(sec)[R.revealId("asuka", 1)], 1);
        assert.equal(at(sec)[R.revealId("amaterasu", 3)], 1);
        assert.equal(at(sec)[R.revealId("asuka", 3)], 0);
        assert.equal(at(sec)[R.revealId("amaterasu", 1)], 0);
        assert.equal(at(sec)[0], 1, "id 0 = no area: never mist");
    }
    assert.ok(R.revealValues(R.revealAll(), 0).every((v) => v === 1), "show all: everything clear");
});

test("mist opacity: none at amount 0, at least 0.94 at amount 1, whatever the noise", () => {
    for (const n of [0, 0.25, 0.5, 0.75, 1]) {
        assert.equal(R.mistAlpha(0, n), 0);
        assert.ok(R.mistAlpha(1, n) >= R.REVEAL.alphaFloor && R.mistAlpha(1, n) <= 1);
    }
});

// ---- the real mask ----

/** each area's deepest point (frame px) from the globe file's own runs: the px of the area (topmost in draw order) farthest
 *  (chamfer 3-4) from any px that is not that area */
function deepestPoints(data) {
    const W = data.frameW, H = data.frameH, lab = new Int32Array(W * H);
    for (const a of data.areas) for (const [y, x0, x1] of a.runs) for (let x = x0; x < x1; x++) lab[y * W + x] = a.area;
    const out = new Map();
    for (const a of data.areas) {
        const d = new Float64Array(W * H);
        for (let i = 0; i < W * H; i++) d[i] = lab[i] === a.area ? 1e9 : 0;
        const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
        }
        for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
            const i = y * W + x;
            if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
        }
        let best = -1, bi = -1;
        for (let i = 0; i < W * H; i++) if (d[i] > best) { best = d[i]; bi = i; }
        out.set(a.area, { x: (bi % W) + 0.5, y: Math.floor(bi / W) + 0.5, depthPx: best / 3 });
    }
    return out;
}

const mask = haveMask ? (() => {
    const png = decodePng(readFileSync(MASK_FILE));
    const data = new Uint8Array(png.width * png.height * 4);
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) data.set(png.at(x, y), (y * png.width + x) * 4);
    return { w: png.width, h: png.height, data };
})() : null;
const continents = haveGlobe ? SERVERS.map((s) => {
    const data = G.parseGlobeMap(readJson(`${GLOBE_DIR}/${s}.json`));
    return { data, band: G.continentBand(data), deep: deepestPoints(data) };
}) : [];

test("the mask is REVEAL.maskW x maskH and every one of the 22 areas of both servers covers texels", { skip: !haveMask }, () => {
    assert.deepEqual([mask.w, mask.h], [R.REVEAL.maskW, R.REVEAL.maskH]);
    const cover = new Map();
    for (let i = 0; i < mask.w * mask.h; i++) {
        const d = mask.data;
        if (d[i * 4 + 3] > 127) cover.set(d[i * 4], (cover.get(d[i * 4]) ?? 0) + 1);
        assert.ok(d[i * 4] < R.REVEAL_SLOTS && d[i * 4 + 1] < R.REVEAL_SLOTS, "ids in range");
    }
    for (const s of SERVERS) for (let a = 1; a <= 22; a++) {
        const n = cover.get(R.revealId(s, a)) ?? 0;
        assert.ok(n > 500, `${s} area ${a}: ${n} texels with weight > 0.5`);
    }
});

test("mist at each area's deepest point: covered (> 0.9) when not in the tier's list, clear (< 0.1) when listed, every tier", { skip: !haveMask }, () => {
    const lists = ui.screens.map.tier_area_lists, ordOfTier = [0, 7, 15, 27, 30];
    let checked = 0;
    for (let tier = 0; tier <= 4; tier++) {
        const rv = mapGlobeReveal({ progressOrdinal: ordOfTier[tier] }, null, ui);
        const values = R.revealValues(rv, Infinity);
        for (const [si, c] of continents.entries()) {
            const listed = new Set(lists[si * 5 + tier]);
            for (const [area, p] of c.deep) {
                assert.ok(p.depthPx >= 2, `${c.data.server} area ${area}: deepest point only ${p.depthPx} px inside`);
                const uv = G.lonLatToUv(G.frameToLonLat(c.band, p.x, p.y));
                const m = R.mistAt(mask, values, uv.u, uv.v);
                const lo = R.mistAlpha(m, 0), hi = R.mistAlpha(m, 1);
                const where = `${c.data.server} area ${area} tier ${tier} (m ${m.toFixed(3)})`;
                if (listed.has(area)) assert.ok(hi < 0.1, `${where}: listed but mist ${hi}`);
                else assert.ok(lo > 0.9, `${where}: not listed but mist only ${lo}`);
                checked++;
            }
        }
        // show all: clear everywhere
        const all = R.revealValues(R.revealAll(), 0);
        for (const c of continents) for (const [, p] of c.deep) {
            const uv = G.lonLatToUv(G.frameToLonLat(c.band, p.x, p.y));
            assert.ok(R.mistAlpha(R.mistAt(mask, all, uv.u, uv.v), 1) < 0.1);
        }
    }
    assert.equal(checked, 5 * 2 * 22);
});

test("open sea far from every area has no mist", { skip: !haveMask }, () => {
    const none = R.revealValues({ tier: 0, areas: { asuka: [], amaterasu: [] }, visited: { asuka: [], amaterasu: [] }, fadeIn: { asuka: [], amaterasu: [] }, all: false }, 0);
    for (const ll of [{ lon: Math.PI / 2, lat: 0 }, { lon: -Math.PI / 2, lat: 0 }, { lon: 0, lat: 1.3 }, { lon: Math.PI, lat: -1.3 }]) {
        const uv = G.lonLatToUv(ll);
        assert.equal(R.mistAt(mask, none, uv.u, uv.v), 0);
    }
});

// ---- icons and zoom ----

test("an icon shows iff its place is visited, and your own place always", { skip: !haveGlobe }, () => {
    const walker = ui.screens.map.walker_map;
    const rowOf = (stage) => walker[String(Number(stage.slice(1)))];
    const visitedStages = ["s202", "s405"], ownStage = "s350";
    const flags = new Set(visitedStages.map((s) => mapSeenFlag(rowOf(s).ps1)));
    const state = { manifest: { maps: [{ id: ownStage }] }, mapIdx: 0, progressOrdinal: 0 };
    const hasFlag = (id) => flags.has(id);
    const r = mapGlobeReveal(state, null, ui, hasFlag);
    const serverOf = (row) => SERVERS[row.server];
    const want = { asuka: new Set(), amaterasu: new Set() };
    for (const row of Object.values(walker)) {
        if (flags.has(mapSeenFlag(row.ps1)) || row.ps1 === rowOf(ownStage).ps1) want[serverOf(row)].add(mapMarkerRecord(row.loc));
    }
    for (const s of SERVERS) {
        assert.deepEqual(new Set(r.visited[s]), want[s], `${s} visited records`);
        assert.deepEqual(mapVisitedRecords(state, SERVERS.indexOf(s), ui, hasFlag), want[s]);
    }
    const ownRow = rowOf(ownStage), own = { server: serverOf(ownRow), record: mapMarkerRecord(ownRow.loc) };
    let shown = 0, hidden = 0;
    for (const c of continents) for (const m of c.data.markers) {
        const vis = want[c.data.server].has(m.loc) || (own.server === c.data.server && own.record === m.loc);
        assert.equal(R.iconShown(r, c.data.server, m.loc, own), vis, `${c.data.server} record ${m.loc}`);
        if (vis) shown++; else hidden++;
    }
    assert.ok(shown >= 2 && hidden > 60, `${shown} shown, ${hidden} hidden`);
    // your own place shows even when its flag is clear and it is not in the visited list
    const bare = { ...r, visited: { asuka: [], amaterasu: [] } };
    assert.equal(R.iconShown(bare, own.server, own.record, own), true);
    assert.equal(R.iconShown(bare, own.server, own.record, null), false);
    assert.equal(R.iconShown(R.revealAll(), "amaterasu", 30, null), true, "show all");
});

test("the zoom target is the nearest SHOWN icon: an unvisited place nearer the centre is skipped", () => {
    const t = (record, lon, lat) => ({ key: `asuka:${record}`, server: "asuka", record, lonLat: { lon, lat }, iconRadius: 0.01 });
    const targets = [t(5, 0, 0), t(6, 0.15, 0.05), t(7, -0.3, 0)];
    const cam = Z.zoomCamera({ lon: 0, lat: 0 }, 0);
    assert.equal(Z.nearestTarget(cam, targets), 0, "all shown: the one in the centre");
    assert.equal(Z.nearestTarget(cam, targets, (i) => i !== 0), 1, "centre one hidden: the next shown one");
    assert.equal(Z.nearestTarget(cam, targets, () => false), -1, "none shown: no target");
    // through the view steps (a turn retargets)
    const env = { targets, home: -1, aspect: 16 / 9, fovDeg: Z.ZOOM.fovDeg, ready: () => true, shown: (i) => i !== 0 };
    let v = Z.startZoomView({ lon: 0, lat: 0 }, -1);
    v = Z.turnView(v, 0.001, 0, env, 1);
    assert.equal(v.target, 1);
    v = Z.zoomView(v, 1, env);
    assert.equal(v.target, 1, "zooming in goes into the shown place");
    assert.ok(Math.abs(v.look.lon - 0.15) < 1e-6, "and the look point is pulled onto it");
});
