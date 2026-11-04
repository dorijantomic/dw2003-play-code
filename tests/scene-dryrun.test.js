// The Dry Run: a quest scene played through the game's own cutscene VM in node.
//
//   node --test tests/scene-dryrun.test.js
//
// web/scene-dryrun.js compiles a scene with the real compiler (web/quest-scenes.js), routes its walks with the real
// router (web/quest-walk.js) and steps the real VM (engine/systems/cutscene-manager.ts) one 1/60 s frame at a time,
// with a stub textbox and a stub host for the scene's own events. Every number this file checks is measured from that
// run: the timing comes from the VM's own clock and the walk speed from field-movement.ts, never from a hand-typed
// guess. What it cannot see (pixels, camera framing, sprite animation, sound) is not claimed anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    DEFAULT_STEP_SECONDS, STALL_FRAMES, castFromPosts, dryRun, questScenes, stallAt,
} from "../web/scene-dryrun.js";
import { compileScene } from "../web/quest-scenes.js";
import { FIELD_TICK_RATE, FIELD_WALK_MAGNITUDE } from "../engine/systems/field-movement.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

/** The VM's own walking speed: px per field tick (FIELD_WALK_MAGNITUDE is 24.8 fixed point) at 50 ticks a second. */
const WALK_SPEED = (FIELD_WALK_MAGNITUDE / 0x100) * FIELD_TICK_RATE;

/**
 * The five-step fixture the spec names: the NPC steps out to `gap` px in front of the player, speaks, the scene pauses
 * 30 frames, the camera moves and the screen fades. The player stands 4 px inside that gap, so the walk is a 4 px step
 * back: the VM walks a straight line at its own speed and the scene's stopwatch must agree with it.
 */
function fiveStepFixture() {
    const actor = { id: 27, npc_id: 27, x: 100, y: 200, dir: "down" };
    const player = { x: 130, y: 200, dir: "left" };
    const steps = [
        { walk: 27, to: { near: "player", gap: 34 } },
        { say: 27, name: "Leomon", text: "Hey there. Mind the road." },
        { wait: 30 },
        { pan: [200, 300] },
        { fade: "out", frames: 30 },
    ];
    return { actor, player, steps, opts: { mapId: "s330", cast: [actor], playerId: 2, playerAt: player } };
}

test("a five-step scene ends on the clock: one line, a real walk, wait plus walk time", () => {
    const { actor, player, steps, opts } = fiveStepFixture();
    const startX = actor.x;
    const run = dryRun(steps, opts);

    assert.equal(run.ok, true, `errors: ${run.errors.join("; ")}`);
    assert.equal(run.ended, true);
    assert.equal(run.says.length, 1, "exactly one say");
    assert.equal(run.says[0].who, 27);
    // the actor really walked: the VM moved it toward the `near` point (4 px back, on the x axis)
    assert.ok(Math.abs(actor.x - startX) >= 1, `the actor's x moved (${startX} -> ${actor.x})`);
    assert.equal(run.walks.length, 1);
    const walk = run.walks[0];
    assert.equal(walk.actor, 27);
    assert.equal(walk.arrived, true);
    assert.deepEqual(walk.to, { x: 96, y: 200 });

    // the measured time is the 30-frame pause plus the walk's own straight-line time at the VM's walk speed
    const walkDistance = Math.hypot(walk.to.x - walk.from.x, walk.to.y - walk.from.y);
    const expected = 30 / 60 + walkDistance / WALK_SPEED;
    assert.ok(
        Math.abs(run.seconds - expected) <= 1 / 60,
        `seconds ${run.seconds.toFixed(4)} vs ${expected.toFixed(4)} (walk ${walkDistance} px at ${WALK_SPEED} px/s)`,
    );
    // the clock is the VM's own frame clock, not a second model
    assert.ok(Math.abs(run.seconds - run.frames * DEFAULT_STEP_SECONDS) < 1e-9, "seconds is frames x stepSeconds");
    assert.equal(run.stalls.length, 0);
    assert.equal(player.x, 130, "the player never moves on its own");
});

test("two wait 60 steps add exactly 2.0 s of scene time", () => {
    const run = dryRun([{ wait: 60 }, { wait: 60 }], { playerId: 2 });
    assert.equal(run.ended, true);
    assert.ok(Math.abs(run.seconds - 2) <= 2 / 60, `seconds ${run.seconds} should be 2.0 +/- 2 frames`);
});

test("a warp at step 3 of 6 hands off once and leaves steps 4-6 unplayed", () => {
    const steps = [
        { wait: 10 },
        { say: 27, name: "Leomon", text: "This way." },
        { warp: { map: "s320", at: [576, 448], dir: 0 } },
        { say: 27, name: "Leomon", text: "never heard" },
        { wait: 10 },
        { say: 27, name: "Leomon", text: "never heard" },
    ];
    const run = dryRun(steps, { mapId: "s330", cast: [{ id: 27, x: 100, y: 200 }], playerId: 2, playerAt: { x: 120, y: 200 } });

    assert.equal(run.ended, true, "the warp ends the scene, as the host's own route does");
    assert.equal(run.stalls.length, 0);
    assert.deepEqual(run.unreachableTail, [4, 5, 6]);
    assert.equal(run.handoffs.length, 1);
    assert.equal(run.handoffs[0].map, "s320");
    assert.deepEqual([run.handoffs[0].x, run.handoffs[0].y], [576, 448]);
    assert.equal(run.handoffs[0].step, 3);
    assert.equal(run.pendingFollowUp, null);
});

test("a warp carrying the approved `then` is a pending follow-up, not a dead tail", (t) => {
    // Only when the warp-then card has landed: until the compiler carries `then` to the host, there is nothing for the
    // game (or this harness) to play, so the plain-warp case above is the truth.
    const steps = [
        { wait: 10 },
        { say: 27, name: "Leomon", text: "This way." },
        { warp: { map: "s320", at: [576, 448], dir: 0 }, then: { scene: "after_door" } },
        { say: 27, name: "Leomon", text: "never heard" },
        { wait: 10 },
        { say: 27, name: "Leomon", text: "never heard" },
    ];
    const opts = { mapId: "s330", cast: [{ id: 27, x: 100, y: 200 }], playerId: 2, playerAt: { x: 120, y: 200 } };
    const compiled = compileScene(steps, { playerId: 2, pos: (id) => (id === 27 ? { x: 100, y: 200 } : id === 2 ? { x: 120, y: 200 } : null) });
    const warp = compiled.events.find((e) => e.kind === "warp");
    if (!warp || warp.then == null) {
        t.diagnostic("the compiler does not carry a warp `then` yet; the pending follow-up case waits for that card");
        return;
    }
    const run = dryRun(steps, opts);
    assert.ok(run.pendingFollowUp, "pendingFollowUp is reported");
    assert.equal(run.pendingFollowUp.scene, "after_door");
    assert.equal(run.pendingFollowUp.map, "s320");
    assert.deepEqual(run.unreachableTail, [], "the tail belongs to the follow-up, not to a dead scene");
});

test("a chase at step 2 marks it and the steps after it conditional, with no stall", () => {
    const steps = [
        { say: 27, name: "Leomon", text: "Keep up!" },
        { chase: 27, path: [[100, 200], [160, 200], [220, 240]] },
        { say: 27, name: "Leomon", text: "Not bad." },
        { wait: 10 },
    ];
    const run = dryRun(steps, { mapId: "s330", cast: [{ id: 27, x: 100, y: 200 }], playerId: 2, playerAt: { x: 120, y: 200 } });
    assert.equal(run.ended, true);
    assert.equal(run.stalls.length, 0);
    const chase = run.conditionalTail.find((c) => c.at === 2);
    assert.ok(chase, `conditionalTail names step 2: ${JSON.stringify(run.conditionalTail)}`);
    assert.deepEqual(chase.after, [3, 4]);
    assert.deepEqual(run.events.map((e) => e.kind), ["chase"]);
});

test("an after-say hook that never resumes is one hook stall after 10 s, with the opcodes", () => {
    const { steps, opts } = fiveStepFixture();
    const held = dryRun(steps, { ...opts, holdSay: [1] });
    assert.equal(held.stalls.length, 1);
    assert.equal(held.stalls[0].mode, "hook");
    assert.ok(held.stalls[0].seconds >= 10, `stall seconds ${held.stalls[0].seconds}`);
    assert.equal(held.stalls[0].frames, STALL_FRAMES);
    assert.ok(held.stalls[0].opcodes.length > 0, "debugOpcodes() names what the VM is stuck on");
    assert.equal(held.ended, false);
    assert.equal(held.ok, false);

    // the same scene with the normal stub never stalls
    const normal = dryRun(steps, opts);
    assert.equal(normal.stalls.length, 0);
});

test("a battle host event that never resumes is one hook stall", () => {
    const steps = [{ battle: 12 }, { wait: 10 }, { say: 27, name: "Leomon", text: "after the fight" }];
    const opts = { mapId: "s330", cast: [{ id: 27, x: 100, y: 200 }], playerId: 2, playerAt: { x: 120, y: 200 } };
    const held = dryRun(steps, { ...opts, holdEvent: ["battle"] });
    assert.equal(held.stalls.length, 1);
    assert.equal(held.stalls[0].mode, "hook");
    assert.ok(held.stalls[0].seconds >= 10);

    const run = dryRun(steps, opts);
    assert.equal(run.stalls.length, 0);
    assert.equal(run.ended, true);
    assert.equal(run.events[0].kind, "battle");
    assert.equal(run.events[0].result, "win", "the stub fights the battle as a win");
});

test("a scene using every host event kind plays them all and ends without a stall", () => {
    const kinds = ["fx", "fxplay", "fxmove", "fxwait", "fxremove", "fade", "shake", "weather", "time", "lightning", "battle", "warp", "chase", "ghost"];
    const steps = [
        { fx: "crate", sheet: "crate", at: [400, 320], clip: "fall", fall: { floor: 360 } },
        { fxplay: "crate", clip: "land" },
        { fxmove: "crate", slide: { to: [460, 320], frames: 10 } },
        { fxwait: "crate" },
        { fxremove: "crate", fade: 8 },
        { fade: "out", frames: 10 },
        { shake: 5, frames: 12 },
        { weather: "fog", strength: 0.5 },
        { time: "dusk" },
        { lightning: 1 },
        { ghost: 27, alpha: 0.4, tint: "#9fc8ff" },
        { chase: 27, path: [[100, 200], [140, 200]] },
        { battle: 34 },
        { warp: { map: "s320", at: [576, 448], dir: 0 } },
    ];
    const run = dryRun(steps, { mapId: "s330", cast: [{ id: 27, x: 100, y: 200 }], playerId: 2, playerAt: { x: 120, y: 200 } });
    const seen = new Set(run.events.map((e) => e.kind));
    for (const kind of kinds) assert.ok(seen.has(kind), `the ${kind} event ran (saw ${[...seen].join(", ")})`);
    assert.equal(run.events.length, kinds.length);
    assert.equal(run.stalls.length, 0);
    assert.equal(run.ended, true, "the warp is the last step, so the scene ends there as on the field");
    assert.equal(run.handoffs.length, 1);
});

test("every shipped scene plays through the VM: the census never fails the test", () => {
    // The sweep follows whatever quests file it is pointed at (web/quests.json by default), never a pinned count: quest
    // data is append-only, so a hard number here breaks on every quest card and on every merge that lands one. Set
    // DRYRUN_QUESTS to a scratch copy — `git show integration/all:web/quests.json > /tmp/quests.json` — to sweep the
    // merge target's data without touching web/quests.json.
    const questsFile = process.env.DRYRUN_QUESTS ?? "web/quests.json";
    const quests = JSON.parse(readFileSync(resolve(ROOT, questsFile), "utf8"));
    const slots = questScenes(quests);
    assert.ok(slots.length > 0, `the sweep found scene slots in ${questsFile}`);

    const extra = load("web/extra_npcs.json");
    const paths = load("web/quest-paths.json").paths ?? {};
    const grids = new Map();
    const gridOf = (mapId) => {
        if (!mapId) return null;
        if (!grids.has(mapId)) {
            let g = null;
            try { g = load(`web/assets/collision/${mapId}.json`); } catch { /* a map with no grid runs unwalled */ }
            grids.set(mapId, g);
        }
        return grids.get(mapId);
    };
    const sceneOf = (mapId) => {
        if (!mapId) return null;
        try { return load(`web/assets/scenes/${mapId}.json`); } catch { return null; }
    };

    const census = { total: 0, ok: 0, stalled: 0, timedOut: 0, conditional: 0, unreachable: 0, errors: 0, longest: { slot: "", seconds: 0 } };
    for (const slot of slots) {
        const cast = castFromPosts(sceneOf(slot.map), extra, slot.map);
        const giver = cast.find((c) => c.id === slot.quest?.offer?.npc);
        const playerAt = giver ? { x: giver.x, y: giver.y, dir: "down" } : { x: 0, y: 0, dir: "down" };
        const run = dryRun(slot.steps, { mapId: slot.map, cast, grid: gridOf(slot.map), playerId: 2, playerAt, paths, maxSeconds: 120 });
        census.total += 1;
        if (run.ok) census.ok += 1;
        if (run.stalls.length) census.stalled += 1;
        if (run.timeout) census.timedOut += 1;
        if (run.conditionalTail.length) census.conditional += 1;
        if (run.unreachableTail.length) census.unreachable += 1;
        if (run.errors.length) census.errors += 1;
        if (run.seconds > census.longest.seconds) census.longest = { slot: `${slot.questId} ${slot.slot}`, seconds: run.seconds };
    }
    console.log(`[dry run census] ${JSON.stringify(census)}`);
    assert.ok(census.total > 0, "the sweep measured the slots it was given");
    // A census, not a gate: the shipped data may hold a scene the dry run cannot finish, and that is a finding for the
    // author, not a broken tool. The fixtures above are the gate. The count is reported, never pinned: quest data is
    // append-only, so a fixed number would fail on the next quest card (or on the merge target's newer file).
    assert.ok(census.longest.seconds <= 120, "nothing ran past the 120 s cap");
});

test("the module is pure: four imports, no DOM", () => {
    const source = readFileSync(join(ROOT, "web/scene-dryrun.js"), "utf8");
    const specifiers = [...source.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
    assert.deepEqual(
        [...specifiers].sort(),
        ["./quest-scenes.js", "./quest-walk.js", "../engine/systems/cutscene-manager.ts", "../engine/systems/field-movement.ts"].sort(),
        "the harness imports the compiler, the walk router and the two engine modules, nothing else",
    );
    for (const dom of ["document", "window", "HTMLElement", "canvas"]) {
        assert.ok(!new RegExp(`\\b${dom}\\b`).test(source), `the module never touches ${dom}`);
    }
});

test("the CLI prints a real quest's timeline and exits 0", () => {
    const out = execFileSync(process.execPath, ["tools/scene_dryrun.mjs", "--quest", "park_pest_control", "--slot", "offer"], {
        cwd: ROOT, encoding: "utf8", timeout: 60_000,
    });
    assert.match(out, /park_pest_control offer/);
    assert.match(out, /s330/);
    assert.match(out, /s\b/, "the timeline has at least one timed line");
    assert.match(out, /END/);
    assert.match(out, /no stalls/);
    assert.doesNotMatch(out, /STALL/);
});

test("the CLI on a deliberately stalled fixture exits 1 and names the stall", () => {
    const dir = mkdtempSync(join(tmpdir(), "scene-dryrun-"));
    try {
        const file = join(dir, "stalled.json");
        writeFileSync(file, JSON.stringify([{ battle: 12 }, { wait: 10 }]));
        let error = null;
        try {
            execFileSync(process.execPath, ["tools/scene_dryrun.mjs", "--scene", file, "--hold", "battle"], {
                cwd: ROOT, encoding: "utf8", timeout: 60_000, stdio: "pipe",
            });
        } catch (e) {
            error = e;
        }
        assert.ok(error, "the CLI must fail on a stall");
        assert.equal(error.status, 1);
        assert.match(String(error.stdout), /STALL/);
        assert.match(String(error.stdout), /hook/);
        // The fixture has no warp: a tail left by a stall must not be blamed on one (the tool cannot lie about its cause).
        assert.doesNotMatch(String(error.stdout), /after the warp/);
        assert.match(String(error.stdout), /steps 2 never play: the scene stalled before them/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("the CLI blames a dead tail on the warp only when a warp was recorded", () => {
    const dir = mkdtempSync(join(tmpdir(), "scene-dryrun-"));
    try {
        const file = join(dir, "warped.json");
        writeFileSync(file, JSON.stringify([
            { wait: 10 },
            { warp: { map: "s320", at: [576, 448], dir: 0 } },
            { wait: 60 },
        ]));
        const out = execFileSync(process.execPath, ["tools/scene_dryrun.mjs", "--scene", file, "--map", "s330"], {
            cwd: ROOT, encoding: "utf8", timeout: 60_000,
        });
        assert.match(out, /warp to s320 at \(576, 448\)/);
        assert.match(out, /steps 3 never play after the warp/);
        assert.doesNotMatch(out, /STALL/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("stallAt is the fixed rule: the same pc and mode for 600 frames", () => {
    assert.equal(STALL_FRAMES, 600);
    assert.equal(stallAt(0, 599), false);
    assert.equal(stallAt(0, 600), true);
    assert.equal(stallAt(100, 700, 600), true);
});
