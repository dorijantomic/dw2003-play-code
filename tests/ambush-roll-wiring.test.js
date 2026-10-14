// The ambush roll's WIRING (web/battle.js).
//
// WFIGHTMN_rollAmbush (0x800a684c) reads the encounter's own three numbers —
// the chance byte [0x80042B1C]+0x3C, the first enemy's level [0x80042B1C]+0x1C
// and the first party member's level (record +0x784) — and rolls against the
// shared RANDOM.next; its return decides the battle's "Ambush!" page and the
// partner's opening form (claim wfightmn-rollambush-and-checkparty-2026-10-10,
// verified). The routine itself is pinned by
// tests/lane-b/battle-opening-machine.test.js, which executes the disc's own
// F0x800a684c out of pro_wfightmn.bin and compares it with the port.
//
// web/battle.js used to feed the port CONSTANTS ({lineWeight: 1, bias: 0,
// enemyField: 0, roll: 0}), which made the roll always true: every battle
// showed "Ambush!" and took the ambush branch, while 184 of the 334 shipped
// screens carry chance byte 0 and never ambush in the original. This census
// keeps the call site data-driven and the flee pages actor-keyed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");

test("the ambush roll is fed the encounter's own numbers, not constants", () => {
    const helper = SRC.match(/function introLinePendingFor\(b\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(helper, "introLinePendingFor is present");
    const body = helper[1];
    assert.match(body, /ambushRoll\(\{/, "the roll goes through the engine port");
    assert.match(body, /const chanceByte = b\.encounterGateBytes\?\.\[0\]/, "the encounter row's own byte");
    assert.match(body, /chanceByte,/, "the chance byte is what is rolled");
    assert.match(body, /partnerLevel: b\.player\?\.level/, "the first party member's level");
    assert.match(body, /enemyLevel: b\.enemy\?\.level/, "the first enemy's level");
    assert.match(body, /roll: RAND_U16\(\)/, "the shared random stream");
    // the port must ask for the helper (not re-inline a constant roll)
    assert.match(SRC, /introLinePending:\s*\(\)\s*=>\s*introLinePendingFor\(b\)/);
    // the old always-true call must not come back
    assert.ok(!SRC.includes("openingLineRoll({ lineWeight: b._introLineWeight"),
        "the constant roll call is gone");
});

test("the flee pages are actor-keyed through runAwayLine (0x43 player / 0x5F enemy)", () => {
    // an enemy's flee prints the enemy page; the player's Run prints the player's.
    // The enemy's outcome page is conditional since 2026-10-14 (0x5F on a successful
    // roll, 0x60 "Did not flee." on a failed one) — still actor-keyed through runAwayLine.
    assert.match(SRC, /payload:\s*\[fled\s*\?\s*runAwayLine\(0x10\)\s*:\s*MSG\.DID_NOT_FLEE\]/,
        "enemy flee -> 0x5F / 0x60");
    assert.match(SRC, /payload:\s*\[runAwayLine\(0\)\]/, "player Run -> 0x43");
    assert.ok(!SRC.includes("payload: [MSG.RUN_AWAY]"),
        "the enemy flee no longer borrows the player's 0x43 page");
});
