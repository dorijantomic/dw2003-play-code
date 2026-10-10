// Lane B Phase 4 oracle: engine/dw3/ui/native/pause-items-tick.ts must match the
// original pro/ststatus F0x80090264 item-grid state machine.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// row fill, animation helpers, item scene, ability service, widget activate/ready
// services, pad, sound, resource base and every widget/object method are stubbed
// on both sides so the ordered calls and the screen fields can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { pauseItemsTick } from "../../engine/dw3/ui/native/pause-items-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const status = new Uint8Array(readFileSync(join(dir, "pro_ststatus.bin")));
const entry = { size: status.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARG1 = 0x80155000;
const HOLDER = 0x80160000;
const RES_PTR = 0x80170000;

const ROW_FILL_FN = 0x8008ed04;
const ANIM_START_FN = 0x8008f4e8;
const ANIM_FINISH_FN = 0x8008f584;
const ANIM_ACTIVE_FN = 0x8008f55c;
const OPEN_ITEM_FN = 0x80093678;
const ABILITY_PTR = 0x80042ba4;
const ACT_PTR = 0x8009b5d8;
const READY_PTR = 0x8009b5dc;
const TEXT_PTR = 0x80044b38 + 0x414;
const PAD_A_PTR = 0x8004b7d0 + 0x3f4;
const PAD_B_PTR = 0x8004b7d0 + 0x3fc;
const PAD_BUTTON_PTR = 0x8004b7d0 + 0x408;
const LAYOUT_PTR = 0x8009af6c;

const ROW_STUB = 0x0fe10000;
const ANIM_START_STUB = 0x0fe10004;
const ANIM_FINISH_STUB = 0x0fe10008;
const ANIM_ACTIVE_STUB = 0x0fe1000c;
const OPEN_ITEM_STUB = 0x0fe10010;
const ABILITY_STUB = 0x0fe10014;
const ACT_STUB = 0x0fe10018;
const READY_STUB = 0x0fe1001c;
const TEXT_STUB = 0x0fe10020;
const PAD_A_STUB = 0x0fe10024;
const PAD_B_STUB = 0x0fe10028;
const PAD_BUTTON_STUB = 0x0fe1002c;
const SLOT_BASE = 0x0fe12000;

const SLOT_ARITY = { 0x2c: 1, 0x3c: 0, 0x80: 1, 0x84: 2, 0x88: 1, 0x94: 1, 0x114: 2, 0x118: 2, 0x144: 1, 0x148: 1 };
const SLOTS = Object.keys(SLOT_ARITY).map(Number);
const WIDGET_OFFSETS = [0x00, 0x88, 0x8c, 0x9c, 0xa0, 0xa4, 0xa8, 0xac, 0xb0, 0xb4, 0xb8];

const LOG = [];
const CONTROL = { animActive: 0, openItem: 5, ability: 1, ready: 0, padA: 0, padB: 0 };

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound(id) { LOG.push(["sound", id | 0]); } };
    const rt = new NativeStageRuntime(status, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(ROW_FILL_FN, (c) => { LOG.push(["rowFill", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
    rt.cpu.setStub(ANIM_START_FN, (c) => { LOG.push(["animStart", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(ANIM_FINISH_FN, (c) => { LOG.push(["animFinish", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(ANIM_ACTIVE_FN, (c) => { LOG.push(["animActive", c.reg(4) | 0]); return CONTROL.animActive; });
    rt.cpu.setStub(OPEN_ITEM_FN, (c) => { LOG.push(["openItem", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return CONTROL.openItem; });
    rt.cpu.setStub(ABILITY_STUB, (c) => { LOG.push(["ability", c.reg(4) | 0, c.reg(5) | 0]); return CONTROL.ability; });
    rt.cpu.setStub(ACT_STUB, (c) => { LOG.push(["act", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(READY_STUB, (c) => { LOG.push(["ready", c.reg(4) | 0]); return CONTROL.ready; });
    rt.cpu.setStub(TEXT_STUB, (c) => { LOG.push(["text", c.reg(4) | 0]); return RES_PTR; });
    rt.cpu.setStub(PAD_A_STUB, (c) => { LOG.push(["padA", c.reg(4) | 0]); return CONTROL.padA; });
    rt.cpu.setStub(PAD_B_STUB, (c) => { LOG.push(["padB", c.reg(4) | 0]); return CONTROL.padB; });
    rt.cpu.setStub(PAD_BUTTON_STUB, (c) => { LOG.push(["padButton", c.reg(4) | 0, c.reg(5) | 0]); return c.reg(5) | 0; });
    for (const slot of SLOTS) {
        rt.cpu.setStub(SLOT_BASE + slot, (c) => {
            const args = [];
            for (let i = 0; i < SLOT_ARITY[slot]; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }

    rt.mem.write32(ABILITY_PTR, ABILITY_STUB);
    rt.mem.write32(ACT_PTR, ACT_STUB);
    rt.mem.write32(READY_PTR, READY_STUB);
    rt.mem.write32(TEXT_PTR, TEXT_STUB);
    rt.mem.write32(PAD_A_PTR, PAD_A_STUB);
    rt.mem.write32(PAD_B_PTR, PAD_B_STUB);
    rt.mem.write32(PAD_BUTTON_PTR, PAD_BUTTON_STUB);
    return rt;
}

function seed(rt, c) {
    for (let i = 0; i < 0x500; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x0c, c.screenState ?? 1);
    rt.mem.write32(OBJ + 0x10, c.state ?? 0);
    rt.mem.write32(OBJ + 0x14, c.sub ?? 0);
    rt.mem.write32(OBJ + 0x5c, c.count ?? 0);
    rt.mem.write32(OBJ + 0x70, c.index ?? 0);
    rt.mem.write32(OBJ + 0x78, c.subIndex ?? 0);
    rt.mem.write32(OBJ + 0x7c, c.result ?? 0);
    rt.mem.write32(OBJ + 0x2c, SLOT_BASE + 0x2c);
    rt.mem.write32(OBJ + 0x3c, SLOT_BASE + 0x3c);

    for (let i = 0; i < 0x120; i += 4) rt.mem.write32(ARG1 + i, 0);
    rt.mem.write32(ARG1 + 0xd0, c.argD0 ?? 0);
    for (let i = 0; i < WIDGET_OFFSETS.length; i++) {
        const w = HOLDER + i * 0x200;
        rt.mem.write32(ARG1 + WIDGET_OFFSETS[i], w);
        for (const slot of SLOTS) rt.mem.write32(w + slot, SLOT_BASE + slot);
    }
    rt.mem.write32(HOLDER + 0x1000 + 0xb4, c.footerBase ?? 3);
    rt.mem.write32(LAYOUT_PTR, HOLDER + 0x1000);
    rt.mem.write32(0x8005cca8, 0x801c0000);
    for (let i = 0; i < 6; i++) rt.mem.write32(0x8009a890 + i * 4, 0x4000 + i);

    CONTROL.animActive = c.animActive ?? 0;
    CONTROL.openItem = c.openItem ?? 5;
    CONTROL.ability = c.ability ?? 1;
    CONTROL.ready = c.ready ?? 0;
    CONTROL.padA = c.padA ?? 0;
    CONTROL.padB = c.padB ?? 0;
}

function portHost(rt) {
    return {
        rowFill(obj, a1, index, flag) { LOG.push(["rowFill", obj | 0, a1 | 0, index | 0, flag | 0]); },
        animStart(obj, flag) { LOG.push(["animStart", obj | 0, flag | 0]); },
        animFinish(obj, a1) { LOG.push(["animFinish", obj | 0, a1 | 0]); },
        animActive(obj) { LOG.push(["animActive", obj | 0]); return CONTROL.animActive; },
        openItem(obj, index, sub) { LOG.push(["openItem", obj | 0, index | 0, sub | 0]); return CONTROL.openItem; },
        ability(record, arg) { LOG.push(["ability", record | 0, arg | 0]); return CONTROL.ability; },
        widgetAct(ptr, flag) { LOG.push(["act", ptr | 0, flag | 0]); },
        widgetReady(ptr) { LOG.push(["ready", ptr | 0]); return CONTROL.ready; },
        resourceBase(id) { LOG.push(["text", id | 0]); return RES_PTR; },
        playSound(id) { LOG.push(["sound", id | 0]); },
        padReadA(port) { LOG.push(["padA", port | 0]); return CONTROL.padA; },
        padReadB(port) { LOG.push(["padB", port | 0]); return CONTROL.padB; },
        padButton(port, code) { LOG.push(["padButton", port | 0, code | 0]); return code | 0; },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

function fields(rt) {
    const out = [];
    for (const off of [0x0c, 0x10, 0x14, 0x70, 0x3ac, 0x3b0, 0x3b4, 0x3c0]) out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    out.push(`d0=${rt.mem.read32(ARG1 + 0xd0) >>> 0}`);
    return out;
}

const CASES = [
    { name: "default count 0", state: 0, count: 0 },
    { name: "default count 1", state: 0, count: 1, sub: 0 },
    { name: "default count 1 sub 1", state: 0, count: 1, sub: 1 },
    { name: "default count 2", state: 0, count: 2 },
    { name: "default count 4", state: 0, count: 4 },
    { name: "state 1 ready", state: 0x1, count: 2, index: 3, ready: 1 },
    { name: "state 1 not ready", state: 0x1, count: 2, ready: 0 },
    { name: "state 2", state: 0x2, count: 1, ready: 1 },
    { name: "state 3", state: 0x3, count: 1, ready: 1 },
    { name: "state 4", state: 0x4, count: 2, index: 1, ready: 1 },
    { name: "state 5", state: 0x5, count: 2, ready: 1 },
    { name: "state 6", state: 0x6, count: 3, index: 2, ready: 1 },
    { name: "state A idle", state: 0x0a, count: 2, index: 2 },
    { name: "state A down", state: 0x0a, count: 2, index: 1, padA: 1 << 4 },
    { name: "state A down floor", state: 0x0a, count: 2, index: 0, padA: 1 << 4 },
    { name: "state A up", state: 0x0a, count: 2, index: 2, padA: 1 << 6 },
    { name: "state A up ceiling", state: 0x0a, count: 2, index: 4, padA: 1 << 6 },
    { name: "state A use", state: 0x0a, count: 2, index: 2, padA: 1 << 0x0d, ability: 1 },
    { name: "state A use fail", state: 0x0a, count: 2, index: 2, padA: 1 << 0x0d, ability: 0 },
    { name: "state A cancel", state: 0x0a, count: 2, index: 2, padA: 1 << 0x0e },
    { name: "state B", state: 0x0b, count: 2 },
    { name: "state C open", state: 0x0c, count: 2, index: 1, ready: 1 },
    { name: "state F active", state: 0x0f, animActive: 1 },
    { name: "state F idle", state: 0x0f, animActive: 0 },
    { name: "state 10 new", state: 0x10, argD0: 1, result: -1 },
    { name: "state 10 close", state: 0x10, argD0: 1, result: -2 },
    { name: "state 10 else", state: 0x10, argD0: 1, result: 3 },
    { name: "state 10 busy", state: 0x10, argD0: 0 },
    { name: "state 14", state: 0x14, count: 2 },
    { name: "state 15 single", state: 0x15, count: 1, ready: 1 },
    { name: "state 15 many", state: 0x15, count: 2, ready: 1 },
    { name: "state 16 done", state: 0x16, count: 2, ready: 1 },
    { name: "state 16 more", state: 0x16, count: 3, ready: 1 },
    { name: "state 17", state: 0x17, count: 3, ready: 1 },
    { name: "state 18", state: 0x18 },
    { name: "state 19 idle", state: 0x19, count: 3, index: 1 },
    { name: "state 19 down", state: 0x19, count: 3, index: 1, padA: 1 << 4 },
    { name: "state 19 up", state: 0x19, count: 3, index: 1, padA: 1 << 6 },
    { name: "state 19 confirm", state: 0x19, count: 3, index: 1, padA: 1 << 0x0d },
    { name: "state 19 cancel", state: 0x19, count: 3, index: 1, padA: 1 << 0x0e },
    { name: "state 1A advance", state: 0x1a, ready: 1, animActive: 1 },
    { name: "state 1A hold", state: 0x1a, ready: 0, animActive: 0 },
    { name: "state 1B default", state: 0x1b, count: 1 },
    { name: "state 1B count 2", state: 0x1b, count: 2 },
    { name: "state 1B count 3", state: 0x1b, count: 3 },
    { name: "state 1C", state: 0x1c, ready: 1 },
    { name: "state 1D", state: 0x1d, ready: 1 },
    { name: "state 1E", state: 0x1e, index: 2, subIndex: 1, ready: 1 },
    { name: "state 28", state: 0x28 },
    { name: "state 32 default", state: 0x32, count: 1 },
    { name: "state 32 count 2", state: 0x32, count: 2 },
    { name: "state 32 count 3", state: 0x32, count: 3 },
    { name: "state 33", state: 0x33, ready: 1 },
    { name: "state 34", state: 0x34, ready: 1 },
    { name: "state 35", state: 0x35, ready: 1 },
    { name: "state 36", state: 0x36, ready: 1 },
    { name: "state 37", state: 0x37, ready: 1 },
    { name: "state 38", state: 0x38, ready: 1 },
    { name: "state 64 active", state: 0x64, animActive: 1 },
    { name: "state 64 idle", state: 0x64, animActive: 0 },
    { name: "state 65 use", state: 0x65, index: 2, padA: 1 << 0x0d, ability: 1 },
    { name: "state 65 fail", state: 0x65, index: 2, padA: 1 << 0x0d, ability: 0 },
    { name: "state 66", state: 0x66, ready: 1 },
    { name: "state 6E", state: 0x6e, index: 1 },
    { name: "state 6F cancel", state: 0x6f, index: 1, padA: 1 << 0x0e },
    { name: "state 6F idle", state: 0x6f, index: 1 },
];

test("pauseItemsTick matches F0x80090264", () => {
    const rt = runtime();
    for (const c of CASES) {
        seed(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80090264, [OBJ, ARG1], 40000);
        const olog = LOG.slice();
        const ofields = fields(rt);

        seed(rt, c);
        LOG.length = 0;
        pauseItemsTick(rt.mem, OBJ, ARG1, portHost(rt));
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fields(rt), ofields, `${c.name}: fields`);
    }
});
