// Walkable ground for quest scenes: the geometry in web/quest-walk.js, what web/quest-scenes.js does with it, and the
// build-time checker tools/check_quest_walks.mjs (fed a tiny fake tree, so the check is proven to fail what it must).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    questGrid, questRectBlocked, questStandFree, questLineClear, questRoute, questWalkLegs,
    questComponents, questReachArea, questReachable, standInSpot, STAND_IN_OFFSETS,
} from "../web/quest-walk.js";
import { compileScene } from "../web/quest-scenes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, "..", "tools", "check_quest_walks.mjs");

// A pen of 24x12 cells (192x96 px): open ground, the top row a wall, a wall column at c=12 with a gap below it
// (rows 9..11), and optionally a 3x3 free pocket (c17..19, r2..4) closed in by its own wall ring.
const W = 24, H = 12;
const POCKET = [148, 31];                                         // the cell in the middle of that pocket
function penRows({ column = true, pocket = false } = {}) {
    const rows = [];
    for (let r = 0; r < H; r++) {
        let s = "";
        for (let c = 0; c < W; c++) {
            let blocked = r === 0;
            if (column && c === 12 && r <= 8) blocked = true;
            if (pocket) {
                const inside = c >= 17 && c <= 19 && r >= 2 && r <= 4;
                const ring = (c >= 16 && c <= 20 && (r === 1 || r === 5)) || ((c === 16 || c === 20) && r >= 1 && r <= 5);
                if (ring) blocked = true;
                if (inside) blocked = false;
            }
            s += blocked ? "1" : "0";
        }
        rows.push(s);
    }
    return rows;
}
const pen = (opts) => questGrid({ cell: 8, cols: W, rows: H, blocked: penRows(opts) });

test("the foot box is the game's: 12 px wide, 8 px deep, hanging off the feet", () => {
    const g = pen();
    assert.equal(questStandFree(g, 100, 40), false);                // box 94..106 touches the wall column
    assert.equal(questStandFree(g, 108, 40), false);                // box 102..114: its left edge is in the wall
    assert.equal(questStandFree(g, 116, 40), true);                 // box 110..122: clear of it
    assert.equal(questStandFree(g, 90, 40), false);                 // box 84..96: its right edge is in the wall
    assert.equal(questStandFree(g, 80, 40), true);
    assert.equal(questStandFree(g, 40, 4), false);                  // the top row is a wall
    assert.equal(questStandFree(g, -4, 40), false);                 // off the grid is not ground
});

test("a grid reads the same in the JSON shape and in the engine's own shape", () => {
    const json = { cell: 8, cols: W, rows: H, blocked: penRows({ pocket: true }) };
    const cells = new Uint8Array(W * H);
    penRows({ pocket: true }).forEach((row, r) => { for (let c = 0; c < W; c++) if (row[c] === "1") cells[r * W + c] = 1; });
    const a = questGrid(json), b = questGrid({ cell: 8, cols: W, rows: H, cells });
    assert.equal(a.cell, b.cell);
    for (let y = 4; y < 92; y += 7)
        for (let x = 4; x < 188; x += 9) assert.equal(questStandFree(a, x, y), questStandFree(b, x, y), `${x},${y}`);
});

test("a straight line is clear only when the whole foot path is (sampled, not just the ends)", () => {
    const g = pen();
    assert.equal(questLineClear(g, 40, 40, 80, 40), true);
    assert.equal(questLineClear(g, 40, 40, 160, 40), false);        // through the wall column
    assert.equal(questLineClear(g, 40, 88, 160, 88), true);         // under the wall's gap (rows 9..11 are free)
});

test("a route goes around the wall, leg by leg, and every leg is walkable ground", () => {
    const g = pen();
    const r = questRoute(g, 40, 40, 160, 40);
    assert.ok(r, "a route exists");
    assert.equal(r.exact, true);
    assert.ok(r.legs.length > 1, `the route has legs (${JSON.stringify(r.legs)})`);
    assert.deepEqual(r.legs[r.legs.length - 1], [160, 40]);
    let [x, y] = [40, 40];
    for (const [lx, ly] of r.legs) {
        assert.equal(questLineClear(g, x, y, lx, ly), true, `leg to ${lx},${ly} crosses a wall`);
        x = lx; y = ly;
    }
});

test("a destination inside a wall stops on the closest ground instead of walking into it", () => {
    const g = pen();
    const r = questRoute(g, 40, 40, 100, 40);                      // the wall column
    assert.ok(r);
    assert.equal(r.exact, false);
    const [ex, ey] = r.legs[r.legs.length - 1];
    assert.equal(questStandFree(g, ex, ey), true);
    assert.ok(Math.hypot(ex - 100, ey - 40) < 40, "it stops near the spot, not anywhere");
});

test("a pocket nothing can walk to is walked toward, stopping on the last ground the walker can reach", () => {
    const g = pen({ pocket: true });
    const r = questRoute(g, 40, 40, POCKET[0], POCKET[1]);
    assert.ok(r, "a route is still returned: the walk goes as far as the map allows");
    assert.equal(r.exact, false);
    const [ex, ey] = r.legs[r.legs.length - 1];
    assert.equal(questStandFree(g, ex, ey), true);
    assert.ok(Math.hypot(ex - POCKET[0], ey - POCKET[1]) < 80, "it stops at the pocket's wall, not back where it came from");
    let [x, y] = [40, 40];
    for (const [lx, ly] of r.legs) {
        assert.equal(questLineClear(g, x, y, lx, ly), true, `leg to ${lx},${ly} crosses a wall`);
        x = lx; y = ly;
    }
});

test("a clear walk is one leg, exactly the target: the compiler's opcode does not change", () => {
    const g = pen();
    assert.deepEqual(questWalkLegs(g, 40, 40, 80, 40), [[80, 40]]);
    const legs = questWalkLegs(g, 40, 40, 160, 40);
    assert.ok(legs.length > 1);
});

test("compileScene routes a blocked walk and keeps the arrival facing on the last leg only", () => {
    const g = pen();
    const walk = (ax, ay, bx, by) => questWalkLegs(g, ax, ay, bx, by);
    const { opcodes, errors } = compileScene([{ walk: 27, to: [160, 40], face: "left" }], {
        playerId: 2, pos: (id) => (id === 27 ? { x: 40, y: 40 } : null), walk,
    });
    assert.deepEqual(errors, []);
    assert.equal(opcodes[0], "FN6A 1 2");
    assert.equal(opcodes[opcodes.length - 1], "END");
    const walkOps = opcodes.filter((o) => o.startsWith("WALKTO"));
    assert.ok(walkOps.length > 1, `routed into legs: ${walkOps.join(" / ")}`);
    assert.match(walkOps[walkOps.length - 1], /^WALKTO 27 160 40 2$/);   // facing 2 = left, on the last leg
    for (const op of walkOps.slice(0, -1)) assert.doesNotMatch(op, / [0-7]$/);   // no facing on the way
    // one WAITIDLE after each leg but the last, always for the walker (the caller can then rely on arrival)
    const legs = walkOps.length;
    assert.equal(opcodes.filter((o) => o === "WAITIDLE 27").length, legs - 1);
    for (let i = 0; i < opcodes.length; i++) if (opcodes[i] === "WAITIDLE 27") assert.match(opcodes[i - 1], /^WALKTO 27 /);
});

test("a walk the router cannot solve stays one straight WALKTO, so the scene never freezes", () => {
    const { opcodes, errors } = compileScene([{ walk: 27, to: [160, 40] }], {
        playerId: 2, pos: (id) => (id === 27 ? { x: 40, y: 40 } : null), walk: () => null,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(opcodes, ["FN6A 1 2", "WALKTO 27 160 40", "END"]);
});

test("a second walk of the same character is routed from where the first one left them", () => {
    const g = pen();
    const walk = (ax, ay, bx, by) => questWalkLegs(g, ax, ay, bx, by);
    const { opcodes } = compileScene([{ walk: 27, to: [80, 40] }, { walk: 27, to: [160, 88] }], {
        playerId: 2, pos: (id) => (id === 27 ? { x: 40, y: 40 } : null), walk,
    });
    const legs2 = questWalkLegs(g, 80, 40, 160, 88);
    const expected = [];
    legs2.forEach(([x, y], k) => {
        expected.push(`WALKTO 27 ${x} ${y}`);
        if (k < legs2.length - 1) expected.push("WAITIDLE 27");
    });
    assert.deepEqual(opcodes.slice(2, 2 + expected.length), expected);
    // and the route from the stale post would have been a different one
    assert.notDeepEqual(questWalkLegs(g, 40, 40, 160, 88), questWalkLegs(g, 80, 40, 160, 88));
});

test("a clear walk keeps its single WALKTO even when a router is installed", () => {
    const g = pen();
    const walk = (ax, ay, bx, by) => questWalkLegs(g, ax, ay, bx, by);
    const { opcodes } = compileScene([{ walk: 27, to: [80, 40], face: 6 }], {
        playerId: 2, pos: (id) => (id === 27 ? { x: 40, y: 40 } : null), walk,
    });
    assert.deepEqual(opcodes, ["FN6A 1 2", "WALKTO 27 80 40 6", "END"]);
});

test("a scene with no grid (no router) waves the walk through unchanged, as it always did", () => {
    const { opcodes } = compileScene([{ walk: 27, to: [160, 40] }], { playerId: 2, pos: () => ({ x: 40, y: 40 }) });
    assert.deepEqual(opcodes, ["FN6A 1 2", "WALKTO 27 160 40", "END"]);
});

test("the map's reachable area is the part the exits open onto, plus the biggest piece", () => {
    const g = pen({ pocket: true });
    const { labels, sizes } = questComponents(g);
    assert.ok(sizes.length >= 2, `the pen has more than one piece (${sizes.length})`);
    const pocketCell = Math.floor(POCKET[0] / 8) + Math.floor(POCKET[1] / 8) * W;
    const reach = questReachArea(g, [[40, 40]], []);
    assert.equal(!!reach[pocketCell], false);
    assert.equal(questReachable(g, reach, 40, 40), true);
    assert.equal(questReachable(g, reach, POCKET[0], POCKET[1]), false);
    assert.notEqual(labels[pocketCell], -1);                        // the pocket cell can be stood in: it is just sealed
});

test("a ladder links its two ends, so ground it connects counts as reachable", () => {
    const g = pen({ pocket: true });
    const [bx, by] = POCKET, [ax, ay] = [40, 40];
    const without = questReachArea(g, [[ax, ay]], []);
    assert.equal(questReachable(g, without, bx, by), false);
    const withLink = questReachArea(g, [[ax, ay]], [[[ax - 4, ay + 8], [bx - 4, by + 8]]]);
    assert.equal(questReachable(g, withLink, bx, by), true);
});

test("a stand-in stands on the post when it is clear, on a nearby nudge when it is not, else on the post", () => {
    assert.deepEqual(standInSpot({ x: 100, y: 200 }, () => true), { x: 100, y: 200 });
    const taken = (x, y) => x === 128 && y === 200;                 // only the first nudge (28 right) is clear
    assert.deepEqual(standInSpot({ x: 100, y: 200 }, taken), { x: 128, y: 200 });
    assert.equal(STAND_IN_OFFSETS[0][0], 28);                       // the nudge the game always used comes first
    assert.deepEqual(standInSpot({ x: 100.4, y: 200.6 }, () => true), { x: 100, y: 201 });
    assert.deepEqual(standInSpot({ x: 100, y: 200 }, () => false), { x: 100, y: 200 });   // nowhere better: the post
    assert.deepEqual(standInSpot({ x: 100, y: 200 }, null), { x: 100, y: 200 });
});

// ---- the build-time checker, on a tiny fake tree ---------------------------------------------------------------
function fakeTree(scene) {
    const root = mkdtempSync(join(tmpdir(), "quest-walk-"));
    mkdirSync(join(root, "web", "assets", "collision"), { recursive: true });
    mkdirSync(join(root, "web", "assets", "scenes"), { recursive: true });
    writeFileSync(join(root, "web", "assets", "collision", "s1.json"),
        JSON.stringify({ cell: 8, cols: W, rows: H, blocked: penRows() }));
    writeFileSync(join(root, "web", "assets", "collision", "s2.json"),
        JSON.stringify({ cell: 8, cols: W, rows: H, blocked: penRows({ pocket: true }) }));
    writeFileSync(join(root, "web", "assets", "scenes", "s1.json"),
        JSON.stringify({ npcs: [{ npc_id: 27, x: 40, y: 40, dir: "down" }], exits: [{ x: 24, y: 24, w: 16, h: 16, to: "s2" }] }));
    writeFileSync(join(root, "web", "assets", "scenes", "s2.json"), JSON.stringify({ npcs: [], exits: [] }));
    writeFileSync(join(root, "web", "quests.json"), JSON.stringify({
        quests: [{
            id: "fake_one", offer: { npc: 27, maps: ["s1"], lines: ["hello"], scene },
        }],
    }));
    return root;
}
const runChecker = (root) => {
    try {
        const out = execFileSync("node", [CHECKER, "--json", "--root", root], { encoding: "utf8" });
        return { status: 0, data: JSON.parse(out) };
    } catch (e) {
        return { status: e.status, data: JSON.parse(e.stdout) };
    }
};

test("the checker fails a spot on bad ground, a crossing, a warp into a wall, and a sealed spot", () => {
    const root = fakeTree([
        { walk: 27, to: [40, 40] },                                  // a no-op walk home: nothing to say about it
        { put: "player", at: [100, 40] },                            // inside the wall column
        { walk: 27, to: [160, 40] },                                 // the straight line crosses the wall
        { warp: { map: "s2", at: [POCKET[0], POCKET[1]] } },          // the sealed pocket on the next map
    ]);
    const { status, data } = runChecker(root);
    assert.equal(status, 1);
    const fails = data.problems.filter((p) => p.severity === "fail");
    assert.deepEqual(fails.map((p) => `${p.kind}:${p.what.split(" ")[0]}`).sort(),
        ["put:places", "walk:the", "warp:sends"].sort());
    assert.equal(data.problems.some((p) => p.kind === "stand"), false);   // the post itself is fine (a no-op walk)
});

test("the checker passes the same scene once every spot is real ground", () => {
    const root = fakeTree([
        { walk: 27, to: [80, 88] },
        { put: "player", at: [60, 60] },
        { walk: 27, to: [160, 88] },                                 // along the free ground under the wall
        { warp: { map: "s2", at: [40, 40] } },
    ]);
    const { status, data } = runChecker(root);
    assert.equal(status, 0, JSON.stringify(data.problems));
    assert.equal(data.problems.filter((p) => p.severity === "fail").length, 0);
    assert.ok(data.checked >= 3);
});

test("a walk whose place depends on the player is counted as skipped, not guessed at", () => {
    const root = fakeTree([{ walk: 27, to: { near: "player", gap: 40 } }, { walk: 27, to: [80, 40] }]);
    const { data } = runChecker(root);
    assert.equal(data.skipped, 1);
    assert.equal(data.problems.filter((p) => p.severity === "fail").length, 0);
});
