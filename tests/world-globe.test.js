// The world-globe layout (web/world-globe-layout.js): every open-air map placed once, no overlaps beyond a small tolerance,
// linked maps adjacent. A small synthetic world always runs; the real data (web/assets) runs when it is there.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
    buildWorld, buildPlaces, nearestSide, overlaps, adjacent, fitWorld, textureSize, worldToTex, texToWorld, hitTest,
    OVERLAP_TOL,
} from "../web/world-globe-layout.js";
import { isOpenAirMapName } from "../web/map-open-air.js";

const D = " — ";
// Three open-air maps in a row (A east exit -> B -> C), a twin of A (renamed), and one interior map behind a door of B.
const MAPS = [
    { id: "s330", name: `Central Sector${D}Central Park`, width: 1000, height: 800 },
    { id: "s331", name: `Central Sector${D}Central Park`, width: 1000, height: 800 },
    { id: "s335", name: `Central Sector${D}Wire Forest Entrance`, width: 600, height: 700 },
    { id: "s350", name: `East Sector${D}West Wire Forest`, width: 1200, height: 600 },
    { id: "s1000", name: `Central Sector${D}Some House`, width: 320, height: 240 },
    { id: "s1001", name: `Central Sector${D}Some House Upstairs`, width: 320, height: 240 },
    { id: "s780", name: `Kusanagi City${D}Street Corner`, width: 640, height: 384 },
];
const ex = (x, y, w, h, to, spawnX, spawnY) => ({ x, y, w, h, to, spawnX, spawnY });
const SCENES = {
    s330: { exits: [ex(940, 380, 40, 64, "s335", 60, 300), ex(400, 300, 64, 64, "s1000", 100, 200)] },
    s331: { exits: [ex(940, 380, 40, 64, "s335", 60, 300), ex(400, 300, 64, 64, "s1000", 100, 200)] },
    s335: { exits: [ex(20, 280, 40, 64, "s330", 930, 410), ex(300, 640, 64, 40, "s350", 200, 60)] },
    s350: { exits: [ex(200, 20, 64, 40, "s335", 330, 640)] },
    s1000: { exits: [ex(20, 20, 40, 40, "s330", 430, 360), ex(100, 100, 40, 40, "s1001", 50, 50)] },
    s1001: { exits: [ex(20, 20, 40, 40, "s1000", 120, 120)] },
    s780: { exits: [] },
};

test("nearestSide: the closest edge and how far (0..0.5)", () => {
    assert.deepEqual(nearestSide(990, 400, 1000, 800), { side: "E", score: 0.01 });
    assert.equal(nearestSide(500, 10, 1000, 800).side, "N");
    assert.equal(nearestSide(5, 400, 1000, 800).side, "W");
    assert.equal(nearestSide(500, 790, 1000, 800).side, "S");
});

test("overlap and adjacency tolerances", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    assert.equal(overlaps(a, { x: 100, y: 0, w: 100, h: 100 }), false);          // flush
    assert.equal(overlaps(a, { x: 100 - OVERLAP_TOL, y: 0, w: 100, h: 100 }), false);
    assert.equal(overlaps(a, { x: 50, y: 50, w: 100, h: 100 }), true);
    assert.equal(adjacent(a, { x: 100, y: 40, w: 50, h: 50 }), true);
    assert.equal(adjacent(a, { x: 100, y: 200, w: 50, h: 50 }), false);          // corner-far
    assert.equal(adjacent(a, { x: 300, y: 0, w: 50, h: 50 }), false);
});

test("synthetic world: twins merge, B east of A, C south of B, exit meets spawn, interior becomes a pin", () => {
    const w = buildWorld({ maps: MAPS, scenes: SCENES, variants: {} });
    const by = Object.fromEntries(w.places.map((p) => [p.key, p]));
    assert.equal(w.places.length, 4, "s330+s331 are one place; s335, s350, s780 each one");
    assert.deepEqual(by.s330.ids, ["s330", "s331"]);
    assert.equal(w.stats.overlaps, 0);
    // s335 east of s330: flush on x, exit (960,412) meets spawn (60,300): y = 412 - 300
    assert.equal(by.s335.x, by.s330.x + 1000);
    assert.equal(by.s335.y - by.s330.y, 112);
    // s350 south of s335 (exit on its S edge), exit (332,660) meets spawn (200,60): x = 332 - 200
    assert.equal(by.s350.y, by.s335.y + 700);
    assert.equal(by.s350.x - by.s335.x, 132);
    assert.equal(w.stats.treeAdjacent, w.stats.treeEdges);
    // one pin on Central Park holding both interior maps (house + upstairs), at the door centre
    assert.equal(w.pins.length, 1);
    assert.deepEqual(w.pins[0].ids.sort(), ["s1000", "s1001"]);
    assert.equal(w.pins[0].placeKey, "s330");
    assert.deepEqual([w.pins[0].x, w.pins[0].y], [432, 332]);
    // Kusanagi City has no link and no sector side: outside the others
    assert.equal(w.places.filter((p) => overlaps(p, by.s780)).length, 1);
});

test("synthetic world: a blocked slot slides along the edge, still touching", () => {
    const maps = [
        { id: "s330", name: `Central Sector${D}Central Park`, width: 1000, height: 800 },
        { id: "s335", name: `Central Sector${D}Wire Forest Entrance`, width: 600, height: 700 },
        { id: "s340", name: `Central Sector${D}Shell Beach`, width: 640, height: 700 },
    ];
    // both want the same east slot of s330 at the same height
    const scenes = {
        s330: { exits: [ex(940, 380, 40, 64, "s335", 60, 300), ex(940, 400, 40, 64, "s340", 60, 300)] },
        s335: { exits: [ex(20, 280, 40, 64, "s330", 930, 410)] },
        s340: { exits: [ex(20, 300, 40, 64, "s330", 930, 430)] },
    };
    const w = buildWorld({ maps, scenes });
    assert.equal(w.stats.overlaps, 0);
    assert.equal(w.stats.linksAdjacent, 2);
});

test("fit / texture size / pixel maths round-trip", () => {
    const bounds = { x: 0, y: 0, w: 21128, h: 14950 };
    const t = textureSize(bounds);
    assert.equal(t.w, 8192);
    assert.equal(t.h, 4096);
    const fit = fitWorld(bounds, t.w, t.h);
    assert.ok(fit.scale < 1 && bounds.w * fit.scale <= t.w && bounds.h * fit.scale <= t.h);
    const p = worldToTex(fit, 1234, 5678), q = texToWorld(fit, p.x, p.y);
    assert.ok(Math.abs(q.x - 1234) < 1e-6 && Math.abs(q.y - 5678) < 1e-6);
    assert.equal(textureSize({ x: 0, y: 0, w: 900, h: 400 }).w, 1024);
});

test("hitTest finds the place and the nearest pin", () => {
    const w = buildWorld({ maps: MAPS, scenes: SCENES, variants: {} });
    const a = w.places.find((p) => p.key === "s330");
    const inside = hitTest(w, a.x + 10, a.y + 10);
    assert.equal(inside.place.key, "s330");
    assert.equal(inside.pin, null);
    const pin = w.pins[0];
    assert.equal(hitTest(w, pin.wx + 3, pin.wy - 3).pin, pin);
    assert.equal(hitTest(w, -50, -50).place, null);
});

const HAVE = existsSync(new URL("../web/assets/manifest.json", import.meta.url)) && existsSync(new URL("../web/assets/scenes/s200.json", import.meta.url));
test("real data: every open-air map placed, no overlaps, linked maps adjacent", { skip: !HAVE && "web/assets not present" }, () => {
    const read = (p) => JSON.parse(readFileSync(new URL(`../web/${p}`, import.meta.url), "utf8"));
    const maps = read("assets/manifest.json").maps;
    const variants = read("map-variants.json");
    const scenes = {};
    for (const m of maps) scenes[m.id] = read(`assets/scenes/${m.id}.json`);
    const w = buildWorld({ maps, scenes, variants });
    const open = maps.filter((m) => isOpenAirMapName(m.name));
    // every open-air map belongs to exactly one placed place
    const placed = new Map();
    for (const p of w.places) for (const id of p.ids) { assert.ok(!placed.has(id), `${id} twice`); placed.set(id, p); }
    for (const m of open) {
        const p = placed.get(m.id);
        assert.ok(p, `${m.id} ${m.name} is not placed`);
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0, `${m.id} has no position`);
        assert.ok(isOpenAirMapName(m.name));
    }
    assert.equal(placed.size, open.length);
    // interior maps are never drawn
    for (const m of maps) if (!isOpenAirMapName(m.name)) assert.ok(!placed.has(m.id), `${m.id} interior was placed`);
    // no overlaps beyond the tolerance
    for (let i = 0; i < w.places.length; i++) for (let j = i + 1; j < w.places.length; j++)
        assert.ok(!overlaps(w.places[i], w.places[j]), `${w.places[i].key} overlaps ${w.places[j].key}`);
    assert.equal(w.stats.overlaps, 0);
    // linked maps adjacent: every open-air link is touching, allowing the few that a crowded slot pushed apart (counted, small)
    const apart = w.links.filter((l) => !l.adjacent);
    assert.ok(w.links.length >= 30, `only ${w.links.length} links`);
    assert.ok(apart.length <= Math.ceil(w.links.length * 0.1), `${apart.length} of ${w.links.length} links not adjacent: ${apart.map((l) => `${l.a}-${l.b}`)}`);
    // the pinned interior maps lie on their place
    for (const pin of w.pins) {
        const p = w.places.find((q) => q.key === pin.placeKey);
        assert.ok(pin.x >= 0 && pin.x <= p.w && pin.y >= 0 && pin.y <= p.h, `pin of ${pin.placeKey} off the picture`);
        assert.ok(pin.names.length > 0);
    }
    assert.ok(w.pins.length >= 20);
    // the 8192 cap holds
    assert.ok(textureSize(w.bounds, 8192).w <= 8192);
});
