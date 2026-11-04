#!/usr/bin/env node
// Say It Back: print a quest's scene (or a scene file) as plain English. --diff compares two readings.
// Reads the repo's generated data and our own effect sheets; prints text and writes nothing.
//
//   node tools/scene_readback.mjs --quest <id> --slot offer|done|accept|turnin|objective-<n> [--map <id>]
//   node tools/scene_readback.mjs --scene file.json [--diff other.json] [--json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBack, diffReadback } from "../web/quest-readback.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

/** A message for the person, not a stack trace. */
class CliError extends Error {}
const fail = (message) => { throw new CliError(message); };

const root = path.resolve(opt("root", path.join(HERE, "..")));
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

function world() {
    const manifest = readJSON("web/assets/manifest.json");
    const maps = Object.fromEntries(Object.values(manifest.maps ?? {}).map((m) => [m.id, m.name]));
    const chars = readJSON("data/authored/quests/characters.json");
    const names = Object.fromEntries(Object.entries(chars.by_npc_id ?? {}).map(([id, rec]) => [id, rec?.name ?? `npc ${id}`]));
    const sheets = {};
    const dir = path.join(root, "web/extra_fx");
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        try { sheets[file.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); } catch { /* a broken sheet reads as missing */ }
    }
    return { maps, names, sheets };
}

/** A scene file: a bare step list, a plan ({ steps }), or a scene object ({ map, steps }). */
function loadScene(file) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); } catch (e) { fail(`cannot read scene ${file}: ${e.message}`); }
    if (Array.isArray(data)) return { steps: data, mapId: opt("map") };
    return {
        steps: Array.isArray(data.steps) ? data.steps : Array.isArray(data.scene) ? data.scene : [],
        mapId: data.mapId ?? data.map ?? data.map_id ?? opt("map"),
    };
}

/** One quest's scene slot: the same slots tools/build_quests.py writes. */
function questSlot(q, slot) {
    const firstMap = q.offer?.maps?.[0] ?? q.objectives?.[0]?.maps?.[0] ?? q.unlock?.visited?.[0];
    if (slot === "offer") return { steps: q.offer?.scene, mapId: q.offer?.maps?.[0] ?? firstMap };
    if (slot === "done") return { steps: q.doneScene, mapId: firstMap };
    if (slot === "accept") return { steps: q.acceptScene, mapId: firstMap };
    if (slot === "turnin" || slot === "turn-in") return { steps: q.turnIn?.scene, mapId: firstMap };
    const m = /^objective-(\d+)$/.exec(slot ?? "");
    if (m) {
        const objective = q.objectives?.[Number(m[1])];
        return { steps: objective?.scene, mapId: objective?.maps?.[0] ?? firstMap };
    }
    return null;
}

function printReading(reading, out = console.log) {
    out(reading.title);
    out("");
    for (const block of reading.blocks) {
        const [first, ...rest] = block.text.split("\n");
        out(`${block.step}. ${first}`);
        for (const line of rest) out(line ? `   ${line}` : "");
    }
    if (reading.problems.length) {
        out("");
        out("problems:");
        for (const problem of reading.problems) out(`- ${problem}`);
    }
}

function printDiff(a, b, diff, out = console.log) {
    out(`--- ${a.title.replace(/^## /, "")}`);
    out(`+++ ${b.title.replace(/^## /, "")}`);
    for (const line of diff.lines) {
        const tag = line.type === "same" ? " " : line.type === "removed" ? "-" : "+";
        const [first, ...rest] = line.text.split("\n");
        out(`${tag} ${line.step}. ${first}`);
        for (const extra of rest) out(extra ? `${tag}    ${extra}` : tag);
    }
    out(`added ${diff.added}, removed ${diff.removed}, same ${diff.same}`);
}

function main() {
    const questId = opt("quest");
    const scenePath = opt("scene");
    if (!questId && !scenePath) fail("usage: scene_readback.mjs --quest <id> --slot <slot> | --scene file.json [--diff other.json] [--json]");

    const w = world();
    let input;
    if (scenePath) {
        input = loadScene(scenePath);
    } else {
        const data = readJSON("web/quests.json");
        const quest = (data.quests ?? []).find((q) => q.id === questId);
        if (!quest) fail(`unknown quest "${questId}"`);
        const slot = opt("slot");
        const picked = questSlot(quest, slot);
        if (!picked) fail(`unknown slot "${slot}" (use offer, done, accept, turnin or objective-<n>)`);
        if (!picked.steps) fail(`quest "${questId}" has no ${slot} scene`);
        input = picked;
    }

    const mapId = opt("map") ?? input.mapId ?? null;
    const opts = { mapId, mapName: w.maps[mapId], maps: w.maps, names: w.names, sheets: w.sheets, playerLabel: opt("player", "you") };
    const reading = readBack(input.steps, opts);

    let other = null, diff = null;
    if (flag("diff")) {
        const otherPath = opt("diff");
        if (!otherPath) fail("--diff needs the other scene file");
        const otherInput = loadScene(otherPath);
        const otherMap = otherInput.mapId ?? mapId;
        other = readBack(otherInput.steps, { ...opts, mapId: otherMap, mapName: w.maps[otherMap] });
        diff = diffReadback(reading, other);
    }

    if (flag("json")) {
        console.log(JSON.stringify(other ? { a: reading, b: other, diff } : reading, null, 2));
    } else {
        printReading(reading);
        if (other) {
            console.log("");
            printDiff(reading, other, diff);
        }
    }
    return reading.problems.length || (other && other.problems.length) ? 1 : 0;
}

try {
    process.exitCode = main();
} catch (e) {
    if (!(e instanceof CliError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
}
