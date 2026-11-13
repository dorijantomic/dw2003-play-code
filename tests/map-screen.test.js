// The new map screen (web/map-screen-model.js, web/map-screen-book.js): regions, links, the visited rule, layout, cursor, and the OPTIONS row.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { regionOf, buildLinks, buildGraph, regionView, openRegions, layoutNodes, nearestInDirection, createMapScreenModel } from "../web/map-screen-model.js";
import { createMapScreenBook, MAP_BOX } from "../web/map-screen-book.js";
import { buildRows, PAGES } from "../web/options-model.js";

const D = " — ";
const MAPS = [
    { id: "s1", name: `North${D}A` }, { id: "s2", name: `North${D}B` }, { id: "s3", name: `North${D}C` }, { id: "s4", name: `North${D}D` },
    { id: "s5", name: `South${D}E` }, { id: "s6", name: `South${D}F` }, { id: "s7", name: "Lonely" },
];
const SCENES = {
    s1: { exits: [{ to: "s2" }, { to: "s1" }, { to: "s999" }], warps: [{ stage: 5 }] },
    s2: { exits: [{ to: "s1" }, { to: "s3" }] },
    s3: { exits: [{ to: "s4" }] },
    s5: { exits: [{ to: "s6" }] },
};
const seenOf = (...ids) => (id) => ids.includes(id);

test("the region is the part of the name before the long dash", () => {
    assert.equal(regionOf(`Central Sector${D}Asuka City`), "Central Sector");
    assert.equal(regionOf("Lonely"), "Lonely");
    assert.equal(regionOf(undefined), "");
});

test("links come from exits and warps, both ways, once; self links and unknown maps are dropped", () => {
    const links = [...buildLinks(MAPS, SCENES)].sort();
    assert.deepEqual(links, ["s1|s2", "s1|s5", "s2|s3", "s3|s4", "s5|s6"]);
});

test("the graph groups maps by region in manifest order", () => {
    const g = buildGraph(MAPS, SCENES);
    assert.deepEqual(g.regions.map((r) => [r.name, r.ids.length]), [["North", 4], ["South", 2], ["Lonely", 1]]);
    assert.equal(g.regionIndex("s5"), 1);
    assert.deepEqual(g.neighbours("s2").sort(), ["s1", "s3"]);
    assert.equal(g.nameOf("s3"), `North${D}C`);
});

test("a region shows visited areas plus the unvisited ones beside them as ???, only within the region", () => {
    const g = buildGraph(MAPS, SCENES);
    const v = regionView(g, 0, seenOf("s1"), "s1");
    assert.deepEqual(v.nodes, [{ id: "s1", seen: true }, { id: "s2", seen: false }], "s5 is a link to another region: not drawn here; s3, s4 are not beside a visited area");
    assert.deepEqual(v.edges, [["s1", "s2"]]);
    assert.deepEqual([v.visited, v.total], [1, 4]);
    const w = regionView(g, 0, seenOf("s1", "s2"), "s1");
    assert.deepEqual(w.nodes.map((n) => [n.id, n.seen]), [["s1", true], ["s2", true], ["s3", false]]);
});

test("the current map counts as visited even when its flag is not set; regions with nothing visited are not listed", () => {
    const g = buildGraph(MAPS, SCENES);
    assert.deepEqual(openRegions(g, seenOf(), "s5"), [1]);
    assert.deepEqual(openRegions(g, seenOf("s1", "s7"), "s5"), [0, 1, 2]);
    assert.deepEqual(openRegions(g, seenOf(), "nowhere"), []);
});

test("the layout keeps every box inside the area and no two boxes touch, up to a star of 40 areas", () => {
    for (const n of [1, 2, 5, 12, 40]) {
        const nodes = [{ id: "c", seen: true }, ...Array.from({ length: n - 1 }, (_, i) => ({ id: `n${i}`, seen: i % 2 === 0 }))];
        const edges = nodes.slice(1).map((x) => ["c", x.id]);
        const pos = layoutNodes({ nodes, edges }, "c", MAP_BOX.w, MAP_BOX.h);
        assert.equal(pos.size, n);
        const pts = [...pos.values()];
        for (const p of pts) assert.ok(p.x >= 4 && p.x <= MAP_BOX.w - 4 && p.y >= 4 && p.y <= MAP_BOX.h - 4, `inside for ${n}`);
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
            assert.ok(Math.abs(pts[i].x - pts[j].x) >= 8 || Math.abs(pts[i].y - pts[j].y) >= 8, `no overlap for ${n}`);
        }
    }
    assert.equal(layoutNodes({ nodes: [], edges: [] }, null, 252, 94).size, 0);
});

test("the layout is the same every time and the root sits in the first column", () => {
    const view = regionView(buildGraph(MAPS, SCENES), 0, seenOf("s1", "s2", "s3"), "s2");
    const a = layoutNodes(view, "s2", 252, 94), b = layoutNodes(view, "s2", 252, 94);
    assert.deepEqual([...a], [...b]);
    const xs = [...a.values()].map((p) => p.x);
    assert.equal(a.get("s2").x, Math.min(...xs));
});

test("nearestInDirection picks the box that way, or null", () => {
    const pos = new Map([["a", { x: 10, y: 10 }], ["b", { x: 50, y: 10 }], ["c", { x: 10, y: 40 }], ["d", { x: 90, y: 12 }]]);
    assert.equal(nearestInDirection(pos, "a", "right"), "b");
    assert.equal(nearestInDirection(pos, "a", "down"), "c");
    assert.equal(nearestInDirection(pos, "a", "left"), null);
    assert.equal(nearestInDirection(pos, "b", "right"), "d");
    assert.equal(nearestInDirection(pos, "ghost", "up"), null);
});

const model = (seen, current) => createMapScreenModel({ maps: MAPS, scenes: SCENES, seen: seenOf(...seen), currentId: current });

test("the model opens on the current map's region with the cursor on it, and names stay hidden until visited", () => {
    const m = model(["s1"], "s1");
    assert.equal(m.regionName(), "North");
    assert.equal(m.cursor(), "s1");
    assert.equal(m.help(), `North${D}A (You are here)`);
    assert.equal(m.move("right"), "move");                  // the layout puts s2 (???) one column on
    assert.equal(m.selected().name, "???");
    assert.equal(m.help(), "???");
    assert.equal(m.move("right"), null, "nothing further that way");
});

test("moving the cursor reaches every shown box; regions switch with prev / next and stop at the ends", () => {
    const m = model(["s1", "s2", "s5"], "s1");
    assert.deepEqual([m.regionName(), m.count()], ["North", 2]);
    assert.equal(m.switchRegion(-1), null);
    assert.equal(m.switchRegion(1), "move");
    assert.equal(m.regionName(), "South");
    assert.equal(m.cursor(), "s5");
    assert.equal(m.switchRegion(1), null);
    assert.deepEqual(m.progress(), { visited: 1, total: 2 });
    const n = model(["s1", "s2", "s3"], "s1");
    const reached = new Set([n.cursor()]);
    for (let i = 0; i < 6; i++) if (n.move("right")) reached.add(n.cursor());   // a chain s1 - s2 - s3 - s4(???), one box per column
    assert.deepEqual([...reached].sort(), n.nodes().map((x) => x.id).sort());
});

test("a player with no visited area gets an empty screen that still answers every key", () => {
    const m = model([], "nowhere");
    assert.equal(m.count(), 0);
    assert.equal(m.help(), "No area visited yet.");
    assert.equal(m.move("up"), null);
    assert.equal(m.switchRegion(1), null);
});

function fakeCtx() {
    return new Proxy({}, { get: (_t, n) => (n === "measureText" ? () => ({ width: 10 }) : () => {}), set: () => true });
}
const keys = (...k) => new Set(k);

test("the book: Back leaves, arrows and Q / E move with a sound only when something moved, and it draws folded, half open and open", () => {
    const sounds = [];
    const book = createMapScreenBook({ sfx: { play: (n) => sounds.push(n) }, data: () => ({ maps: MAPS, scenes: SCENES, seen: seenOf("s1", "s2", "s5"), currentId: "s1" }) });
    assert.equal(book.act(keys("cross")), "back");
    assert.equal(book.act(keys("left")), null);
    assert.deepEqual(sounds, []);
    book.act(keys("right"));
    book.act(keys("r1"));
    assert.deepEqual(sounds, ["system02", "system02"]);
    assert.equal(book.model.regionName(), "South");
    for (const p of [0, 0.5, 1]) book.draw(fakeCtx(), { progress: () => p, ticks: 3, dt: 0.016 });
    const empty = createMapScreenBook({ data: () => ({ maps: MAPS, scenes: SCENES, seen: seenOf(), currentId: "nowhere" }) });
    empty.draw(fakeCtx(), { progress: () => 1, ticks: 0, dt: 0 });
});

test("OPTIONS has one Map screen row on the GAME page: Classic is the default and New is the other choice", () => {
    const rows = buildRows();
    assert.ok(PAGES[0].rows.includes("mapScreen"));
    const fx = {};
    const store = { get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) };
    assert.deepEqual(rows.mapScreen.choices, ["Classic", "New"]);
    assert.equal(rows.mapScreen.read(store), 0, "nothing saved reads Classic");
    rows.mapScreen.write(store, 1);
    assert.equal(fx.mapScreen, "new");
    assert.equal(rows.mapScreen.read(store), 1);
    const amb = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
    assert.match(amb, /fx\.mapScreen = "classic";/);
});

test("the wiring: the pause list's MAP page result opens the book only when the row says New", () => {
    const st = readFileSync(new URL("../web/status-translated.js", import.meta.url), "utf8");
    assert.match(st, /result\.page === "map" && opts\.newMapScreen\?\.\(\)/);
    const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
    assert.match(game, /newMapScreen: \(\) => window\.__fx\?\.mapScreen === "new"/);
    assert.match(game, /mapscreen: \(args\) => createMapScreenBook\(/);
});
