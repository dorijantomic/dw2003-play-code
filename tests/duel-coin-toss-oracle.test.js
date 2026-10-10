// Oracle: engine/dw3/ui/duel-effect-ops.ts must reproduce pro/cardgame's coin
// toss start F0x8008985C (effect opcode 0xA7's enter arm).
//
// The original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin with its three callees stubbed to recording stubs: the resident
// random word's target (RAND_U16 0x8001933C, reached through [0x8004DC0C]) and
// the two board-view slots (VIEW+0xF14 placeCardResetVisual, VIEW+0xF3C
// bindSlotToCard). Only the routine's own stores and the ordered call log are
// compared.
//
// The fields the routine branches on are varied independently: the random word
// (both bit values) and the whole seeded duel/view span. A mutant that binds the
// winning face to the wrong slot must fail, and so must one that skips the four
// scratch clears — the test proves its own discrimination.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { effectOpA7StartCoinToss } from "../engine/dw3/ui/duel-effect-ops.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const COIN_TOSS = 0x8008985c;
const RAND_U16 = 0x8001933c;
const SLOT_POS = 0x8000ff00;   // stands in for VIEW+0xF14
const SLOT_BIND = 0x8000ff10;  // stands in for VIEW+0xF3C

const DUEL = 0x80194000;
const VIEW = 0x80190000;
const VIEW_SLOT_POS_SLOT = 0x0f14;
const VIEW_SLOT_BIND_SLOT = 0x0f3c;

/** Every byte the routine can write, in the two objects. */
const DUEL_SPAN = [0x41c, 0x448];
const VIEW_SPAN = [0x118, 0x1a0];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seed(mem) {
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) mem.write8(DUEL + a, 0x5a);
    for (let a = VIEW_SPAN[0]; a < VIEW_SPAN[1]; a++) mem.write8(VIEW + a, 0x5a);
    mem.write32(VIEW + VIEW_SLOT_POS_SLOT, SLOT_POS);
    mem.write32(VIEW + VIEW_SLOT_BIND_SLOT, SLOT_BIND);
}

function duelFields(mem) {
    const out = [];
    for (let a = DUEL_SPAN[0]; a < DUEL_SPAN[1]; a++) out.push(mem.read8(DUEL + a));
    return out;
}
function viewFields(mem) {
    const out = [];
    for (let a = VIEW_SPAN[0]; a < VIEW_SPAN[1]; a++) out.push(mem.read8(VIEW + a));
    return out;
}

/** Run the original with the three callees stubbed, recording the call log. */
function runOriginal(rt, ev, randWord) {
    rt.cpu.setStub(RAND_U16, () => randWord & 0xffff);
    rt.cpu.setStub(SLOT_POS, (c) => {
        ev.push(["positionSlot", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(SLOT_BIND, (c) => {
        ev.push(["writeSlotValue", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return 0;
    });
    rt.cpu.call(COIN_TOSS, [DUEL, VIEW]);
}

function portHost(ev, randWord) {
    return {
        randomBit: () => randWord & 1,
        positionSlot: (v, i, x, y) => ev.push(["positionSlot", v >>> 0, i >>> 0, x >>> 0, y >>> 0]),
        writeSlotValue: (v, i, value) => ev.push(["writeSlotValue", v >>> 0, i >>> 0, value >>> 0]),
    };
}

// randWord picks the bit; 0x777 -> bit 1, 0x778 -> bit 0, 0x001 -> bit 1.
const CASES = [0x777, 0x778, 0x001, 0xabcc];

test("effectOpA7StartCoinToss matches F0x8008985C", () => {
    for (const randWord of CASES) {
        const evA = [];
        const a = runtime();
        seed(a.mem);
        runOriginal(a, evA, randWord);

        const evB = [];
        const b = runtime();
        seed(b.mem);
        effectOpA7StartCoinToss(b.mem, portHost(evB, randWord), DUEL, VIEW);

        assert.deepEqual(duelFields(b.mem), duelFields(a.mem), `rand ${randWord.toString(16)} duel`);
        assert.deepEqual(viewFields(b.mem), viewFields(a.mem), `rand ${randWord.toString(16)} view`);
        assert.deepEqual(evB, evA, `rand ${randWord.toString(16)} calls`);
        // the bit the routine decided is the random word's low bit
        assert.equal(a.mem.read32(DUEL + 0x434), randWord & 1);
    }
});

test("the face binding follows the flipped bit, and the call order is pinned", () => {
    // bit 1: face 0x57 -> slot 0, face 0x58 -> slot 1
    const a = runtime();
    seed(a.mem);
    const ev = [];
    runOriginal(a, ev, 0x777);
    assert.deepEqual(ev, [
        ["positionSlot", VIEW, 0, 0x7400, 0x6100],
        ["positionSlot", VIEW, 1, 0xa400, 0x6100],
        ["writeSlotValue", VIEW, 0, 0x57],
        ["writeSlotValue", VIEW, 1, 0x58],
    ]);
    assert.equal(a.mem.read8(VIEW + 0x14d), 2);
    assert.equal(a.mem.read8(DUEL + 0x422), 1);
    assert.equal(a.mem.read32(DUEL + 0x424), 0);
    assert.equal(a.mem.read32(DUEL + 0x43c), 0);

    // bit 0: the faces swap slots
    const b = runtime();
    seed(b.mem);
    const ev0 = [];
    runOriginal(b, ev0, 0x778);
    assert.deepEqual(ev0.slice(2), [
        ["writeSlotValue", VIEW, 1, 0x57],
        ["writeSlotValue", VIEW, 0, 0x58],
    ]);
});

test("mutants that mis-bind the face or skip the clears diverge", () => {
    const randWord = 0x777;
    const a = runtime();
    seed(a.mem);
    runOriginal(a, [], randWord);

    // mutant 1: bind face 0x57 to the wrong slot
    const misBind = (mem, h) => {
        h.positionSlot(VIEW, 0, 0x7400, 0x6100);
        h.positionSlot(VIEW, 1, 0xa400, 0x6100);
        h.writeSlotValue(VIEW, 1, 0x57);
        h.writeSlotValue(VIEW, 0, 0x58);
        mem.write32(DUEL + 0x434, 1);
        mem.write32(DUEL + 0x430, 0);
        mem.write32(DUEL + 0x42c, 0);
        mem.write32(DUEL + 0x428, 0);
        mem.write32(DUEL + 0x424, 0);
        mem.write8(VIEW + 0x14d, 2);
        mem.write8(VIEW + 0x199, 2);
        mem.write16(VIEW + 0x120, 0);
        mem.write8(VIEW + 0x151, 0);
        mem.write8(VIEW + 0x150, 0);
        mem.write16(VIEW + 0x16c, 0);
        mem.write8(VIEW + 0x19d, 0);
        mem.write8(VIEW + 0x19c, 0);
        mem.write32(DUEL + 0x43c, 0);
        mem.write32(DUEL + 0x440, 0);
        mem.write8(DUEL + 0x422, 1);
    };
    const m1ev = [];
    const b = runtime();
    seed(b.mem);
    misBind(b.mem, portHost(m1ev, randWord));
    // the mis-bind only shows in the call log (the slot bodies are stubbed here)
    assert.notDeepEqual(m1ev, [
        ["positionSlot", VIEW, 0, 0x7400, 0x6100],
        ["positionSlot", VIEW, 1, 0xa400, 0x6100],
        ["writeSlotValue", VIEW, 0, 0x57],
        ["writeSlotValue", VIEW, 1, 0x58],
    ], "the mis-bind must show in the call log");
    assert.equal(b.mem.read32(DUEL + 0x434), 1);

    // mutant 2: the same routine but 0x430 left un-cleared
    const noClear = (mem, h) => {
        effectOpA7StartCoinToss(mem, h, DUEL, VIEW);
        mem.write32(DUEL + 0x430, 0x5a5a5a5a);
    };
    const c = runtime();
    seed(c.mem);
    noClear(c.mem, portHost([], randWord));
    assert.notDeepEqual(duelFields(c.mem), duelFields(a.mem), "the un-cleared scratch is the telltale");
    assert.equal(a.mem.read32(DUEL + 0x430), 0);
});
