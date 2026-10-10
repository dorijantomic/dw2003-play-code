// Lane B oracle for FIGHTSTG_F0x8009d61c — the signature-weapon drain applier
// (fightstg.s:27674-27730): call the land roll, and on a hit compute the heal as
// `(hit-damage · ratio) >> 7` with a +0x7f correction before the arithmetic shift,
// the ratio doubled when the victim-side AuraPlug byte is set. Ported as
// engine/dw3/battle-combat.ts#weaponDrainHeal, with the flat roll `(rand & 0x7f) < proc`
// being F0x800a1308 and the ratio the weapon's own stat record byte +0x36.
//
// The oracle below pins the two boundaries the assembly carries: the STRICT `< proc`
// comparison (rand == proc is a miss, not a hit) and the `>> 7` with its +0x7f
// sign-fix (so the heal is floor(damage·ratio/128), never rounded up). The weapon ids
// are real disc ids (CrimsonBlade 94 / Fang 147 / SaberFang 173) so the ratio is the
// disc's own (32 / 64 / 96), not a walker constant.

import { test } from "node:test";
import assert from "node:assert/strict";
import { weaponDrainHeal } from "../../engine/dw3/battle-combat.ts";
import { weaponSecondary } from "../../engine/dw3/equipment.ts";

const at = (v) => () => v;

test("0x8009d61c weaponDrainHeal: the roll is strict `rand & 0x7f < proc`", () => {
    // CrimsonBlade (94): proc 32. rand 31 lands; 32 does not; 127 does not.
    assert.deepEqual(weaponSecondary(94), { kind: "drain", proc: 32, value: 32 });
    assert.equal(weaponDrainHeal({}, 94, 400, at(31)), 100);
    assert.equal(weaponDrainHeal({}, 94, 400, at(32)), 0);
    assert.equal(weaponDrainHeal({}, 94, 400, at(127)), 0);
});

test("0x8009d61c weaponDrainHeal: heal = floor(damage·ratio/128); Aura doubles the ratio", () => {
    // value 32 -> damage/4. 403·32/128 = 100.75 -> the >>7 truncates to 100.
    assert.equal(weaponDrainHeal({}, 94, 403, at(0)), 100);
    // AuraPlug doubles the ratio -> value 64 -> damage/2, still truncated.
    assert.equal(weaponDrainHeal({ aura: true }, 94, 403, at(0)), 201);
    // A zero-damage hit heals nothing.
    assert.equal(weaponDrainHeal({}, 94, 0, at(0)), 0);
    // A negative product is the sign-fix case: floor, never ceil (the +0x7f then `sra 7`).
    assert.equal(weaponDrainHeal({}, 94, 1, at(0)), 0);
});

test("0x8009d61c weaponDrainHeal: the heavier rungs, and a weapon that is no drain", () => {
    // Fang (147): proc 64, value 64 -> damage/2. SaberFang (173): value 96 -> 3/4.
    assert.deepEqual(weaponSecondary(147), { kind: "drain", proc: 64, value: 64 });
    assert.equal(weaponDrainHeal({}, 147, 400, at(31)), 200);
    assert.equal(weaponDrainHeal({}, 173, 400, at(31)), 300);
    // ShockHorn (1) carries no proc byte, and null names no weapon: nothing to heal.
    assert.equal(weaponSecondary(1), null);
    assert.equal(weaponDrainHeal({}, 1, 400, at(0)), 0);
    assert.equal(weaponDrainHeal({}, null, 400, at(0)), 0);
});
