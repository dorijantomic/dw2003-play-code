// Card 04-ailment-lock-bits: the record's +0x1c byte has ONE builder.
//
// The original ORs two locks into that same byte -- FIGHTSTG_F0x8009cd1c:
//   `lbu $v0, 0x1c($v1)` / `ori $v0, 0x10` / `sb $v0, 0x1c($v1)`   (cannot flee)
//   `lbu $v0, 0x1c($v1)` / `ori $v0, 0x20` / `sb $v0, 0x1c($v1)`   (cannot digivolve)
// (exe-decomp/fightstg.fns.s:27253-27259) and the marker loop reads the whole byte
// with one test -- `lbu $v0, 0x1c($s1)` / `bnez $v0` / `li $a1, 0x3` (:17473-17476) --
// so a locked member shows the afflicted marker exactly like a poisoned one.
// The HP-plate writer and the command rows must therefore build the same byte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { battleAilmentByte } from "../web/battlecmd-translated.js";
import { battleHudPartyPips } from "../web/battlehud-translated.js";

test("battleAilmentByte carries both lock bits beside the four ailments", () => {
    assert.equal(battleAilmentByte({}), 0x00);
    assert.equal(battleAilmentByte({ ailments: { poison: true, sleep: true } }), 0x09);
    assert.equal(battleAilmentByte({ cantFlee: true }), 0x10);
    assert.equal(battleAilmentByte({ cantDigivolve: true }), 0x20);
    // Invented combination: sleep + confusion + both locks.
    assert.equal(battleAilmentByte({
        ailments: { sleep: true, confuse: true }, cantFlee: true, cantDigivolve: true,
    }), 0x3c);
    // A pre-built byte passes through whole, mask and all (only eight bits exist).
    assert.equal(battleAilmentByte({ statusBits: 0x31 }), 0x31);
    assert.equal(battleAilmentByte({ statusBits: 0x1f0 }), 0xf0);
});

test("the HP plate writes the lock bits, so a locked member draws the state-3 marker", () => {
    // Invented numbers. Active slot 0, full HP: without a lock the marker is state 0
    // (cel 0x0c); a flee lock must be visible in the same cel range as an ailment.
    const locked = { hp: 57, maxHp: 57, cantFlee: true };
    const plain = { hp: 57, maxHp: 57 };
    const markerOf = (member) => battleHudPartyPips([member, null, null], [null, null, null],
        { activePlayerIndex: 0 })[0];

    const withLock = markerOf(locked);
    assert.equal(withLock.state, 3);
    assert.equal(withLock.cel, 0x0f);

    const withoutLock = markerOf(plain);
    assert.equal(withoutLock.state, 0);
    assert.equal(withoutLock.cel, 0x0c);

    // And the digivolve lock travels the same road.
    assert.equal(markerOf({ hp: 12, maxHp: 12, cantDigivolve: true }).state, 3);
});
