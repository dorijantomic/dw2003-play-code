// Replay the robot's pause map inside the walker's translated pause pages and compare.
//
// The robot (tools/windows-rig/pause-explorer.lua) names each original screen by the
// fields of its live pause objects. The translated session keeps the same object layout
// (routine at +0x48, children at +0x20/+0x24, the same field offsets), so the same key
// can be read from it. For every robot screen inside a page this tool:
//   1. opens a PauseRootSession on that page, then loads the save-context block read
//      from the same save (money, party order, bag, worn counts, partner records);
//   2. replays the robot's buttons after the Cross that opened the page, with the disc's
//      face-button rotation (physical Cross is the confirm bit): Cross->circle,
//      Triangle->cross, Circle->triangle;
//   3. waits until the page fields hold still for SETTLE frames, as the robot does;
//   4. compares the page fields, the wait of the last press and its sounds.
//
//   node tools/compare_pause_map.mjs <run>/explore <save-context.hex> [--out <dir>] [--codes <gameshark.txt>]
// --codes applies the same GameShark lines the robot applied (game_driver.py explore --codes).
//
// The robot's run and the save block are observations of one save; so is this result.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PauseRootSession } from "../engine/dw3/ui/pause-root-session.ts";
import { pauseResources, pauseSeed } from "../tests/helpers/pause-resources.js";

const SETTLE = 30;
const MAX_FRAMES = 900;
const HOLD = 4;
// The browser adapter (web/status-translated.js) feeds each press one frame late, as the
// console does. PXP_PAD_DELAY=0 compares the bare session instead.
const PAD_DELAY = Number(process.env.PXP_PAD_DELAY ?? 1);
const ROWS = ["items", "sort", "map", "techniques", "status", "cardfolders"];
const PAGE_OF_ROW = { items: "items", sort: "sort", map: "map", techniques: "techniques", status: "status",
    cardfolders: "card_folders" };
// Flag bank 0x20 (ids 0x2000-0x21ff) is the bit array D0x8004B3C0
// (docs/research/scripting/get-flag-banked-predicate-system.md). The MAP page asks it
// which areas are seen; the browser answers from the walker's flags, this tool from the save.
const BANK_20 = 0x8004b3c0;
const bitOrder = process.env.PXP_BIT_ORDER === "msb" ? "msb" : "lsb";
function seenFromSave(save) {
    return (flagId) => {
        const i = flagId & 0x1ff, at = BANK_20 + (i >> 3) - save.base;
        if (at < 0 || at >= save.bytes.length) return false;
        const bit = bitOrder === "lsb" ? (i & 7) : 7 - (i & 7);
        return ((save.bytes[at] >> bit) & 1) === 1;
    };
}
const PHYSICAL = { Cross: "circle", Triangle: "cross", Circle: "triangle", Square: "square", Up: "up",
    Down: "down", Left: "left", Right: "right", L1: "l1", R1: "r1", L2: "l2", R2: "r2", Start: "start",
    Select: "select" };

export function loadSpec() {
    const dir = mkdtempSync(join(tmpdir(), "pxp-spec-"));
    execFileSync("python3", ["tools/build_pause_explorer_spec.py", "--out", join(dir, "spec.lua"),
        "--json", join(dir, "spec.json")]);
    return JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
}

const lines = (path) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

export function parseKey(key) {
    const out = {};
    for (const part of key.split("|")) {
        const at = part.indexOf("=");
        out[part.slice(0, at)] = part.slice(at + 1);
    }
    return out;
}

export function readSaveContext(path) {
    const [head, hex] = readFileSync(path, "utf8").trim().split("\n");
    const base = parseInt(/BASE ([0-9a-f]+)/.exec(head)[1], 16);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return { base, bytes };
}

/** GameShark 30/80/50 lines as (address, width, value) writes, as game_driver.py expands them. */
export function gamesharkPokes(text) {
    const out = [];
    let repeat = null;
    for (const raw of text.split("\n")) {
        const line = raw.split("#")[0].trim();
        if (!line) continue;
        const m = /^([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{4})$/.exec(line);
        if (!m) throw new Error(`Not a GameShark line: ${raw}`);
        const code = parseInt(m[1], 16) >>> 0, value = parseInt(m[2], 16);
        const kind = code >>> 24;
        if (kind === 0x50) { repeat = [(code >>> 8) & 0xff, code & 0xff, value]; continue; }
        if (kind !== 0x30 && kind !== 0x80) throw new Error(`Unsupported GameShark code: ${raw}`);
        const width = kind === 0x30 ? 1 : 2, addr = (0x80000000 | (code & 0xffffff)) >>> 0;
        const [count, step, inc] = repeat ?? [1, 0, 0];
        for (let i = 0; i < count; i++) out.push([addr + i * step, width, (value + i * inc) & (width === 1 ? 0xff : 0xffff)]);
        repeat = null;
    }
    return out;
}

/** Apply writes to the save block where they fall inside it (the rest are outside the pause's data). */
export function applyPokes(save, pokes) {
    for (const [addr, width, value] of pokes) {
        const at = addr - save.base;
        if (at < 0 || at + width > save.bytes.length) continue;
        save.bytes[at] = value & 0xff;
        if (width === 2) save.bytes[at + 1] = (value >> 8) & 0xff;
    }
}

/** The page a path opens and the buttons after it, following the list's clamped cursor. */
export function splitPath(path, rowCount = 5) {
    let row = 0;
    for (let i = 0; i < path.length; i++) {
        const b = path[i];
        if (i === 0) { if (b !== "Start") return null; continue; }
        if (b === "Up") row = Math.max(0, row - 1);
        else if (b === "Down") row = Math.min(rowCount - 1, row + 1);
        else if (b === "Cross") return { page: ROWS[row], row, rest: path.slice(i + 1) };
        else return null;
    }
    return null;
}

/** One `name=v,v,...` part per live page object, in the robot's text form. */
function pageParts(session, spec) {
    const parts = {};
    const pageHandlers = new Set(spec.pages.map((p) => p.handler));
    // A page whose child array holds another live page waits in one step (as in the robot).
    const hasChild = (address) => {
        const n = session.mem.read32(address + 0x20) >>> 0, arr = session.mem.read32(address + 0x24) >>> 0;
        for (let i = 0; i < n && i < 256; i++) {
            const child = session.tree.tasks.get(session.mem.read32(arr + i * 4) >>> 0);
            if (child && pageHandlers.has(child.classId)) return true;
        }
        return false;
    };
    for (const page of spec.pages) {
        if (page.name === "top") continue;
        for (const [address, task] of session.tree.tasks) {
            if (task.classId !== page.handler) continue;
            let fields = page.name !== "host" && hasChild(address) ? page.fields.slice(0, 2) : page.fields;
            for (const n of spec.narrow ?? []) {
                if (n.page === page.name && fields.length > n.keep
                    && (session.mem.read32(address + n.when_offset) >>> 0) === n.when_value) fields = fields.slice(0, n.keep);
            }
            const vals = fields.map((off) => (session.mem.read32(address + off) >>> 0).toString(16));
            for (const d of spec.derived ?? []) {
                if (d.page !== page.name || (session.mem.read32(address + d.when_offset) >>> 0) !== d.when_value) continue;
                const id = session.mem.read32(address + d.offset) >>> 0;
                let kind = "0";
                if (id > 0 && id < 0x1000) {
                    const desc = session.mem.read32(d.table + id * d.stride) >>> 0;
                    if (desc >= 0x80000000 && desc < 0x80200000 && desc % 4 === 0) {
                        kind = d.bytes.map((off) => session.mem.read8(desc + off).toString(16)).join(".");
                    }
                }
                vals.push("k" + kind);
            }
            parts[page.name] = vals.join(",");
        }
    }
    return parts;
}

const partsText = (parts) => Object.keys(parts).sort().map((k) => `${k}=${parts[k]}`).join("|");

function settle(session, spec, sounds, buttons = []) {
    let last = partsText(pageParts(session, spec));
    let stable = 0, lastChange = null, frame = 0;
    const heard = [];
    while (frame < MAX_FRAMES && !session.finished()) {
        const before = sounds.length;
        const at = frame - PAD_DELAY;
        session.tick(at >= 0 && at < buttons.length ? buttons[at] : []);
        frame++;
        heard.push(...sounds.slice(before));
        const now = partsText(pageParts(session, spec));
        if (now !== last) { last = now; stable = 0; lastChange = frame; }
        else if (frame > buttons.length + PAD_DELAY && ++stable >= SETTLE) break;
    }
    return { parts: pageParts(session, spec), settled: stable >= SETTLE, lastChange, finished: session.finished(),
        sounds: heard.map((id) => (id >>> 0).toString(16)) };
}

export function compare(folder, savePath, spec = loadSpec(), language = 2, codes = null) {
    const nodes = lines(join(folder, "nodes.jsonl"));
    const edges = lines(join(folder, "edges.jsonl"));
    const keys = new Map(lines(join(folder, "keys.jsonl")).map((k) => [k.id, k.key]));
    const save = readSaveContext(savePath);
    if (codes) applyPokes(save, gamesharkPokes(readFileSync(codes, "utf8")));
    const pageNames = new Set(spec.pages.map((p) => p.name).filter((n) => n !== "top"));
    const results = [];
    for (const node of nodes) {
        // The walker makes the same save change from the same presses; PXP_WORLD=1 compares those screens too.
        if (node.world_changed && process.env.PXP_WORLD !== "1") continue;
        // Five rows, or six once CARD FOLDERS is unlocked (the variant cell the key carries).
        const split = splitPath(node.path, parseKey(node.key).variant === "1" ? 6 : 5);
        if (!split) continue;
        const robot = parseKey(node.key);
        const robotParts = Object.fromEntries(Object.entries(robot).filter(([k]) => pageNames.has(k)));
        // Left the page again; PXP_CLOSE=1 checks that the walker's page closes on the same press.
        const left = !robotParts[PAGE_OF_ROW[split.page]];
        if (left && process.env.PXP_CLOSE !== "1") continue;
        const sounds = [];
        const session = new PauseRootSession(language, pauseSeed(split.page, { inventory: [], mapSeen: seenFromSave(save) }),
            pauseResources(language), { playSound: (id) => sounds.push(id) });
        session.mem.load(save.bytes, save.base);
        let step = settle(session, spec, sounds);
        for (const b of split.rest) {
            if (step.finished) break;
            const pad = PHYSICAL[b];
            step = settle(session, spec, sounds, Array.from({ length: HOLD }, () => [pad]));
        }
        const edge = edges.find((e) => e.to === node.id && e.new);
        const diffs = [];
        if (left && !step.finished && step.parts[PAGE_OF_ROW[split.page]]) diffs.push("disc page closed, walker page open");
        if (!left) for (const name of new Set([...Object.keys(robotParts), ...Object.keys(step.parts)])) {
            const a = (robotParts[name] ?? "").split(","), w = (step.parts[name] ?? "").split(",");
            const page = spec.pages.find((p) => p.name === name);
            if (!robotParts[name] || !step.parts[name]) { diffs.push(`${name}: ${robotParts[name] ? "missing in walker" : "extra in walker"}`); continue; }
            // A run keyed only the fields the table held then; later fields are not compared.
            page.fields.forEach((off, i) => {
                if (i < a.length && i < w.length && a[i] !== w[i]) diffs.push(`${name}+0x${off.toString(16)}: disc ${a[i]} walker ${w[i]}`);
            });
        }
        results.push({
            node: node.id, page: split.page, path: node.path, after: split.rest, match: diffs.length === 0,
            diffs, finished_early: step.finished, walker_settled: step.settled,
            wait: { disc: edge?.settle_frame ?? null, walker: split.rest.length ? step.lastChange : null },
            sounds: { disc: (edge?.sounds ?? []).map((s) => s[1]), walker: split.rest.length ? step.sounds : [] },
            disc_key: keys.get(node.key_id) ?? node.key,
        });
    }
    return results;
}

function markdown(results) {
    const ok = results.filter((r) => r.match).length;
    const out = ["# Pause map: disc vs walker", "",
        `_${ok} of ${results.length} robot screens inside a page match the walker's page fields._`, "",
        "Waits are frames from the press to the last change. Sounds are the packed ids of the last press.", "",
        "| Screen | Page | Buttons after opening | Match | Wait disc / walker | Differences |", "|---|---|---|---|---|---|"];
    for (const r of results) {
        const wait = r.after.length ? `${r.wait.disc ?? "-"} / ${r.wait.walker ?? "-"}` : "(entry)";
        out.push(`| ${r.node} | ${r.page} | ${r.after.join(" ") || "-"} | ${r.match ? "yes" : "**no**"} | ${wait} | ` +
            `${r.diffs.join("; ") || "-"}${r.finished_early ? " (walker page closed early)" : ""} |`);
    }
    const soundDiff = results.filter((r) => r.after.length && r.sounds.disc.join() !== r.sounds.walker.join());
    out.push("", `## Sounds that differ (${soundDiff.length})`, "");
    for (const r of soundDiff) out.push(`- screen ${r.node} (${r.page}, ${r.after.join(" ")}): disc ${r.sounds.disc.join(" ") || "-"}, walker ${r.sounds.walker.join(" ") || "-"}`);
    return out.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const [folder, savePath] = process.argv.slice(2);
    const outAt = process.argv.indexOf("--out");
    const out = outAt > 0 ? process.argv[outAt + 1] : folder;
    const codesAt = process.argv.indexOf("--codes");
    const results = compare(folder, savePath, loadSpec(), 2, codesAt > 0 ? process.argv[codesAt + 1] : null);
    writeFileSync(join(out, "compare.json"), JSON.stringify(results, null, 1) + "\n");
    writeFileSync(join(out, "COMPARE.md"), markdown(results));
    const ok = results.filter((r) => r.match).length;
    console.log(JSON.stringify({ screens: results.length, match: ok, differ: results.length - ok, out: join(out, "COMPARE.md") }));
}
