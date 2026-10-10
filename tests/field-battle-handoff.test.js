// The shared field→battle handoff (web/game.js `startFieldBattle`).
//
// The original plays the A28 checkerboard (fieldstg F0x80089F7C) on EVERY
// field→battle transition: every field battle enters through the one battle host
// fieldstg F0x8008b798, which sets the scene transition bytes
// `scene+0x58/+0x5C = 1` (docs/workflow/gameplay-playbook.md:1114-1116), and the
// field's phase-2 stage change then reads `descriptor+0x5C` and selects the
// checkerboard when it is nonzero, else the A27 iris (fieldstg.s file 0x895C:
// `lw $v0,0x5C($v1)` / `beqz` in front of `jal F0x80089f7c`, else
// `jal F0x8008a5e4`). The host has three callers in fieldstg.s (file 0x92c4,
// 0xf99c, 0xfb34), reached by the walk-up/ambush selector F0x800925a8 and the
// scripted-encounter launcher F0x800927a0 — the launcher the kicked tree and a
// landed fish use too. So the wipe is the SHARED handoff: a walk-up, an ambush
// patch, a kicked tree, a fishing catch and a scripted story fight all play it.
//
// The walker used to play it for a random walk-up only and cut straight to the
// battle at every other site. This is a CENSUS over the player-facing section of
// web/game.js: every battle launch must route through the one shared handoff, so
// a future per-site override (a direct `battle.startScreen`/`startRandom`/
// `startParty` call) fails loudly. The `window.__dev` debug object is exempt — it
// is the developer toolset, not a battle a player meets.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");

// A battle launch wrapped by the shared handoff.
const HANDOFF = /startFieldBattle\(\(\)\s*=>\s*[\r\n ]*battle\.(startScreen|startRandom|startParty)\(/g;
// Any direct battle launch.
const DIRECT = /battle\.(startScreen|startRandom|startParty)\(/g;

const playerSection = () => {
    const devIdx = SRC.indexOf("window.__dev = {");
    assert.ok(devIdx > 0, "the window.__dev debug block is present");
    return SRC.slice(0, devIdx);
};

test("startFieldBattle arms the shared A28 checkerboard", () => {
    // The one shared transition module supplies the checkerboard.
    assert.match(SRC, /createCheckerboard,/);
    assert.match(SRC, /} from "\.\/stage-wipe\.js";/);
    // startFieldBattle arms the wipe and records the battle thunk to run when the
    // schedule is spent — it does not launch the battle itself.
    assert.match(SRC, /state\.wipe28 = \{ \.\.\.createCheckerboard\(\), pending: \{ run \} \}/);
    // update() runs the recorded thunk once the 29-record schedule completes.
    assert.match(SRC, /state\.wipe28 = null;\s*\n\s*p\.run\(\);/);
});

test("every player-facing field battle routes through the one shared handoff", () => {
    const player = playerSection();

    const wrapped = [...player.matchAll(HANDOFF)];
    assert.ok(
        wrapped.length >= 8,
        `expected the shared handoff at every field-battle call site, found ${wrapped.length}`,
    );

    // Strip every wrapped launch; nothing else may remain in the player section.
    const leftover = [...player.replace(HANDOFF, "/* shared handoff */").matchAll(DIRECT)]
        .map((m) => m[0]);
    assert.deepEqual(
        leftover,
        [],
        "a player-facing battle launch skips the shared startFieldBattle handoff",
    );
});

test("MUTATION: reintroducing a direct launch outside the handoff is caught", () => {
    const player = playerSection();
    const injected = `${player}\nbattle.startParty(party, onWin, onLose);\n`;
    const leftover = [...injected.replace(HANDOFF, "/* shared */").matchAll(DIRECT)];
    assert.ok(leftover.length > 0, "the census detects a per-site launch");
});
