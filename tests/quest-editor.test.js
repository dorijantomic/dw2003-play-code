// Quest editor (web/quest-editor.html): saved data is walkable ground, a named path compiles into the expected walk legs,
// and scene steps without `path` compile exactly as they did before the editor existed.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { questGrid, questWalkLegs } from "../web/quest-walk.js";
import { checkData, snapPoint, walkable, pathLegs, DIRS } from "../web/quest-editor-lib.js";

const mod = await import(process.env.QS_MODULE ?? "../web/quest-scenes.js");     // QS_MODULE: compare another copy of the compiler
const { compileScene } = mod;
const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

const gridCache = new Map();
const gridOf = (id) => {
    if (!gridCache.has(id)) {
        const f = new URL(`../web/assets/collision/${id}.json`, import.meta.url);
        gridCache.set(id, /^s\d+$/.test(id) && existsSync(f) ? questGrid(JSON.parse(readFileSync(f, "utf8"))) : null);
    }
    return gridCache.get(id);
};

// A pen of 24x12 cells (192x96 px), the top row a wall, a wall column at c=12 with a gap below it (rows 9..11): the same
// shape tests/quest-walk.test.js routes around.
function pen() {
    const rows = [];
    for (let r = 0; r < 12; r++) {
        let s = "";
        for (let c = 0; c < 24; c++) s += r === 0 || (c === 12 && r <= 8) ? "1" : "0";
        rows.push(s);
    }
    return questGrid({ cell: 8, cols: 24, rows: 12, blocked: rows });
}

test("every saved resident stands on walkable ground, facing a real direction, and the game's copy matches", () => {
    const src = read("../data/authored/quests/new_characters.json");
    const problems = checkData({ characters: src.characters, paths: {} }, gridOf);
    assert.deepEqual(problems, []);
    const total = src.characters.reduce((n, c) => n + c.residents.length, 0);
    assert.ok(total >= 1, "there are residents to check");
    // web/extra_npcs.json is what the game reads: built from exactly these residents
    const built = read("../web/extra_npcs.json").residents;
    const want = src.characters.flatMap((c) => c.residents.map((r) => ({ npc_id: c.npc_id, ...r })));
    assert.deepEqual(built, want);
    // the mirrors the installer makes
    assert.deepEqual(read("../quests/new_characters.json").characters.map((c) => c.residents), src.characters.map((c) => c.residents));
    for (const r of want) assert.ok(DIRS.includes(r.dir));
});

test("every saved path point is walkable, every leg between points can be walked, and the game's copy matches", () => {
    const src = read("../data/authored/quests/quest-paths.json");
    assert.deepEqual(checkData({ characters: [], paths: src.paths }, gridOf), []);
    assert.deepEqual(read("../web/quest-paths.json").paths, src.paths);
    assert.deepEqual(read("../quests/quest-paths.json").paths, src.paths);
});

test("the checker refuses a resident or path point on a wall and a path with no way between points", () => {
    const g = pen();
    const gridFor = (id) => (id === "pen" ? g : null);
    const wall = [100, 40];                                           // inside the wall column
    assert.equal(walkable(g, wall[0], wall[1]), false);
    const bad = checkData({
        characters: [{ npc_id: 1000, name: "T", residents: [{ map: "pen", x: wall[0], y: wall[1], dir: "down" }, { map: "nowhere", x: 1, y: 1, dir: "down" }] }],
        paths: { bad_path: { map: "pen", points: [[40, 40], [wall[0], wall[1]]] }, "Bad Name": { map: "pen", points: [[40, 40]] } },
    }, gridFor);
    assert.equal(bad.length, 4, bad.join(" | "));
    assert.ok(bad.some((m) => /not walkable ground/.test(m) && /T on pen/.test(m)));
    assert.ok(bad.some((m) => /no walk data for map nowhere/.test(m)));
    assert.ok(bad.some((m) => /point 2/.test(m)));
    assert.ok(bad.some((m) => /lower-case/.test(m)));
    const ok = checkData({ characters: [{ npc_id: 1000, name: "T", residents: [{ map: "pen", x: 40, y: 40, dir: "up" }] }], paths: { good: { map: "pen", points: [[40, 40], [160, 40]] } } }, gridFor);
    assert.deepEqual(ok, []);
});

test("a dropped point snaps to the nearest walkable spot within 24 px, and is refused further away", () => {
    const g = pen();
    const p = snapPoint(g, 100, 40);                                  // in the wall column: some walkable spot beside it
    assert.ok(p && walkable(g, p[0], p[1]) && Math.hypot(p[0] - 100, p[1] - 40) <= 30);
    assert.deepEqual(snapPoint(g, 40, 40), [40, 40]);                 // already walkable: untouched
    assert.equal(snapPoint(g, 5000, 5000), null);                     // off the map: refused
});

test("a named path compiles into its points in order, each leg routed round the wall, waited out before the next", () => {
    const g = pen();
    const walk = (ax, ay, bx, by) => questWalkLegs(g, ax, ay, bx, by);
    const points = [[40, 40], [160, 40], [160, 80]];                  // the 2nd point is across the wall column
    const paths = { park_leomon_to_gate: { map: "pen", points } };
    const pos = (id) => (id === 27 ? { x: 40, y: 80 } : null);
    const { opcodes, errors } = compileScene([{ walk: 27, path: "park_leomon_to_gate", face: "left" }], { playerId: 2, pos, walk, paths });
    assert.deepEqual(errors, []);
    // expected by hand: the legs the router gives for each hop, a WAITIDLE after every leg but the very last, facing on the last
    const expected = ["FN6A 1 2"];
    let at = [40, 80];
    points.forEach((p, k) => {
        const legs = questWalkLegs(g, at[0], at[1], p[0], p[1]);
        assert.ok(legs && legs.length >= 1);
        legs.forEach((leg, j) => {
            const lastLeg = j === legs.length - 1, lastPoint = k === points.length - 1;
            expected.push(`WALKTO 27 ${leg[0]} ${leg[1]}${lastLeg && lastPoint ? " 2" : ""}`);
            if (!(lastLeg && lastPoint)) expected.push("WAITIDLE 27");
        });
        at = p;
    });
    expected.push("END");
    assert.deepEqual(opcodes, expected);
    assert.ok(opcodes.filter((o) => o.startsWith("WALKTO")).length > points.length, "the hop across the wall column became several legs");
    // the editor draws exactly these legs
    assert.deepEqual(pathLegs(g, points), [questWalkLegs(g, 40, 40, 160, 40), questWalkLegs(g, 160, 40, 160, 80)]);
});

test("a named path with no router is one WALKTO per point, and an unknown or empty path is an error, not a hang", () => {
    const paths = { two: [[10, 20], [30, 40]] };
    const { opcodes, errors } = compileScene([{ walk: 27, path: "two" }], { playerId: 2, pos: () => ({ x: 0, y: 0 }), paths });
    assert.deepEqual(errors, []);
    assert.deepEqual(opcodes, ["FN6A 1 2", "WALKTO 27 10 20", "WAITIDLE 27", "WALKTO 27 30 40", "END"]);
    assert.equal(compileScene([{ walk: 27, path: "nope" }], { playerId: 2, pos: () => ({ x: 0, y: 0 }), paths }).errors.length, 1);
    assert.equal(compileScene([{ walk: 27, path: "two" }], { playerId: 2, pos: () => ({ x: 0, y: 0 }) }).errors.length, 1);
    assert.equal(compileScene([{ walk: 27 }], { playerId: 2, pos: () => ({ x: 0, y: 0 }), paths }).errors.length, 1);   // neither to nor path
});

// Steps without `path` must compile byte for byte as before. The digest below is of every shipped scene compiled with the
// compiler as it was before `path` existed (git HEAD of web/quest-scenes.js, 2026-11-03), once with a wall router and once
// without. QS_PRINT=1 prints the current digest; QS_MODULE=<file> measures another copy of the compiler.
test("scenes without a path compile byte-identical to the compiler before the editor", () => {
    const g = pen();
    const router = (ax, ay, bx, by) => questWalkLegs(g, ax, ay, bx, by);
    const quests = read("../web/quests.json").quests;
    const pos = (id) => ({ x: 20 + ((id * 37) % 150), y: 30 + ((id * 53) % 60) });
    const h = createHash("sha256");
    let scenes = 0, steps = 0;
    for (const q of quests) {
        for (const sc of [q.offer?.scene, q.acceptScene, q.doneScene, q.turnIn?.scene, ...q.objectives.map((o) => o.scene)]) {
            if (!sc) continue;
            scenes++; steps += sc.length;
            for (const opts of [{ playerId: 2, pos, walk: router }, { playerId: 1, pos }]) {
                h.update(JSON.stringify(compileScene(sc, opts)));
            }
        }
    }
    const digest = `${scenes}:${steps}:${h.digest("hex")}`;
    if (process.env.QS_PRINT) console.log("QS_DIGEST " + digest);
    assert.equal(digest, GOLDEN);
});

const GOLDEN = "472:4267:8b996adbf1b64c397fe03af4a11d8fb714964e3488f6544d7091acea6884a464";
