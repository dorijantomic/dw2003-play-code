// Phase 4 oracle: engine/dw3/ui/title-sequence-tick.ts#titleSequenceTick must
// match pro/stdwtitl F0x800869d0. The original runs through engine/native on the
// shipped overlay+resident with the seven child objects, the resident services
// and the frame delta recorded; the port uses an equivalent host over the same
// memory. Ordered calls, object fields and the return value are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { titleSequenceTick } from "../engine/dw3/ui/title-sequence-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF = 0x80180000;
const CHILD = 0x80181000;
const CHILDOBJ = (i) => 0x80182000 + i * 0x100;
const FADE_OBJ = 0x80183000;

const STUB_SLIDE = 0x0fe00010;
const STUB_DECO = 0x0fe00020;
const STUB_PROMPT = 0x0fe00030;
const STUB_CHOICE = 0x0fe00040;
const STUB_BG = 0x0fe00050;
const STUB_FADE = 0x0fe00060;
const STUB_DELTA = 0x0fe00070;
const STUB_SOUND = 0x0fe00080;
const STUB_SCREEN = 0x0fe00090;
const STUB_FADE_CREATE = 0x0fe000a0;
const STUB_DISPATCH = 0x0fe000b0;
const SET_STATE1 = 0x80014288;
const ADVANCE1 = 0x800142c8;

const SLOT_OF = new Map([
    [STUB_SLIDE, 0x70], [STUB_DECO, 0x78], [STUB_PROMPT, 0x9c],
    [STUB_CHOICE, 0xa4], [STUB_BG, 0x94], [STUB_FADE, 0x58],
]);

let EVENTS = [];
let CHOICE = 0;
let DELTA = 3;
let DISPATCH_RET = 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    for (const [stub, slot] of SLOT_OF) {
        rt.cpu.setStub(stub, (c) => {
            EVENTS.push(["call", slot, c.reg(4) >>> 0]);
            return slot === 0xa4 ? CHOICE : 0;
        });
    }
    rt.cpu.setStub(STUB_DELTA, () => { EVENTS.push(["delta", 0]); return DELTA; });
    rt.cpu.setStub(STUB_SOUND, (c) => { EVENTS.push(["sound", c.reg(4) >>> 0]); });
    rt.cpu.setStub(STUB_SCREEN, (c) => { EVENTS.push(["screen", c.reg(4) >>> 0]); });
    rt.cpu.setStub(0x80086018, () => { EVENTS.push(["fade", 0]); return FADE_OBJ; });
    rt.cpu.setStub(0x80086834, (c) => {
        EVENTS.push(["dispatch", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return DISPATCH_RET;
    });
    rt.cpu.setStub(SET_STATE1, (c) => {
        EVENTS.push(["setState1", c.reg(5) >>> 0]);
        const o = c.reg(4) >>> 0;
        rt.mem.write32(o + 0x10, c.reg(5) >>> 0);
        rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
    });
    rt.cpu.setStub(ADVANCE1, (c) => {
        EVENTS.push(["advance1", 0]);
        const o = c.reg(4) >>> 0;
        rt.mem.write32(o + 0x10, (rt.mem.read32(o + 0x10) + 1) | 0);
        rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
    });
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    CHOICE = o.choice ?? 0;
    DELTA = o.delta ?? 3;
    DISPATCH_RET = o.dispatch ?? 0;
    for (let i = 0x00; i <= 0x78; i += 4) rt.mem.write32(SELF + i, 0);
    rt.mem.write32(SELF + 0x2c, SET_STATE1);
    rt.mem.write32(SELF + 0x3c, ADVANCE1);
    rt.mem.write32(SELF + 0x10, o.state1 ?? 0);
    rt.mem.write32(SELF + 0x54, o.acc ?? 0);
    rt.mem.write32(SELF + 0x58, o.outcome ?? 0);
    for (let i = 0; i < 7; i++) rt.mem.write32(CHILD + i * 4, CHILDOBJ(i));
    rt.mem.write32(CHILDOBJ(1) + 0x70, STUB_SLIDE);
    rt.mem.write32(CHILDOBJ(2) + 0x70, STUB_SLIDE);
    rt.mem.write32(CHILDOBJ(3) + 0x70, STUB_SLIDE);
    rt.mem.write32(CHILDOBJ(4) + 0x78, STUB_DECO);
    rt.mem.write32(CHILDOBJ(5) + 0x9c, STUB_PROMPT);
    rt.mem.write32(CHILDOBJ(5) + 0xa4, STUB_CHOICE);
    rt.mem.write32(CHILDOBJ(6) + 0x94, STUB_BG);
    rt.mem.write32(CHILDOBJ(0) + 0x58, STUB_FADE);
    rt.mem.write32(FADE_OBJ + 0x58, STUB_FADE);
    rt.mem.write32(0x8004df9c, STUB_DELTA);
    rt.mem.write32(0x80055c48, STUB_SOUND);
    rt.mem.write32(0x80044f44, STUB_SCREEN);
}

function snapshot() {
    const selfFields = [];
    for (let off = 0x10; off <= 0x58; off += 4) selfFields.push(rt.mem.read32(SELF + off) >>> 0);
    return {
        events: EVENTS.map((e) => [e[0], (e[1] ?? 0) >>> 0, (e[2] ?? 0) >>> 0]),
        ret: rt.__ret | 0,
        selfFields,
        child0: rt.mem.read32(CHILD) >>> 0,
    };
}

function portHost() {
    return {
        frameDelta() { EVENTS.push(["delta", 0]); return DELTA; },
        setState1(o, s) {
            EVENTS.push(["setState1", s >>> 0]);
            rt.mem.write32(o + 0x10, s >>> 0);
            rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        advance1(o) {
            EVENTS.push(["advance1", 0]);
            rt.mem.write32(o + 0x10, (rt.mem.read32(o + 0x10) + 1) | 0);
            rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        callSlot(obj, slot) {
            EVENTS.push(["call", slot, obj >>> 0]);
            return slot === 0xa4 ? CHOICE : 0;
        },
        playSound(id) { EVENTS.push(["sound", id >>> 0]); },
        requestScreen(id) { EVENTS.push(["screen", id >>> 0]); },
        createScreenFade() { EVENTS.push(["fade", 0]); return FADE_OBJ; },
        titleChoiceDispatch(self, child) {
            EVENTS.push(["dispatch", self >>> 0, child >>> 0]);
            return DISPATCH_RET;
        },
    };
}

function pass(usePort, o, ticks) {
    seed(o);
    const out = [];
    for (let t = 0; t < ticks; t++) {
        EVENTS = [];
        if (usePort) {
            rt.__ret = titleSequenceTick(rt.mem, SELF, CHILD, portHost());
        } else {
            rt.__ret = rt.cpu.call(0x800869d0, [SELF, CHILD]);
        }
        out.push(snapshot());
    }
    return out;
}

function run(label, o, ticks = 1) {
    const oracle = pass(false, o, ticks);
    const port = pass(true, o, ticks);
    for (let t = 0; t < ticks; t++) {
        assert.deepEqual(port[t].events, oracle[t].events, `${label} tick ${t}: calls`);
        assert.equal(port[t].ret, oracle[t].ret, `${label} tick ${t}: return`);
        assert.deepEqual(port[t].selfFields, oracle[t].selfFields, `${label} tick ${t}: fields`);
        assert.equal(port[t].child0, oracle[t].child0, `${label} tick ${t}: child0`);
    }
}

test("titleSequenceTick matches F0x800869d0", () => {
    run("case0", { state1: 0 });
    run("case0 state9", { state1: 9 });
    run("case0 negative", { state1: -1 });
    run("case1 fires", { state1: 1, acc: 5 });
    run("case1 negative acc", { state1: 1, acc: -1 });
    run("case2 below gate", { state1: 2, acc: 9, delta: 3 });
    run("case2 at gate", { state1: 2, acc: 10, delta: 3 });
    run("case3 below gate", { state1: 3, acc: 11, delta: 3 });
    run("case3 at gate", { state1: 3, acc: 12, delta: 3 });
    run("case4 at gate", { state1: 4, acc: 12, delta: 3 });
    run("case5 at gate", { state1: 5, acc: 12, delta: 3 });
    run("case6 idle", { state1: 6, choice: 0 });
    run("case6 idle overwrites stale outcome", { state1: 6, choice: 0, outcome: 5 });
    run("case6 start", { state1: 6, choice: 1 });
    run("case6 continue", { state1: 6, choice: 2 });
    run("case7", { state1: 7 });
    run("case8 zero", { state1: 8, dispatch: 0 });
    run("case8 value", { state1: 8, dispatch: 7 });
    run("full walk", { state1: 0, delta: 100, choice: 1, dispatch: 4 }, 12);
});
