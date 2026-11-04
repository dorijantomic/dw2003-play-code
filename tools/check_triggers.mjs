#!/usr/bin/env node
// Build-time check: a walk-in quest trigger (web/quest-triggers.js) names a real map, a patch of ground the player can
// actually walk into, a scene that compiles, and characters who stand on that map.
//
//   node tools/check_triggers.mjs          human lines, exit 1 when something is wrong
//   node tools/check_triggers.mjs --json   the same as one JSON object (tests and tools read this)
//   node tools/check_triggers.mjs --root <dir>   read another tree (the tests build a tiny one to prove the failures)
//
// It reads the AUTHORED source data/authored/quests/triggers.json (which holds drafts too) and, when the built
// web/quests.json carries a triggers list, that as well: the game only ever sees the built one, and both must be sound.
// The geometry is web/quest-walk.js, the module the game itself measures ground with, so the checker and the field agree
// on what standable means. What is checked, per trigger:
//   * map    — a stage id in web/assets/manifest.json with collision data;
//   * rect   — [x, y, width, height] in whole pixels, at least one standable cell inside it;
//   * centre — walkable, or a standable cell within two cells of it (a patch may sit a step off the walkway);
//   * scene  — compiles with no errors (web/quest-scenes.js validateScene);
//   * cast   — every character the scene names stands on that map (the scene files plus web/extra_npcs.json residents);
//   * gate   — when.quest/status, if present, names one of the layer's four statuses.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { questGrid, questCellFree, questStandFree, questFreeCellNear } from "../web/quest-walk.js";
import { castOf, validateScene } from "../web/quest-scenes.js";
import { TRIGGER_STATUSES } from "../web/quest-triggers.js";

const rootArg = process.argv.indexOf("--root");
const ROOT = rootArg > 0 ? resolvePath(process.argv[rootArg + 1]) : join(dirname(fileURLToPath(import.meta.url)), "..");
const A = join(ROOT, "web", "assets");
const load = (p) => JSON.parse(readFileSync(p, "utf8"));

const problems = [];
const add = (source, t, what) => problems.push({ severity: "fail", source, id: t?.id ?? "?", map: t?.map ?? null, what });

// ---- the two sources: what authors write, and what the game actually loads ------------------------------------------
const sources = [];
const authored = join(ROOT, "data", "authored", "quests", "triggers.json");
if (existsSync(authored)) sources.push(["authored", load(authored).triggers ?? []]);
const built = join(ROOT, "web", "quests.json");
if (existsSync(built)) {
    const data = load(built);
    if (Array.isArray(data.triggers)) sources.push(["built", data.triggers]);
}

// ---- the map's own data --------------------------------------------------------------------------------------------
const manifest = existsSync(join(A, "manifest.json")) ? load(join(A, "manifest.json")) : { maps: [] };
const mapIds = new Set((manifest.maps ?? []).map((m) => m.id));
const grids = new Map();
function gridOf(map) {
    if (!grids.has(map)) {
        const p = join(A, "collision", `${map}.json`);
        grids.set(map, existsSync(p) ? questGrid(load(p)) : null);
    }
    return grids.get(map);
}
// every character who really stands on a map: the scene's own records with a field position, plus the quests' own
// characters (web/extra_npcs.json residents). A record with no position is scripted-only and cannot be seen on the map.
const posts = new Map();
function postsOf(map) {
    if (!posts.has(map)) {
        const set = new Set();
        const p = join(A, "scenes", `${map}.json`);
        if (existsSync(p)) {
            for (const n of load(p).npcs ?? []) if ((n.x || n.y) && !n.cutsceneOnly) set.add(n.npc_id);
        }
        posts.set(map, set);
    }
    return posts.get(map);
}
const extra = join(ROOT, "web", "extra_npcs.json");
if (existsSync(extra)) {
    for (const r of load(extra).residents ?? []) {
        if (!posts.has(r.map)) postsOf(r.map);
        posts.get(r.map).add(r.npc_id);
    }
}

// ---- the check -----------------------------------------------------------------------------------------------------
let checked = 0;
for (const [source, list] of sources) {
    const seen = new Set();
    for (const t of list) {
        if (!t || typeof t !== "object" || Array.isArray(t)) { add(source, null, "is not an object"); continue; }
        if (typeof t.id !== "string" || !t.id) add(source, t, "needs an id (the fired mark is kept by it)");
        else if (seen.has(t.id)) add(source, t, `duplicate id "${t.id}"`);
        else seen.add(t.id);
        if (t.once != null && typeof t.once !== "boolean") add(source, t, 'once must be true or false');
        if (t.draft != null && typeof t.draft !== "boolean") add(source, t, 'draft must be true or false');
        if (t.when != null) {
            if (!t.when || typeof t.when !== "object" || typeof t.when.quest !== "string" || !t.when.quest)
                add(source, t, "when needs a quest id");
            else if (!TRIGGER_STATUSES.includes(t.when.status))
                add(source, t, `when.status is ${JSON.stringify(t.when.status)}; use one of ${TRIGGER_STATUSES.join(", ")}`);
        }
        if (!Array.isArray(t.scene) || !t.scene.length) { add(source, t, "has no scene"); continue; }
        const sceneErrors = validateScene(t.scene);
        if (sceneErrors.length) add(source, t, `the scene does not compile: ${sceneErrors.join("; ")}`);
        checked++;
        if (typeof t.map !== "string" || !mapIds.has(t.map)) { add(source, t, `map ${JSON.stringify(t.map)} is not in web/assets/manifest.json`); continue; }
        const rect = t.rect;
        if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) || rect[2] <= 0 || rect[3] <= 0) {
            add(source, t, "rect must be [x, y, width, height] with a positive width and height");
            continue;
        }
        const grid = gridOf(t.map);
        if (!grid) { add(source, t, `${t.map} has no collision data (web/assets/collision/${t.map}.json)`); continue; }
        const [x, y, w, h] = rect;
        // at least one standable cell inside the rectangle
        let standable = 0;
        const c0 = Math.floor(x / grid.cell), r0 = Math.floor(y / grid.cell);
        const c1 = Math.floor((x + w - 1) / grid.cell), r1 = Math.floor((y + h - 1) / grid.cell);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (questCellFree(grid, c, r)) standable++;
        if (!standable) add(source, t, "the rectangle holds no standable cell");
        // the centre, or a standable cell within two cells of it
        const cx = x + w / 2, cy = y + h / 2;
        if (!questStandFree(grid, cx, cy) && !questFreeCellNear(grid, cx, cy, 2))
            add(source, t, `the centre (${Math.round(cx)},${Math.round(cy)}) is not walkable and no standable cell is within 2 cells`);
        // every character the scene names stands on this map, or the scene can never play there
        for (const id of castOf(t.scene)) {
            if (!postsOf(t.map).has(id)) add(source, t, `npc ${id} does not stand on ${t.map}`);
        }
    }
}

const fails = problems.filter((p) => p.severity === "fail");
if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ sources: sources.map(([name, list]) => [name, list.length]), checked, problems }));
} else {
    for (const p of problems) console.log(`${p.severity.toUpperCase()}: ${p.source} ${p.id}${p.map ? ` on ${p.map}` : ""}: ${p.what}`);
    console.log(`${checked} trigger(s) checked from ${sources.map(([name, list]) => `${list.length} ${name}`).join(" + ") || "nothing"}`);
    console.log(fails.length ? `${fails.length} problem(s)` : "OK");
}
process.exit(fails.length ? 1 : 0);
