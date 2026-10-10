// Phase 4 oracle: engine/dw3/ui/partner-select-move.ts's partnerSelectMove must
// match pro/stdgname F0x80085B70 (partner_select_move). The original runs through
// engine/native on the shipped pro_stdgname.bin + resident.bin with the pad
// service cells, the sound cell and the cancel callback stubbed; the port runs
// against the same memory and a host that logs the identical call stream.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    PARTNER_MOVE_BLIP, PARTNER_MOVE_BUTTON_CANCEL, PARTNER_MOVE_BUTTON_CONFIRM,
    PARTNER_MOVE_BUTTON_DOWN, PARTNER_MOVE_BUTTON_UP, PARTNER_MOVE_CANCEL_VALUE,
    PARTNER_MOVE_CONFIRM, PARTNER_MOVE_INDEX_CELL, partnerSelectMove,
} from "../engine/dw3/ui/partner-select-move.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdgname.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const FN = 0x80085b70;
const OBJ = 0x80155000;
const PARENT = 0x80156000;
const PAD_A = 0x0fe01004;
const PAD_B = 0x0fe01008;
const PAD_BIT = 0x0fe0100c;
const SOUND = 0x0fe01010;
const CANCEL = 0x0fe01000;

let EVENTS = [];
const PAD = { a: 0, b: 0 };

const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
    image: resident,
    base: 0x80010000,
});

rt.cpu.setStub(PAD_A, (c) => { EVENTS.push(["padA", c.reg(4) | 0]); return PAD.a; });
rt.cpu.setStub(PAD_B, (c) => { EVENTS.push(["padB", c.reg(4) | 0]); return PAD.b; });
rt.cpu.setStub(PAD_BIT, (c) => { EVENTS.push(["bit", c.reg(4) | 0, c.reg(5) | 0]); return c.reg(5) | 0; });
rt.cpu.setStub(SOUND, (c) => { EVENTS.push(["sound", c.reg(4) >>> 0]); return 0; });
rt.cpu.setStub(CANCEL, (c) => { EVENTS.push(["cancel", c.reg(4) | 0]); return 0; });

rt.mem.write32(0x8004b7d0 + 0x3f4, PAD_A);
rt.mem.write32(0x8004b7d0 + 0x3fc, PAD_B);
rt.mem.write32(0x8004b7d0 + 0x408, PAD_BIT);
rt.mem.write32(0x80055c48, SOUND);

const portHost = {
    padA() { EVENTS.push(["padA", 0]); return PAD.a; },
    padB() { EVENTS.push(["padB", 0]); return PAD.b; },
    padBit(code) { EVENTS.push(["bit", 0, code | 0]); return code | 0; },
    playSound(id) { EVENTS.push(["sound", id >>> 0]); },
    parentCancel(parent) { EVENTS.push(["cancel", parent | 0]); },
};

const CASES = [
    { name: "up on pad A", n: 3, index: 0, a: 1 << 4 },
    { name: "down on pad A", n: 3, index: 2, a: 1 << 6 },
    { name: "up on pad B only", n: 3, index: 1, b: 1 << 4 },
    { name: "down on pad B only", n: 3, index: 1, b: 1 << 6 },
    { name: "up at the first entry", n: 1, index: 0, a: 1 << 4 },
    { name: "down at the last entry", n: 1, index: 0, a: 1 << 6 },
    { name: "up and down together", n: 3, index: 1, a: (1 << 4) | (1 << 6) },
    { name: "confirm on pad A", n: 3, index: 1, a: 1 << 0xd },
    { name: "confirm on pad B is ignored", n: 3, index: 1, b: 1 << 0xd },
    { name: "cancel on pad A", n: 3, index: 1, a: 1 << 0xe },
    { name: "cancel on pad B is ignored", n: 3, index: 1, b: 1 << 0xe },
    { name: "up with no entries wraps below zero", n: 0, index: 0, a: 1 << 4 },
    { name: "down past the last entry", n: 3, index: 5, a: 1 << 6 },
    { name: "the top pad bit is not a move", n: 3, index: 1, a: 1 << 31 },
    { name: "a neighbouring button bit is not up", n: 3, index: 1, a: 1 << 5 },
    { name: "a neighbouring button bit is not down", n: 3, index: 1, a: 1 << 7 },
    { name: "no input", n: 3, index: 1 },
];

function seed({ n, index, a = 0, b = 0 }) {
    EVENTS = [];
    rt.mem.write32(OBJ + 0x50, PARENT);
    rt.mem.write32(OBJ + 0x78, n);
    rt.mem.write32(PARENT + 0x60, 0xdead);
    rt.mem.write32(PARENT + 0x68, CANCEL);
    rt.mem.write32(PARTNER_MOVE_INDEX_CELL, index);
    PAD.a = a;
    PAD.b = b;
}

function state() {
    return {
        index: rt.mem.read32(PARTNER_MOVE_INDEX_CELL) | 0,
        parent: rt.mem.read32(PARENT + 0x60) | 0,
    };
}

test("partnerSelectMove matches F0x80085B70", () => {
    for (const scenario of CASES) {
        seed(scenario);
        const oracleRet = rt.cpu.call(FN, [OBJ], 200000) | 0;
        const oracleLog = EVENTS.map((e) => e.map((v) => v | 0));
        const oracleState = state();

        seed(scenario);
        const ret = partnerSelectMove(rt.mem, OBJ, portHost) | 0;
        const portLog = EVENTS.map((e) => e.map((v) => v | 0));
        const portState = state();

        assert.deepEqual(portLog, oracleLog, `${scenario.name}: calls`);
        assert.equal(ret, oracleRet, `${scenario.name}: return`);
        assert.deepEqual(portState, oracleState, `${scenario.name}: memory`);
    }
});

test("the recorded cursor, wrap and sound behaviour", () => {
    seed({ n: 3, index: 0, a: 1 << 4 });
    partnerSelectMove(rt.mem, OBJ, portHost);
    assert.equal(rt.mem.read32(PARTNER_MOVE_INDEX_CELL) | 0, 2, "up from the first entry wraps to n-1");
    assert.equal(EVENTS.filter((e) => e[0] === "sound")[0][1] >>> 0, PARTNER_MOVE_BLIP, "the move blip");
    assert.deepEqual(EVENTS.filter((e) => e[0] === "padA").length, 3,
        "pad A is read for up, confirm and cancel (up did not need pad B)");
    assert.deepEqual(EVENTS.filter((e) => e[0] === "padB").length, 0,
        "pad B is only read when pad A is clear for that code");

    seed({ n: 3, index: 1, b: 1 << 4 });
    partnerSelectMove(rt.mem, OBJ, portHost);
    assert.equal(EVENTS.filter((e) => e[0] === "padB").length, 1, "an up on pad B reads it once");
    assert.equal(rt.mem.read32(PARTNER_MOVE_INDEX_CELL) | 0, 0, "pad B moves the cursor too");

    seed({ n: 3, index: 2, a: 1 << 6 });
    partnerSelectMove(rt.mem, OBJ, portHost);
    assert.equal(rt.mem.read32(PARTNER_MOVE_INDEX_CELL) | 0, 0, "down from the last entry wraps to 0");

    seed({ n: 0, index: 0, a: 1 << 4 });
    partnerSelectMove(rt.mem, OBJ, portHost);
    assert.equal(rt.mem.read32(PARTNER_MOVE_INDEX_CELL) | 0, -1, "an empty list wraps to -1, not a clamp");

    seed({ n: 3, index: 5, a: 1 << 6 });
    partnerSelectMove(rt.mem, OBJ, portHost);
    assert.equal(rt.mem.read32(PARTNER_MOVE_INDEX_CELL) | 0, 0, "an out-of-range index wraps to 0");

    seed({ n: 3, index: 1, a: 1 << 0xd });
    assert.equal(partnerSelectMove(rt.mem, OBJ, portHost), 1, "confirm returns 1");
    assert.equal(rt.mem.read32(PARENT + 0x60) | 0, 1, "confirm stores the cursor into the parent");
    assert.equal(EVENTS.filter((e) => e[0] === "sound")[0][1] >>> 0, PARTNER_MOVE_CONFIRM, "the confirm sound");

    seed({ n: 3, index: 1, a: 1 << 0xe });
    assert.equal(partnerSelectMove(rt.mem, OBJ, portHost), 1, "cancel returns 1");
    assert.equal(rt.mem.read32(PARENT + 0x60) | 0, -1, "cancel stores -1");
    const cancelSound = EVENTS.filter((e) => e[0] === "sound")[0][1] >>> 0;
    assert.equal(cancelSound, PARTNER_MOVE_CANCEL_VALUE, "the cancel value is passed whole");
    assert.equal(EVENTS.filter((e) => e[0] === "cancel").length, 1, "cancel calls the parent callback");

    seed({ n: 3, index: 1, b: 1 << 0xd });
    assert.equal(partnerSelectMove(rt.mem, OBJ, portHost), 0, "confirm ignores pad B");
    seed({ n: 3, index: 1 });
    assert.equal(partnerSelectMove(rt.mem, OBJ, portHost), 0, "no input returns 0");

    // The pad shift service is a host boundary: the original calls it with port
    // 0 at every site (authority 2), so the oracle pins that argument.
    seed({ n: 3, index: 1, a: (1 << 4) | (1 << 6) });
    rt.cpu.call(FN, [OBJ], 200000);
    const bits = EVENTS.filter((e) => e[0] === "bit");
    assert.deepEqual(bits.map((e) => e[2]), [4, 0xd, 0xe],
        "one shift per tested code: up, then confirm, then cancel");
    for (const e of bits) assert.equal(e[1], 0, "every shift call passes port 0");
    assert.equal(PARTNER_MOVE_BUTTON_UP, 4);
    assert.equal(PARTNER_MOVE_BUTTON_DOWN, 6);
    assert.equal(PARTNER_MOVE_BUTTON_CONFIRM, 0xd);
    assert.equal(PARTNER_MOVE_BUTTON_CANCEL, 0xe);
});
