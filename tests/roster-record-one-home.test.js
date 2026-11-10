// One roster record read/write and one slot lookup (card 13-roster-record).
//
// The gym seed, the lab's seedSave and the fight report's seed each used to spell the
// record's field offsets out by hand, and six web screens each carried their own copy of
// ROSTER_SLOT_CHARIDS.indexOf with its own miss value. This file pins the one field map
// (engine/dw3/party-context.ts RECORD_FIELDS), the one writer over it, and the one slot
// lookup every caller now uses. Invented values only: no disc data is read here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    RECORD_EQUIPPED_VALUES, RECORD_FIELDS, RECORD_LEDGER_ENTRIES, RECORD_LEDGER_STRIDE,
    RECORD_NAME_BYTES, ROSTER_STRIDE, rosterRecordAddress, writeRosterRecord,
} from "../engine/dw3/party-context.ts";
import { ROSTER_SLOT_CHARIDS, rosterSlotOfCharId } from "../engine/dw3/roster.ts";

/** A little memory the writer can write into, standing in for NativeMemory. */
function memory(base, bytes = ROSTER_STRIDE) {
    const mem = new Uint8Array(base + bytes);
    const mem8 = (addr, value) => {
        assert.ok(addr >= base && addr < base + bytes, `write past the record: ${addr.toString(16)}`);
        mem[addr] = value & 0xff;
    };
    return {
        mem,
        base,
        read: (offset, width = 1) => {
            const at = base + offset;
            if (width === 1) return mem[at];
            if (width === 2) return mem[at] | (mem[at + 1] << 8);
            return (mem[at] | (mem[at + 1] << 8) | (mem[at + 2] << 16) | (mem[at + 3] << 24)) >>> 0;
        },
        write8: mem8,
        write16: (addr, value) => { mem8(addr, value); mem8(addr + 1, value >> 8); },
        write32: (addr, value) => {
            mem8(addr, value); mem8(addr + 1, value >> 8); mem8(addr + 2, value >> 16); mem8(addr + 3, value >>> 24);
        },
    };
}

const BASE = 0x1000;

test("the field map is the layout the three seeds used to spell by hand", () => {
    assert.deepEqual(RECORD_FIELDS, {
        slotWord: 0x00, currentForm: 0x04, name: 0x08, exp: 0x20, level: 0x24, tp: 0x26,
        hp: 0x28, maxHp: 0x2a, mp: 0x2c, maxMp: 0x2e, core: 0x30, elements: 0x3c,
        equipped: 0x50, ledger: 0x58, ultraByte: 0x3d4,
    });
    assert.equal(RECORD_NAME_BYTES, 23);
    assert.equal(RECORD_EQUIPPED_VALUES, 3);
    assert.equal(RECORD_LEDGER_ENTRIES, 44);
    assert.equal(RECORD_LEDGER_STRIDE, 0x14);
});

test("the writer puts every field at its mapped offset", () => {
    const m = memory(BASE);
    writeRosterRecord(m, BASE, {
        slotWord: 5, currentForm: 9, nameBytes: [0x41, 0x42], exp: 0x12345678,
        level: 0x0102, tp: 0x0304, hp: 0x0506, maxHp: 0x0708, mp: 0x090a, maxMp: 0x0b0c,
        core: [1, 2, 3, 4, 5, 6], elements: [7, 8, 9, 10, 11, 12, 13],
        equipment: { head: 0x11, body: 0x12, right: 0x13, left: 0x14, acc0: 0x15, acc1: 0x16 },
        equipped: [0x21, 0x22, 0x23], ultraByte: 0x7f,
    });
    assert.equal(m.read(RECORD_FIELDS.slotWord, 4), 5);
    assert.equal(m.read(RECORD_FIELDS.currentForm, 4), 9);
    assert.equal(m.read(RECORD_FIELDS.name), 0x41);
    assert.equal(m.read(RECORD_FIELDS.name + 1), 0x42);
    assert.equal(m.read(RECORD_FIELDS.name + 2), 0, "a short name is NUL-terminated");
    assert.equal(m.read(RECORD_FIELDS.exp, 4), 0x12345678);
    assert.equal(m.read(RECORD_FIELDS.level, 2), 0x0102);
    assert.equal(m.read(RECORD_FIELDS.tp, 2), 0x0304);
    assert.equal(m.read(RECORD_FIELDS.hp, 2), 0x0506);
    assert.equal(m.read(RECORD_FIELDS.maxHp, 2), 0x0708);
    assert.equal(m.read(RECORD_FIELDS.mp, 2), 0x090a);
    assert.equal(m.read(RECORD_FIELDS.maxMp, 2), 0x0b0c);
    for (let i = 0; i < 6; i++) assert.equal(m.read(RECORD_FIELDS.core + i * 2, 2), i + 1);
    for (let i = 0; i < 7; i++) assert.equal(m.read(RECORD_FIELDS.elements + i * 2, 2), i + 7);
    // The six equip halfwords keep the original's order: head, body, right, left, acc0, acc1.
    for (let i = 0; i < 6; i++) assert.equal(m.read(0x3c8 + i * 2, 2), 0x11 + i);
    for (let i = 0; i < RECORD_EQUIPPED_VALUES; i++) assert.equal(m.read(RECORD_FIELDS.equipped + i * 2, 2), 0x21 + i);
    assert.equal(m.read(RECORD_FIELDS.ultraByte), 0x7f);
});

test("an omitted field leaves the record as it was", () => {
    const m = memory(BASE);
    m.write32(BASE + RECORD_FIELDS.exp, 0xdeadbeef);
    writeRosterRecord(m, BASE, { level: 1 });
    assert.equal(m.read(RECORD_FIELDS.exp, 4), 0xdeadbeef, "a seed that knows no exp must not clear it");
    assert.equal(m.read(RECORD_FIELDS.level, 2), 1);
    assert.equal(m.read(RECORD_FIELDS.tp, 2), 0, "a seed always writes the stat halfwords it is given");
});

test("equipment is sanitised the way all three seeds sanitised it", () => {
    const m = memory(BASE);
    writeRosterRecord(m, BASE, { equipment: { head: 0, body: -3, right: 1.5, left: 0x10000, acc0: 0xffff, acc1: 42 } });
    const worn = Array.from({ length: 6 }, (_, i) => m.read(0x3c8 + i * 2, 2));
    assert.deepEqual(worn, [0, 0, 0, 0, 0xffff, 42]);
});

test("a long name is cut to 23 bytes and terminated", () => {
    const m = memory(BASE);
    writeRosterRecord(m, BASE, { nameBytes: Array.from({ length: 30 }, (_, i) => 0xa0 + i) });
    for (let i = 0; i < RECORD_NAME_BYTES; i++) assert.equal(m.read(RECORD_FIELDS.name + i), 0xa0 + i);
    assert.equal(m.read(RECORD_FIELDS.name + RECORD_NAME_BYTES), 0);
    assert.equal(m.read(RECORD_FIELDS.name + RECORD_NAME_BYTES + 1), 0, "nothing past the terminator is touched");
});

test("ledger entries are zeroed then filled, and a null entry is zeroed only", () => {
    const m = memory(BASE, 0x600);
    writeRosterRecord(m, BASE, {
        ledger: [
            { value: 0x0031, formLevel: 5, present: 1, dvexp: 0x00010002, techniques: [1, 2, 3, 4, 5, 6] },
            null,
            { value: 0x0032, formLevel: 6, present: 0, dvexp: 7, techniques: [9] },
        ],
    });
    const at = (i) => RECORD_FIELDS.ledger + i * RECORD_LEDGER_STRIDE;
    assert.equal(m.read(at(0), 2), 0x0031);
    assert.equal(m.read(at(0) + 2), 5);
    assert.equal(m.read(at(0) + 3), 1);
    assert.equal(m.read(at(0) + 4, 4), 0x00010002);
    for (let t = 0; t < 6; t++) assert.equal(m.read(at(0) + 8 + t * 2, 2), t + 1);
    for (let o = 0; o < RECORD_LEDGER_STRIDE; o++) assert.equal(m.read(at(1) + o), 0, "a null entry is still zeroed");
    assert.equal(m.read(at(2), 2), 0x0032);
    assert.equal(m.read(at(2) + 8, 2), 9);
});

test("the one slot lookup, and the miss every caller converts", () => {
    const known = ROSTER_SLOT_CHARIDS[3];
    assert.equal(rosterSlotOfCharId(String(known)), 3);
    assert.equal(rosterSlotOfCharId("not-a-partner"), null, "the engine helper's miss value is null");
    // The callers' own miss markers, each built on that null: -1, 0xffffffff, null.
    assert.equal(rosterSlotOfCharId("not-a-partner") ?? -1, -1);
    assert.equal(rosterSlotOfCharId("not-a-partner") ?? 0xffffffff, 0xffffffff);
    assert.equal(rosterSlotOfCharId("not-a-partner") ?? null, null);
    // A slot is still an index into the record base.
    assert.equal(rosterRecordAddress(3) - rosterRecordAddress(0), 3 * ROSTER_STRIDE);
});
