#!/usr/bin/env node
// Build-time check: a quest scene never puts a character on, or through, unwalkable ground.
//
//   node tools/check_quest_walks.mjs          human lines, exit 1 when something is wrong
//   node tools/check_quest_walks.mjs --json   the same as one JSON object (tools/check_quests.py reads this)
//
// Reads web/quests.json (build it first: tools/build_quests.py), web/assets/collision/<map>.json, the scene files (for
// where each character stands) and web/extra_npcs.json (the quests' own characters). The geometry is web/quest-walk.js,
// the module the game itself routes scripted walks with, so the checker and the runtime agree on what walkable means.
//
// What it checks, per scene step that names a place (see ~/scratch-research/quest-fx2/WALK.md):
//   * walk / put / warp / drop / rise / chase: the spot is on ground a foot box can stand on;
//   * walk: the straight line the cutscene VM would take does not cross a wall, and the spot is reachable from where the
//     character stands (the runtime routes crossings; a crossing is still reported, because the scene then takes a
//     different path than the author wrote);
//   * warp: the arrival spot is reachable from the new map's own exits;
//   * every character the scene moves: their own standing spot is not sealed off from the map's exits.
// A step whose place depends on where the PLAYER happens to stand ({ "near": "player" }) cannot be resolved without
// running the game; those are counted as skipped (the runtime routes them instead).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import {
    questGrid, questStandFree, questLineClear, questCellFree, questComponents, questReachArea, questReachable,
} from "../web/quest-walk.js";
import { castOf } from "../web/quest-scenes.js";

// --root <dir>: read another tree (the tests build a tiny one to prove the checker fails what it should)
const rootArg = process.argv.indexOf("--root");
const ROOT = rootArg > 0 ? resolvePath(process.argv[rootArg + 1]) : join(dirname(fileURLToPath(import.meta.url)), "..");
const A = join(ROOT, "web", "assets");
const load = (p) => JSON.parse(readFileSync(p, "utf8"));

const grids = new Map();          // map id -> grid | null
const reaches = new Map();        // map id -> reach byte mask
function gridOf(map) {
    if (!grids.has(map)) {
        const p = join(A, "collision", `${map}.json`);
        grids.set(map, existsSync(p) ? questGrid(load(p)) : null);
    }
    return grids.get(map);
}
function reachesOf(map) {
    if (!reaches.has(map)) {
        const g = gridOf(map);
        if (!g) { reaches.set(map, null); return null; }
        const p = join(A, "scenes", `${map}.json`);
        const sc = existsSync(p) ? load(p) : {};
        const seeds = (sc.exits || []).map((e) => [e.x + e.w / 2, e.y + (e.h ?? 0) / 2]);
        // a ladder joins its two ends; a door joins the ground on either side of its own column
        const links = [];
        for (const l of sc.ladders || []) {
            if (l.bottom && l.top) links.push([[l.bottom.x, l.bottom.y], [l.top.x, l.top.y]]);
        }
        for (const d of sc.doors || []) {
            const c = Math.floor(d.x / g.cell);
            for (let r = Math.floor(d.y1 / g.cell); r <= Math.floor(d.y2 / g.cell); r++) {
                links.push([[c * g.cell - g.cell / 2 - 1, r * g.cell + g.cell - 1], [(c + 1) * g.cell + g.cell / 2 + 1, r * g.cell + g.cell - 1]]);
            }
        }
        reaches.set(map, questReachArea(g, seeds, links));
    }
    return reaches.get(map);
}

// ---- where the characters stand ----------------------------------------------------------------------------------
const posts = new Map();          // map -> Map(npc id -> [{x, y}])
const postsOf = (map) => {
    if (!posts.has(map)) {
        const out = new Map();
        const p = join(A, "scenes", `${map}.json`);
        if (existsSync(p)) {
            for (const n of load(p).npcs || []) {
                if (!n.x && !n.y) continue;                     // a scripted-only record has no place on the map
                if (!out.has(n.npc_id)) out.set(n.npc_id, []);
                out.get(n.npc_id).push({ x: n.x, y: n.y });
            }
        }
        posts.set(map, out);
    }
    return posts.get(map);
};
const extra = join(ROOT, "web", "extra_npcs.json");
if (existsSync(extra)) {
    for (const r of load(extra).residents || []) {
        const map = r.map;
        if (!posts.has(map)) postsOf(map);
        const m = posts.get(map);
        if (!m.has(r.npc_id)) m.set(r.npc_id, []);
        m.get(r.npc_id).push({ x: r.x, y: r.y });
    }
}

const quests = load(join(ROOT, "web", "quests.json")).quests;
const problems = [];
let scenes = 0, steps = 0, checked = 0, skipped = 0, mapsWithoutGrid = 0;

const add = (severity, q, where, step, kind, map, x, y, what) =>
    problems.push({ severity, quest: q, where, step, kind, map, x: Math.round(x), y: Math.round(y), what });

/** The scenes a quest owns: where they sit in the data, which maps they can run on, and what they are called. */
function questScenes(q) {
    const out = [];
    const home = q.offer?.maps ?? [];
    if (q.offer?.scene) out.push({ where: "offer.scene", scene: q.offer.scene, maps: home });
    if (q.acceptScene) out.push({ where: "acceptScene", scene: q.acceptScene, maps: home });
    if (q.doneScene) out.push({ where: "doneScene", scene: q.doneScene, maps: q.turnIn?.maps ?? home });
    (q.objectives || []).forEach((o, i) => {
        if (o.scene) out.push({ where: `objective ${i + 1} scene`, scene: o.scene, maps: o.maps ?? [] });
    });
    return out;
}

/** The place a walk's `to` / `at` names, resolved the way web/quest-scenes.js compileScene resolves it. */
function resolve(to, actor, at) {
    if (Array.isArray(to) && to.length === 2 && to.every((n) => Number.isFinite(Number(n)))) return [Number(to[0]), Number(to[1])];
    if (to === "origin") {
        const p = at(actor);
        return p ? [p.x, p.y] : null;
    }
    if (to && typeof to === "object" && "near" in to) {
        const p = at(to.near);
        if (!p) return null;
        if (to.gap != null) {
            const w = at(actor);
            if (!w) return null;
            const vx = p.x - w.x, vy = p.y - w.y, len = Math.hypot(vx, vy) || 1, gap = Number(to.gap) || 34;
            return [p.x - (vx / len) * gap, p.y - (vy / len) * gap];
        }
        return [p.x + (Number(to.dx) || 0), p.y + (Number(to.dy) || 0)];
    }
    return null;
}

const componentAt = (grid, comps, x, y) => {
    const c = Math.floor(x / grid.cell), r = Math.floor(y / grid.cell);
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return -1;
    return comps.labels[r * grid.cols + c];
};

function checkScene(q, where, scene, map) {
    const grid = gridOf(map);
    if (!grid) { mapsWithoutGrid++; return false; }
    const reach = reachesOf(map);
    const comps = questComponents(grid);
    const cast = castOf(scene);
    // the scene only plays on a map where every character it names really stands (game.js playQuestScene)
    if (cast.some((id) => !(postsOf(map).get(id) || []).length)) return false;
    const here = new Map(cast.map((id) => [id, (postsOf(map).get(id) || [])[0] ?? null]));
    const at = (who) => (who === "player" ? player : here.get(Number(who)) ?? null);
    let player = null;                                     // the player's place is only known after a `put`
    scenes++;
    for (let i = 0; i < scene.length; i++) {
        const s = scene[i];
        if (!s || typeof s !== "object") continue;
        const number = i + 1;
        steps++;
        const kind = Object.keys(s)[0];
        if ("put" in s) {
            if (!Array.isArray(s.at) || s.at.length !== 2) continue;
            const [x, y] = [Number(s.at[0]), Number(s.at[1])];
            if (s.put === "player") player = { x, y }; else here.set(Number(s.put), { x, y });
            checked++;
            if (!questStandFree(grid, x, y)) add("fail", q, where, number, "put", map, x, y, "places a character on ground they cannot stand on");
            else if (!questReachable(grid, reach, x, y)) add("fail", q, where, number, "put", map, x, y, "places a character in a sealed pocket nothing can walk to");
        } else if ("walk" in s) {
            const dest = resolve(s.to, s.walk, at);
            if (!dest) { skipped++; continue; }
            checked++;
            const [x, y] = dest;
            const start = at(s.walk);
            // a walk to where the character already stands (face, apart at home, a step back) moves nobody, so it cannot
            // put anyone on bad ground: the posts the game's own NPCs stand on are often a counter or a door cell.
            const still = start && Math.hypot(start.x - x, start.y - y) <= 2;
            if (!still) {
                if (!questStandFree(grid, x, y)) {
                    add("fail", q, where, number, "walk", map, x, y, "walks a character onto ground they cannot stand on");
                } else if (start) {
                    const from = componentAt(grid, comps, start.x, start.y);
                    const to = componentAt(grid, comps, x, y);
                    if (!questLineClear(grid, start.x, start.y, x, y)) {
                        add(from === to ? "fail" : "fail", q, where, number, "walk", map, x, y,
                            from === to ? "the straight walk crosses a wall (the runtime routes around it)" : "the spot cannot be walked to from where the character stands");
                    }
                }
            }
            here.set(Number(s.walk), { x, y });
        } else if ("chase" in s) {
            const path = Array.isArray(s.path) ? s.path : [];
            for (let k = 0; k < path.length; k++) {
                const [x, y] = [Number(path[k][0]), Number(path[k][1])];
                checked++;
                if (!questStandFree(grid, x, y)) add("fail", q, where, number, "chase", map, x, y, `path point ${k + 1} is inside a wall`);
                else if (k && !questLineClear(grid, Number(path[k - 1][0]), Number(path[k - 1][1]), x, y))
                    add("fail", q, where, number, "chase", map, x, y, `the run from point ${k} to point ${k + 1} crosses a wall`);
            }
        } else if ("warp" in s) {
            const w = s.warp && typeof s.warp === "object" ? s.warp : {};
            const to = typeof s.warp === "string" ? s.warp : w.map ?? w.to ?? w.screen ?? null;
            const spot = Array.isArray(w.at) ? w.at : Array.isArray(s.at) ? s.at : null;
            if (!spot || to == null) continue;
            const target = String(to);
            const g2 = gridOf(target);
            checked++;
            if (!g2) { mapsWithoutGrid++; continue; }
            const [x, y] = [Number(spot[0]), Number(spot[1])];
            if (!questStandFree(g2, x, y)) add("fail", q, where, number, "warp", target, x, y, "sends the player onto ground they cannot stand on");
            else if (!questReachable(g2, reachesOf(target), x, y)) add("fail", q, where, number, "warp", target, x, y, "sends the player into a sealed pocket nothing can walk to");
        } else if ("drop" in s || "rise" in s) {
            if (!player) { skipped++; continue; }
            const px = Math.abs(Number(("drop" in s) ? s.drop : s.rise)) * (("drop" in s) ? 1 : -1);
            checked++;
            if (!questStandFree(grid, player.x, player.y + px))
                add("fail", q, where, number, "drop", map, player.x, player.y + px, "lands the player on ground they cannot stand on");
            player = { x: player.x, y: player.y + px };
        }
    }
    // A character the scene moves should not stand in a pocket nothing can walk to. This is a NOTE, never a failure: the
    // maps of the original reach some rooms by stairs, ladders and scripted moves this grid walk cannot see.
    for (const [id, p] of here) {
        if (!p) continue;
        checked++;
        if (!questReachable(grid, reach, p.x, p.y, 6))
            add("note", q, where, 0, "stand", map, p.x, p.y, `character ${id} stands in a pocket this walk cannot reach from the map's exits`);
    }
    return true;
}

for (const q of quests) {
    for (const { where, scene, maps } of questScenes(q)) {
        if (!Array.isArray(scene) || !scene.length) continue;
        for (const map of maps) if (typeof map === "string") checkScene(q.id, where, scene, map);
    }
    // a prop the player bumps into (props[].solid) stands on the map's ground: it is art standing at its feet, and a
    // solid one also becomes an obstacle where the player walks
    for (const [i, p] of (q.props || []).entries()) {
        if (!p || p.solid !== true) continue;
        const grid = gridOf(p.map);
        if (!grid || !Array.isArray(p.at)) continue;
        checked++;
        if (!questStandFree(grid, Number(p.at[0]), Number(p.at[1])))
            add("fail", q.id, `props[${i}]`, 0, "prop", p.map, Number(p.at[0]), Number(p.at[1]), "a solid prop stands on ground the player cannot stand on");
    }
}

const fails = problems.filter((p) => p.severity === "fail");
if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ quests: quests.length, scenes, steps, checked, skipped, maps_without_collision: mapsWithoutGrid, problems }));
} else {
    for (const p of problems) {
        console.log(`${p.severity.toUpperCase()}: ${p.quest}: ${p.where}${p.step ? ` step ${p.step}` : ""} (${p.kind}) on ${p.map} at (${p.x},${p.y}): ${p.what}`);
    }
    console.log(`${scenes} scene run(s) on ${new Set(problems.map((p) => p.map)).size ? "" : ""}${quests.length} quests checked: ${checked} place(s) checked, ${skipped} skipped (the player's own place)`
        + `${mapsWithoutGrid ? `, ${mapsWithoutGrid} map(s) without collision data` : ""}`);
    console.log(fails.length ? `${fails.length} problem(s)` : "OK");
}
process.exit(fails.length ? 1 : 0);
