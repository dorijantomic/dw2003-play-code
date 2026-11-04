// The Dry Run: play a quest scene through the game's own cutscene VM, in node.
//
// Before anyone opens the game, a scene is played here through the same code the field runs — every walk, every wait,
// every line, every camera move, in order — and comes back with a stopwatch: how long it really takes, who speaks, where
// the camera goes, which host events fire, and whether anything stopped dead. It is the preview that cannot lie, because
// it is the same compiler (web/quest-scenes.js), the same walk router (web/quest-walk.js) and the same interpreter
// (engine/systems/cutscene-manager.ts) the field uses. Nothing here is a second model of the scene.
//
// This module is a tool, not game code: no F2 switch, no DOM, no fetch, no fs. Everything it needs arrives as data.
//
//   dryRun(steps, {
//     mapId,                 // the map the scene plays on (for the report only; the grid does the work)
//     cast,                  // [{ id, x, y, dir }] the characters standing on the map, at their posts. These records ARE
//                            // the field entities: the VM moves them, so their x/y after the run is where they ended.
//     grid,                  // a collision grid (web/assets/collision/<map>.json shape, or the engine's own grid)
//     playerId,              // 1 or 2, the script id the player answers to in this scene (default 2)
//     playerAt,              // { x, y, dir } the player's own record (moved in place, like `cast`)
//     paths,                 // named walk routes, as web/quest-paths.json `paths`
//     answer,                // the answer an "ask" gives: a number, an array indexed by say number, or (n) => number
//     maxSeconds,            // the cap the clock loop runs to (default 120)
//     stepSeconds,           // one step() call per this many seconds (default 1/60, the frame the VM's WAIT counts)
//     stallFrames,           // the stall rule's frame count (default 600, i.e. 10 s at 1/60)
//     holdSay,               // a say number (or list) whose after-say hook never resumes — for the stall fixture
//     holdEvent,             // an event kind or index (or list) whose host handler never resumes — same purpose
//     chaseAnswer,           // the result a `chase` settles on: 0 = kept up (default), 1 = lost
//   }) -> {
//     ok, ended, seconds, frames,
//     says: [{ n, at, who, name, text, ask, options, actor, mode }],
//     answers: [{ say, answer, at }],
//     events: [{ index, step, at, kind, ...the compiled spec }],
//     walks: [{ actor, from, to, arrived, seconds, at, x, y }],
//     camera: [{ at, kind: "follow" | "point", actor, x, y, mode }],
//     handoffs: [{ step, at, map, to, x, y, dir, then }],
//     pendingFollowUp: { scene, map } | null,
//     stalls: [{ pc, mode, at, seconds, frames, opcodes }],
//     unreachableTail: [step numbers],
//     conditionalTail: [{ at, after, why }],
//     errors, timeout,
//   }
//
// The stub host, exactly as the spec fixes it:
//   * the textbox never opens (esdmgStrings is null: the scene's own words are not in the disc's text bank, the host
//     speaks them through the after-say hooks, and this harness resumes each one);
//   * `battle` is a win (resume at once), because a dry run does not fight;
//   * `warp` records the handoff and aborts the VM — the host's own route when a scene leaves the field — so the steps
//     after it are reported as never playing, not played by a stub;
//   * a `warp` carrying the approved `then` reports the follow-up scene instead of a dead tail (the tail plays there);
//   * `chase` settles on `chaseAnswer` (0 = kept up); a lost chase ends the scene there, as the field does;
//   * every other host event is performed at once and resumed.
//
// One stall is `stallAt`'s fixed rule: the same pc and the same wait mode for 600 step() calls (10 s at 1/60) with no
// scripted walk moving — the VM's own `walking()` counts the field ticks an actor moved, so a long walk across the map
// is progress, never a stall. The record carries `debugOpcodes()`, so a real stall names what the VM is stuck on.
//
// What it cannot see, and does not claim: pixels, camera framing, sprite animation, sound. The report is timing, order
// and edges, not a screenshot.

import { createCutscene } from "../engine/systems/cutscene-manager.ts";
import { FIELD_TICK_RATE, FIELD_WALK_MAGNITUDE } from "../engine/systems/field-movement.ts";
import { castOf, compileScene } from "./quest-scenes.js";
import { questGrid, questStandFree, questWalkLegs } from "./quest-walk.js";

/** One stall: the same pc and the same wait mode for this many step() calls (the spec's fixed rule). */
export const STALL_FRAMES = 600;
/** The frame the VM's WAIT counts: the game steps the cutscene once per displayed 1/60 s frame. */
export const DEFAULT_STEP_SECONDS = 1 / 60;
/** How long the clock loop runs before giving up on a scene that never ends. */
export const DEFAULT_MAX_SECONDS = 120;
/** The VM's own walking speed in px per second, derived from the constants it moves with (not a guess). */
export const WALK_SPEED = (FIELD_WALK_MAGNITUDE / 0x100) * FIELD_TICK_RATE;

/** The stall rule: a wait state that has not changed for `frames` steps is one stall. */
export function stallAt(sinceFrame, frame, frames = STALL_FRAMES) {
    return frame - sinceFrame >= frames;
}

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** The entity the VM will move: the caller's own record when it has a position, so the caller sees where it ended. */
function entityOf(record) {
    if (record && typeof record === "object") {
        if (!Number.isFinite(Number(record.x))) record.x = 0;
        if (!Number.isFinite(Number(record.y))) record.y = 0;
        return record;
    }
    return { x: 0, y: 0, dir: "down" };
}

/** Every scene slot in web/quests.json, in file order: {quest, questId, slot, map, steps}. 469 of them today. */
export function questScenes(questsJson) {
    const quests = Array.isArray(questsJson) ? questsJson : questsJson?.quests ?? [];
    const out = [];
    for (const quest of quests) {
        if (!quest || typeof quest !== "object") continue;
        const questId = String(quest.id ?? "");
        const offerMap = (quest.offer?.maps ?? []).find((m) => m != null) ?? null;
        if (Array.isArray(quest.offer?.scene)) out.push({ quest, questId, slot: "offer", map: offerMap, steps: quest.offer.scene });
        if (Array.isArray(quest.doneScene)) out.push({ quest, questId, slot: "done", map: offerMap, steps: quest.doneScene });
        if (Array.isArray(quest.acceptScene)) out.push({ quest, questId, slot: "accept", map: offerMap, steps: quest.acceptScene });
        (quest.objectives ?? []).forEach((objective, index) => {
            if (!Array.isArray(objective?.scene)) return;
            const map = (objective.maps ?? []).find((m) => m != null) ?? objective.map ?? offerMap;
            out.push({ quest, questId, slot: `objective-${index}`, map, steps: objective.scene, objective });
        });
    }
    return out;
}

/**
 * The cast a map holds, post only: the scene file's own NPCs (first post of each npc id, which is the record the VM's
 * lookup finds) plus the extra quests' residents on that map (web/extra_npcs.json). This is the "post-only context" the
 * census uses: no story flags, no spawn gates, just who the map has a place for.
 */
export function castFromPosts(sceneJson, extraNpcsJson, mapId) {
    const out = [];
    const seen = new Set();
    for (const npc of sceneJson?.npcs ?? []) {
        const id = Number(npc?.npc_id);
        if (!Number.isFinite(id) || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, npc_id: id, x: num(npc.x, 0), y: num(npc.y, 0), dir: typeof npc.dir === "string" ? npc.dir : "down" });
    }
    for (const resident of extraNpcsJson?.residents ?? []) {
        if (String(resident?.map) !== String(mapId)) continue;
        const id = Number(resident?.npc_id);
        if (!Number.isFinite(id) || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, npc_id: id, x: num(resident.x, 0), y: num(resident.y, 0), dir: typeof resident.dir === "string" ? resident.dir : "down" });
    }
    return out;
}

/** The scene each step emits, as opcode and event index spans: prefix compiles, so the mapping is the compiler's own. */
function stepSpans(steps, compileOpts) {
    const spans = [];
    let opcode = 0;
    let event = 0;
    for (let k = 1; k <= steps.length; k++) {
        const prefix = compileScene(steps.slice(0, k), compileOpts);
        const end = Math.max(opcode, prefix.opcodes.length - 1);       // -1: the trailing END belongs to no step
        spans.push({ step: k, start: opcode, end, firstEvent: event, endEvent: prefix.events.length });
        opcode = end;
        event = prefix.events.length;
    }
    return spans;
}

export function dryRun(steps, opts = {}) {
    const sceneSteps = Array.isArray(steps) ? steps : [];
    const stepSeconds = num(opts.stepSeconds, DEFAULT_STEP_SECONDS) > 0 ? num(opts.stepSeconds, DEFAULT_STEP_SECONDS) : DEFAULT_STEP_SECONDS;
    const maxSeconds = num(opts.maxSeconds, DEFAULT_MAX_SECONDS);
    const stallFrames = num(opts.stallFrames, STALL_FRAMES);
    const playerId = opts.playerId === 1 ? 1 : 2;

    const player = entityOf(opts.playerAt);
    if (!player.dir) player.dir = "down";
    const cast = new Map();
    for (const record of opts.cast ?? []) {
        const id = Number(record?.id ?? record?.npc_id);
        if (!Number.isFinite(id)) continue;
        if (!cast.has(id)) {
            const entity = entityOf(record);
            if (!entity.dir) entity.dir = "down";
            cast.set(id, entity);
        }
    }
    const grid = opts.grid ? questGrid(opts.grid) : null;

    // The compiler gets exactly what web/game.js playQuestScene hands it: the player's script id, where everyone stands,
    // walkable ground (with the characters the scene is not moving kept clear, as `others` does there) and the router.
    const moving = new Set(castOf(sceneSteps));
    const others = [...cast.entries()].filter(([id]) => !moving.has(id)).map(([, e]) => e);
    const free = grid
        ? (x, y) => questStandFree(grid, x, y) && !others.some((n) => Math.hypot(n.x - x, n.y - y) < 30)
        : null;
    const walkRouter = grid ? (ax, ay, bx, by) => questWalkLegs(grid, ax, ay, bx, by) : null;
    const compileOpts = {
        playerId,
        pos: (id) => {
            if (id === playerId) return { x: player.x, y: player.y };
            const e = cast.get(Number(id));
            return e ? { x: e.x, y: e.y } : null;
        },
        free,
        walk: walkRouter,
        paths: opts.paths,
    };
    const compiled = compileScene(sceneSteps, compileOpts);
    const spans = stepSpans(sceneSteps, compileOpts);
    const errors = [...compiled.errors];

    const stepOfOpcode = (index) => spans.find((s) => index >= s.start && index < s.end)?.step ?? spans[spans.length - 1]?.step ?? 0;
    const stepOfEvent = (index) => spans.find((s) => index >= s.firstEvent && index < s.endEvent)?.step ?? 0;
    const chaseSteps = sceneSteps.map((s, i) => (s && typeof s === "object" && "chase" in s ? i + 1 : 0)).filter(Boolean);

    const says = [];
    const answers = [];
    const events = [];
    const walks = [];
    const camera = [];
    const handoffs = [];
    const stalls = [];
    let pendingFollowUp = null;

    const holdSay = new Set(list(opts.holdSay).map(Number).filter(Number.isFinite));
    const holdEvent = list(opts.holdEvent);
    const answerFor = (n) => {
        const a = opts.answer;
        if (typeof a === "function") return num(a(n), 0);
        if (Array.isArray(a)) return num(a[n - 1], 0);
        return num(a, 0);
    };
    const chaseAnswer = num(opts.chaseAnswer, 0) === 1 ? 1 : 0;
    const thenScene = (then) => (typeof then === "string" ? then : then?.scene ?? then?.id ?? null);

    const hooks = { afterSay: {} };
    for (const key of Object.keys(compiled.speech ?? {})) {
        const n = Number(key);
        const line = compiled.speech[key];
        hooks.afterSay[n] = line?.ask
            ? (resume) => {
                const answer = answerFor(n);
                answers.push({ say: n, answer, at: vm.clock() });
                resume();
            }
            : (resume) => resume();
        if (holdSay.has(n)) hooks.afterSay[n] = () => {};
    }

    let vm = null;
    const sceneEvent = (index, resume) => {
        const spec = compiled.events[index];
        if (!spec) return resume();
        const at = vm.clock();
        const record = { index, step: stepOfEvent(index), at, ...spec };
        events.push(record);
        const held = holdEvent.some((h) => (typeof h === "number" ? h === index : h === spec.kind));
        if (held) return;                      // the host never finishes: the VM waits in hook mode (the stall finder sees it)
        if (spec.kind === "warp") {
            const then = spec.then ?? null;
            handoffs.push({
                step: stepOfEvent(index), at,
                map: spec.to == null ? null : String(spec.to), to: spec.to ?? null,
                x: Array.isArray(spec.at) ? spec.at[0] : null, y: Array.isArray(spec.at) ? spec.at[1] : null,
                dir: spec.dir ?? 0, then,
            });
            if (then != null) pendingFollowUp = { scene: thenScene(then), map: spec.to == null ? null : String(spec.to) };
            vm.abort();                        // the host's own route when a scene leaves the field
            return;
        }
        if (spec.kind === "chase") {
            record.result = chaseAnswer;
            if (chaseAnswer === 1) { vm.abort(); return; }   // a lost chase ends the rest of the scene
            return resume();
        }
        if (spec.kind === "battle") record.result = "win";  // a dry run does not fight: the fight is a win
        return resume();
    };

    vm = createCutscene(
        { isOpen: () => false, open: () => {} },
        () => player,
        (id) => cast.get(Number(id)) ?? null,
        { playerCastOne: () => playerId === 1, sceneEvent },
    );

    /** The opcodes this frame executed, noted for the timeline (they are not looped back over). */
    const noteOpcode = (index) => {
        const op = compiled.opcodes[index];
        if (!op) return;
        const parts = op.split(" ");
        const at = vm.clock();
        switch (parts[0]) {
            case "WALKTO": {
                const actor = Number(parts[1]);
                const entity = vm.entity(actor);
                walks.push({
                    actor,
                    from: entity ? { x: entity.x, y: entity.y } : null,
                    to: { x: Number(parts[2]), y: Number(parts[3]) },
                    arrived: false, seconds: null, at,
                    _entity: entity, _target: entity?._cutTarget ?? null,
                });
                break;
            }
            case "SAY": {
                const n = Number(parts[2]);
                const line = compiled.speech?.[n] ?? null;
                says.push({
                    n, at,
                    who: line?.who ?? null, name: line?.name ?? "",
                    text: line?.text, ask: line?.ask, options: line?.options,
                    actor: Number.isFinite(Number(parts[3])) ? Number(parts[3]) : null,
                    mode: Number.isFinite(Number(parts[4])) ? Number(parts[4]) : 0,
                });
                break;
            }
            case "FN6A": {
                const actor = Number(parts[2]);
                const target = vm.entity(actor);
                camera.push({ at, kind: "follow", actor, x: target ? target.x : null, y: target ? target.y : null, mode: parts[1] === "1" ? "snap" : "pan" });
                break;
            }
            case "FN6B":
                camera.push({ at, kind: "point", actor: null, x: Number(parts[2]), y: Number(parts[3]), mode: parts[1] === "1" ? "snap" : "pan" });
                break;
            case "HANDOFF":
                handoffs.push({
                    step: stepOfOpcode(index), at,
                    map: parts[1] == null ? null : String(Number(parts[1])),
                    to: Number.isFinite(Number(parts[1])) ? Number(parts[1]) : null,
                    x: Number(parts[2]), y: Number(parts[3]), dir: Number(parts[4] ?? 0), then: null,
                });
                break;
            default:
                break;
        }
    };

    /** Close a walk record once its driver let go (arrived, superseded, teleported), or when the run stops. */
    const settleWalk = (w, force = false) => {
        if (w._done) return;
        if (!force && w._entity && w._entity._cutTarget === w._target) return;   // still walking
        w.arrived = !!w._entity && w._entity.x === w.to.x && w._entity.y === w.to.y;
        w.x = w._entity ? w._entity.x : null;
        w.y = w._entity ? w._entity.y : null;
        w.seconds = vm.clock() - w.at;
        w._done = true;
    };

    const maxFrames = Math.max(1, Math.ceil(maxSeconds / stepSeconds));
    let frames = 0;
    let pcCursor = vm.debugWait().pc;
    let maxPc = pcCursor;
    let lastKey = null;
    let sinceFrame = 0;
    vm.start(compiled.opcodes, null, () => {}, hooks);
    while (vm.isActive() && frames < maxFrames) {
        const before = pcCursor;
        vm.step(stepSeconds);
        frames += 1;
        const after = vm.debugWait().pc;
        for (let i = before; i < after; i++) noteOpcode(i);
        pcCursor = after;
        if (after > maxPc) maxPc = after;
        for (const w of walks) settleWalk(w);
        const wait = vm.debugWait();
        // The stall state is the spec's: the same pc and the same wait mode. A scripted walk still moving is progress,
        // not a wait that never ends — the VM's own `walking()` counts the field ticks an actor moved this step — so it
        // keeps the timer from running on a long walk across the map.
        const key = `${wait.pc}|${wait.mode}`;
        const moving = vm.walking() > 0;
        if (key !== lastKey || moving) {
            lastKey = key;
            sinceFrame = frames;
        } else if (vm.isActive() && stallAt(sinceFrame, frames, stallFrames)) {
            stalls.push({
                pc: wait.pc, mode: wait.mode, at: vm.clock(),
                seconds: (frames - sinceFrame) * stepSeconds, frames: frames - sinceFrame,
                opcodes: vm.debugOpcodes(),
            });
            break;
        }
    }
    // walks still running when the scene stopped (a stall, the cap, a warp): report where they got to
    for (const w of walks) settleWalk(w, true);

    const ended = !vm.isActive();
    const timeout = !ended && stalls.length === 0;

    // Which steps never played. A step that emits no opcode is "played" once the pc has reached its own boundary.
    const played = (span) => (span.end === span.start ? maxPc >= span.end : maxPc > span.start);
    const unreachableTail = pendingFollowUp ? [] : spans.filter((s) => !played(s)).map((s) => s.step);
    const conditionalTail = chaseSteps
        .filter((step) => played(spans[step - 1]))
        .map((step) => ({
            at: step,
            after: Array.from({ length: Math.max(0, sceneSteps.length - step) }, (_, i) => step + 1 + i),
            why: "the steps after a chase play only when the player keeps up",
        }));

    const cleanWalks = walks.map(({ actor, from, to, arrived, seconds, at, x, y }) => ({ actor, from, to, arrived, seconds, at, x, y }));
    return {
        ok: ended && stalls.length === 0 && errors.length === 0,
        ended, seconds: vm.clock(), frames,
        says, answers, events, walks: cleanWalks, camera, handoffs,
        pendingFollowUp, stalls, unreachableTail, conditionalTail,
        errors, timeout,
    };
}
