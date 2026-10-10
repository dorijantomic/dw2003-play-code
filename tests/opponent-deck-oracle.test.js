// Phase 4 oracle: engine/dw3/ui/opponent-deck.ts must reproduce pro/cardgame's
// loadOpponentDeck. The original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin with the pack-base getter stubbed to a seeded
// record area; the whole duel object the loader touches is compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    OPPONENT_DECK_ENTRIES,
    OPPONENT_DECK_FIELDS,
    OPPONENT_DECK_PACK_ID,
    OPPONENT_DECK_RECORD,
    OPPONENT_DECK_SLOT_LIMIT,
    OPPONENT_DECK_STRIDE,
    loadOpponentDeck,
} from "../engine/dw3/ui/opponent-deck.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const LOAD = 0x8009d6e0;
const GET_BASE = 0x80013e5c;
const DUEL = 0x80194000;
const PACK = 0x80180000;
const WINDOW = { from: 0x240, to: 0x440 };

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** Seeds the AI class's 0x130-byte record area for one class. */
function seedPack(rt, cls, o = {}) {
    const record = (PACK + cls * OPPONENT_DECK_STRIDE - 0xd0) | 0;
    for (let i = 0; i < WINDOW.to; i++) rt.mem.write8(record - 0xd0 + i, 0);
    for (let i = 0; i < OPPONENT_DECK_ENTRIES; i++) {
        const e = record + i * 4;
        const code = o.codes ? o.codes[i % o.codes.length] : (0x1000 | (i + 1));
        rt.mem.write16(e + OPPONENT_DECK_RECORD.code, code & 0xffff);
        rt.mem.write8(e + OPPONENT_DECK_RECORD.byte2, o.byte2s ? o.byte2s[i % o.byte2s.length] : (0x20 + i));
        const type = o.types ? o.types[i % o.types.length] : (((i % 7) + 1));
        rt.mem.write8(e + OPPONENT_DECK_RECORD.type, type);
    }
    // the phase-1 halfword area: `tailCount` non-zero halfwords then a zero one.
    // Seeded BEFORE the two scalar fields, because a record's tail area reaches
    // past +0xC8 in the game's own layout and those fields are read before the
    // walk: the scalars win here so each case's expectation stays exact.
    const tailCount = o.tailCount ?? 3;
    for (let j = 0; j < tailCount; j++) {
        rt.mem.write16(record + OPPONENT_DECK_RECORD.tail + j * 2, (o.tailByte ? o.tailByte(j) : (0x30 + j)) | ((0x40 + j) << 8));
    }
    rt.mem.write16(record + OPPONENT_DECK_RECORD.tail + tailCount * 2, 0);
    rt.mem.write8(record + OPPONENT_DECK_RECORD.byteC8, o.byteC8 ?? 0x11);
    rt.mem.write32(record + OPPONENT_DECK_RECORD.indexCC, o.indexCC ?? 0);
    return record;
}

function seedDuel(rt, cls) {
    for (let i = 0; i < 0x824; i++) rt.mem.write8(DUEL + i, 0);
    rt.mem.write8(DUEL + 0x2e8, cls);
}

function object(rt) {
    const out = [];
    for (let i = WINDOW.from; i < WINDOW.to; i++) out.push(rt.mem.read8(DUEL + i));
    return out;
}

const CASES = [
    { name: "class 1", cls: 1 },
    { name: "class 7", cls: 7 },
    { name: "every type value", cls: 3, types: [0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff] },
    { name: "tail stops immediately", cls: 2, tailCount: 0 },
    { name: "tail shorter than the terminator table", cls: 4, tailCount: 2 },
    { name: "tail runs to the 27-slot cap", cls: 5, tailCount: 30, tailByte: () => 0x21 },
    { name: "negative entry codes", cls: 6, codes: [0x8fff, 0x0000, 0xffff] },
    { name: "non-zero id index", cls: 1, indexCC: 3 },
];

test("loadOpponentDeck matches F0x8009D6E0", () => {
    for (const tc of CASES) {
        const evA = [];
        const a = runtime();
        a.cpu.setStub(GET_BASE, (c) => {
            evA.push(["resourceGetBase", c.reg(4) | 0]);
            return PACK;
        });
        seedPack(a, tc.cls, tc);
        seedDuel(a, tc.cls);
        a.cpu.call(LOAD, [DUEL]);

        const evB = [];
        const b = runtime();
        seedPack(b, tc.cls, tc);
        seedDuel(b, tc.cls);
        loadOpponentDeck(b.mem, {
            resourceGetBase: (id) => { evB.push(["resourceGetBase", id | 0]); return PACK; },
        }, DUEL);

        assert.deepEqual(object(b), object(a), tc.name);
        assert.deepEqual(evB, evA, `${tc.name} calls`);
        assert.deepEqual(evA, [["resourceGetBase", OPPONENT_DECK_PACK_ID]]);
        assert.equal(a.mem.read32(DUEL + OPPONENT_DECK_FIELDS.packBase) >>> 0, PACK >>> 0);
        assert.equal(a.mem.read8(DUEL + OPPONENT_DECK_FIELDS.byte2e9), b.mem.read8(DUEL + OPPONENT_DECK_FIELDS.byte2e9),
            `${tc.name} +0x2E9`);
        assert.equal(a.mem.read32(DUEL + OPPONENT_DECK_FIELDS.saveIndex) | 0,
            b.mem.read32(DUEL + OPPONENT_DECK_FIELDS.saveIndex) | 0, `${tc.name} +0x2EC`);
        // the id table is the shipped halfword table at 0x800A5C2C
        assert.equal(a.mem.read32(DUEL + OPPONENT_DECK_FIELDS.saveIndex) | 0, UINT(a, tc.indexCC ?? 0),
            `${tc.name} id table`);
    }
});

function UINT(rt, idIndex) {
    const table = 0x800a5c2c;
    return (rt.mem.read16(table + idIndex * 2) << 16) >> 16;
}

test("the loader's arrays and terminator are the shipped shapes", () => {
    const a = runtime();
    a.cpu.setStub(GET_BASE, () => PACK);
    seedPack(a, 1, {});
    seedDuel(a, 1);
    a.cpu.call(LOAD, [DUEL]);
    // the index pairs
    for (let i = 0; i < OPPONENT_DECK_ENTRIES; i++) {
        assert.equal(a.mem.read8(DUEL + OPPONENT_DECK_FIELDS.indexBase + i * 2), i, `index ${i}`);
        assert.equal(a.mem.read8(DUEL + OPPONENT_DECK_FIELDS.indexBase + i * 2 + 1), (0x20 + i) & 0xff);
    }
    // the type triples: type, sign, i + the class offset
    const OFFSETS = [0, 0x190, 0x12c, 0x1f4, 0xc8, 0x258, 0x64, 0x2bc];
    for (let i = 0; i < OPPONENT_DECK_ENTRIES; i++) {
        const type = (i % 7) + 1;
        assert.equal(a.mem.read8(DUEL + OPPONENT_DECK_FIELDS.typeBase + i * 4), type);
        assert.equal(a.mem.read8(DUEL + OPPONENT_DECK_FIELDS.typeBase + i * 4 + 1), 0, "sign bit of 0x1000|n is clear");
        assert.equal(a.mem.read16(DUEL + OPPONENT_DECK_FIELDS.typeBase + i * 4 + 2), (i + OFFSETS[type]) & 0xffff);
    }
    // the slot run: three written bytes then the fifteen-byte terminator table
    assert.deepEqual(
        [0, 1, 2].map((i) => a.mem.read8(DUEL + OPPONENT_DECK_FIELDS.slotBase + i)),
        [0x30 - 1, 0x31 - 1, 0x32 - 1],
    );
    const table = [7, 8, 0x18, 0x1f, 0x20, 0, 6, 0xc, 0x12, 0x1b, 0x1e, 0x21, 0x25, 0x26, 0xff];
    for (let k = 0; k < table.length; k++) {
        assert.equal(a.mem.read8(DUEL + OPPONENT_DECK_FIELDS.slotBase + 3 + k), table[k], `table byte ${k}`);
    }
    // the 40 card codes
    for (let i = 0; i < OPPONENT_DECK_ENTRIES; i++) {
        assert.equal(a.mem.read16(DUEL + OPPONENT_DECK_FIELDS.codeBase + i * 2),
            (((0x1000 | (i + 1)) & 0xfff) - 1) & 0xffff, `code ${i}`);
    }
    assert.equal(OPPONENT_DECK_SLOT_LIMIT, 0x1b);
});
