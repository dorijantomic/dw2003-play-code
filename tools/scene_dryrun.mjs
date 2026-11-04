#!/usr/bin/env node
// The Dry Run's command line: play a quest scene through the game's own cutscene VM and print the timeline.
//
//   node tools/scene_dryrun.mjs --quest park_pest_control --slot offer
//   node tools/scene_dryrun.mjs --quest park_pest_control --slot done --map s330
//   node tools/scene_dryrun.mjs --quest park_pest_control --slot objective-0
//   node tools/scene_dryrun.mjs --scene myscene.json --map s330
//   ... --json              the whole report as one JSON object
//   ... --max-seconds 300   raise the clock cap (default 120)
//   ... --answer 1          the answer an "ask" gives (default 0)
//   ... --hold battle       a host event that never finishes (proves the stall exit); also --hold-say 2
//
// It reads web/quests.json (or the --scene file), the map's own posts (web/assets/scenes/<map>.json), the extra quests'
// residents (web/extra_npcs.json), the collision grid and the named walk routes. It prints plain lines and exits 1 when
// the scene stalls or does not compile; otherwise 0. It writes nothing.
//
// The player stands at the giver's post (a scene is written from there), so previewing a `walk near player` step by the
// giver themself comes out as a no-op — that is what the compiler does when both stand on the same spot.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { castFromPosts, dryRun, questScenes } from "../web/scene-dryrun.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const tryLoad = (rel) => {
    try {
        return existsSync(join(ROOT, rel)) ? load(rel) : null;
    } catch {
        return null;
    }
};

/** A problem with how the tool was called (unknown quest, unreadable file): one plain line, exit 1. */
class UsageError extends Error {}

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) {
            out._.push(arg);
            continue;
        }
        const key = arg.slice(2);
        const eq = key.indexOf("=");
        if (eq >= 0) {
            out[key.slice(0, eq)] = key.slice(eq + 1);
            continue;
        }
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
            out[key] = true;
            continue;
        }
        out[key] = next;
        i += 1;
    }
    return out;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const fail = (why) => {
        throw new UsageError(why);
    };

    let steps = null;
    let quest = null;
    let slot = null;
    let mapId = typeof args.map === "string" ? args.map : null;

    if (args.scene) {
        if (args.scene === true) fail("--scene needs a file path");
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(String(args.scene), "utf8"));
        } catch (e) {
            fail(`cannot read the scene file ${args.scene}: ${e.message}`);
        }
        steps = Array.isArray(parsed) ? parsed : parsed?.steps;
        if (!Array.isArray(steps)) fail(`the scene file ${args.scene} holds no steps (a list, or { "steps": [...] })`);
        slot = "file";
    } else {
        if (!args.quest || args.quest === true) fail("usage: --quest <id> --slot offer|done|objective-0, or --scene <file>");
        if (!args.slot || args.slot === true) fail("--slot names the scene: offer, done, accept or objective-0");
        const quests = load("web/quests.json");
        const found = questScenes(quests).find((s) => s.questId === String(args.quest) && s.slot === String(args.slot));
        if (!found) fail(`no scene "${args.slot}" for quest "${args.quest}" (see web/quests.json)`);
        steps = found.steps;
        quest = found.quest;
        slot = found.slot;
        mapId = mapId ?? (found.map == null ? null : String(found.map));
    }

    const extra = tryLoad("web/extra_npcs.json");
    const sceneJson = mapId ? tryLoad(`web/assets/scenes/${mapId}.json`) : null;
    const grid = mapId ? tryLoad(`web/assets/collision/${mapId}.json`) : null;
    const paths = tryLoad("web/quest-paths.json")?.paths ?? {};
    const cast = castFromPosts(sceneJson, extra, mapId);
    // The player stands at the giver's post: the giver's own record when the quest names one, else the first post the
    // map has, else the map's origin.
    const giverId = Number(quest?.offer?.npc);
    const giver = cast.find((c) => c.id === giverId) ?? cast[0] ?? null;
    const playerAt = giver ? { x: giver.x, y: giver.y, dir: "down" } : { x: 0, y: 0, dir: "down" };
    const hold = typeof args.hold === "string" ? args.hold.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const holdSay = typeof args["hold-say"] === "string" ? args["hold-say"].split(",").map(Number).filter(Number.isFinite) : [];
    const answer = args.answer === undefined ? 0 : Number(args.answer);
    const maxSeconds = args["max-seconds"] === undefined ? undefined : Number(args["max-seconds"]);

    const run = dryRun(steps, {
        mapId, cast, grid, playerId: 2, playerAt, paths, answer, maxSeconds,
        holdEvent: hold, holdSay,
    });

    if (args.json) {
        console.log(JSON.stringify({ questId: quest?.id ?? null, slot, mapId, ...run }, null, 2));
    } else {
        printReport(run, { quest, slot, mapId });
    }
    process.exitCode = run.stalls.length || run.errors.length ? 1 : 0;
}

// --- the plain report ------------------------------------------------------------------------------------------------

function eventLine(ev) {
    const at = (p) => (Array.isArray(p) ? `(${p[0]}, ${p[1]})` : "");
    switch (ev.kind) {
        case "fx": return `effect "${ev.name}" placed at ${at([ev.x, ev.y])}`;
        case "fxplay": return `effect "${ev.name}" plays clip "${ev.clip}"${ev.loop ? " (looping)" : ""}`;
        case "fxmove": return `effect "${ev.name}" moves (${ev.fall ? "fall" : ev.slide ? "slide" : "rise"})`;
        case "fxwait": return `wait for effect "${ev.name}" to arrive`;
        case "fxremove": return `effect "${ev.name}" removed${ev.fade ? ` (fading ${ev.fade} frames)` : ""}`;
        case "fade": return `screen fades ${ev.to} over ${ev.frames} frames`;
        case "shake": return `screen shakes up to ${ev.amp} px for ${ev.frames} frames${ev.times > 1 ? ` (${ev.times} thuds)` : ""}`;
        case "weather": return `weather turns to ${ev.weather} (strength ${ev.strength})`;
        case "time": return `time of day moves to ${ev.time} over ${ev.frames} frames`;
        case "lightning": return `${ev.count} lightning flash${ev.count === 1 ? "" : "es"}`;
        case "battle": return `battle screen ${ev.screen} (a win, as the field's scripted fights)`;
        case "warp": return `warp to ${ev.to} at ${at([ev.x, ev.y])} — the scene ends there${ev.then ? ", then the follow-up scene plays" : ""}`;
        case "chase": return `chase npc ${ev.target} along ${ev.path?.length ?? 0} points (the player must keep up)`;
        case "ghost": return ev.off ? `npc ${ev.npc} back to normal` : `npc ${ev.npc} drawn faded (alpha ${ev.alpha})`;
        case "drop":
        case "rise": return `the player moves ${Math.abs(ev.pixels)} px ${ev.kind === "drop" ? "down" : "up"}`;
        case "sfx": return `sound "${ev.name}"`;
        default: return `${ev.kind} event`;
    }
}

/**
 * Why the steps after the last played one never run, worded from what the run actually recorded: a warp that handed
 * off, a stall, or the clock cap — never "after the warp" for a scene that has no warp.
 */
function tailLine(run) {
    const steps = `steps ${run.unreachableTail.join(", ")}`;
    if (run.handoffs.length) return `${steps} never play after the warp`;
    if (run.stalls.length) return `${steps} never play: the scene stalled before them`;
    if (run.timeout) return `${steps} never play: the clock hit its cap first`;
    return `${steps} never play`;
}

function printReport(run, { quest, slot, mapId }) {
    const name = quest?.id ?? "scene";
    const where = mapId ? ` on ${mapId}` : "";
    const lines = [];
    const at = (t) => `${t.toFixed(2)} s`;
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    for (const c of run.camera) {
        lines.push({ at: c.at, text: c.kind === "follow" ? `camera follows ${c.actor}` : `camera to (${c.x}, ${c.y}), ${c.mode}` });
    }
    for (const w of run.walks) {
        const from = w.from ? `(${Math.round(w.from.x)}, ${Math.round(w.from.y)})` : "(nowhere)";
        const to = `(${Math.round(w.to.x)}, ${Math.round(w.to.y)})`;
        const took = Number.isFinite(w.seconds) ? ` in ${w.seconds.toFixed(2)} s` : "";
        const who = w.actor === 2 ? "the player" : `npc ${w.actor}`;
        lines.push({ at: w.at, text: `${who} walks ${from} -> ${to}${took}${w.arrived ? "" : " (did not arrive)"}` });
    }
    for (const s of run.says) {
        const who = s.name || (s.who == null ? "narration" : `npc ${s.who}`);
        lines.push({ at: s.at, text: s.ask ? `${who} asks "${s.ask}" (options: ${(s.options ?? []).join(" / ")})` : `${who}: ${s.text}` });
    }
    for (const e of run.events) lines.push({ at: e.at, text: eventLine(e) });
    lines.sort((a, b) => a.at - b.at);
    console.log(`${name} ${slot}${where} — ${run.seconds.toFixed(1)} s, ${plural(run.frames, "frame")}, ${plural(run.says.length, "line")}, ${plural(run.walks.length, "walk")}, ${plural(run.events.length, "event")}, ${run.stalls.length ? plural(run.stalls.length, "stall") : "no stalls"}`);
    for (const line of lines) console.log(`  ${at(line.at).padStart(7)}  ${line.text}`);
    console.log(`  ${at(run.seconds).padStart(7)}  ${run.ended ? "END" : run.timeout ? "CAP (the scene never ended)" : "STOPPED"}`);
    if (run.unreachableTail.length) console.log(`  ${tailLine(run)}`);
    for (const c of run.conditionalTail) console.log(`  steps ${c.after.join(", ")} play only if the player keeps up (chase at step ${c.at})`);
    if (run.pendingFollowUp) console.log(`  follow-up scene ${JSON.stringify(run.pendingFollowUp.scene)} plays on arrival at ${run.pendingFollowUp.map}`);
    for (const e of run.errors) console.log(`  scene error: ${e}`);
    for (const s of run.stalls) {
        console.log(`  STALL at pc ${s.pc} (mode ${s.mode}) after ${s.seconds.toFixed(1)} s: ${s.opcodes.slice(0, 6).join(" | ")}`);
    }
}

try {
    main();
} catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
}
