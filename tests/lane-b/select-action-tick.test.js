// Lane B Phase 4 oracle: engine/dw3/ui/native/select-action-tick.ts must match
// the original pro/stgdglab picker state machine F0x80088B5C.
//
// The original runs through engine/native on the shipped pro_stgdglab.bin +
// resident.bin. Every fold, pad, sound, roster, factory and widget-method
// boundary is stubbed on both sides, so the ordered call log and the object /
// arg1 fields can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { selectActionTick } from "../../engine/dw3/ui/native/select-action-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const name = new Uint8Array(readFileSync(join(dir, "pro_stgdglab.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: name.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARG1 = 0x80151000;
const PARENT = 0x80152000;
const WIDGET_BASE = 0x80160000;
const HIDE_BASE = 0x80180000;
const TICK_FN = 0x80088b5c;

const FOLD_START_CELL = 0x8008fd98;
const FOLD_STATUS_CELL = 0x8008fd9c;
const PAD_READ_CELL = 0x8004bbc4;
const PAD_HELD_CELL = 0x8004bbcc;
const PAD_SHIFT_CELL = 0x8004bbd8;
const SOUND_CELL = 0x80055c48;
const PARTY_SLOT_CELL = 0x8004b44c;
const RECORD_HELPER_CELL = 0x80044f4c;
const SLOT_GLOBAL = 0x8005cca8;
const SPECIES_HELPER = 0x8008eabc;
const WIDGET_FACTORY = 0x8001ae38;
const WIDGET_FACTORY2 = 0x8001b364;
const BUILD_LISTS = 0x80088808;

const STUB = 0x0fe30000;
const FOLD_START_STUB = STUB + 0x10;
const FOLD_STATUS_STUB = STUB + 0x14;
const PAD_READ_STUB = STUB + 0x18;
const PAD_HELD_STUB = STUB + 0x1c;
const PAD_SHIFT_STUB = STUB + 0x20;
const SOUND_STUB = STUB + 0x24;
const PARTY_SLOT_STUB = STUB + 0x28;
const RECORD_HELPER_STUB = STUB + 0x2c;
const SPECIES_STUB = STUB + 0x30;
const FACTORY_STUB = STUB + 0x34;
const FACTORY2_STUB = STUB + 0x38;
const BUILD_LISTS_STUB = STUB + 0x3c;

// Widget / object method slots and their arities.
const METHODS = [
    [0x15c, 1, STUB + 0x100],
    [0x134, 2, STUB + 0x104],
    [0x114, 2, STUB + 0x108],
    [0x080, 1, STUB + 0x10c],
    [0x084, 2, STUB + 0x110],
    [0x144, 1, STUB + 0x114],
    [0x078, 0, STUB + 0x118],
    [0x02c, 1, STUB + 0x11c],
    [0x028, 1, STUB + 0x120],
    [0x03c, 0, STUB + 0x124],
];
const METHOD_ADDR = Object.fromEntries(METHODS.map(([slot, , addr]) => [slot, addr]));
const METHOD_ARITY = Object.fromEntries(METHODS.map(([slot, arity]) => [slot, arity]));

const LOG = [];
let made = 0;

const CONTROL = {
    fold: {},
    padRead: 0,
    padHeld: 0,
    partySlot: 1,
    species: 0x1234,
    record: 0x0abc0000,
};

function makeWidget() {
    const w = WIDGET_BASE + made * 0x200;
    made += 1;
    return w;
}

function installHooks(rt) {
    rt.cpu.setStub(FOLD_START_STUB, (c) => {
        LOG.push(["foldStart", c.reg(4) | 0, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.setStub(FOLD_STATUS_STUB, (c) => {
        const target = c.reg(4) | 0;
        LOG.push(["foldStatus", target]);
        return CONTROL.fold[target >>> 0] ?? 0;
    });
    rt.cpu.setStub(PAD_READ_STUB, (c) => { LOG.push(["padRead", c.reg(4) | 0]); return CONTROL.padRead; });
    rt.cpu.setStub(PAD_HELD_STUB, (c) => { LOG.push(["padHeld", c.reg(4) | 0]); return CONTROL.padHeld; });
    rt.cpu.setStub(PAD_SHIFT_STUB, (c) => {
        LOG.push(["padShift", c.reg(4) | 0, c.reg(5) | 0]);
        return c.reg(5) | 0; // identity map for the oracle
    });
    rt.cpu.setStub(SOUND_STUB, (c) => { LOG.push(["sound", c.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(PARTY_SLOT_STUB, (c) => { LOG.push(["partySlot", c.reg(4) | 0]); return CONTROL.partySlot; });
    rt.cpu.setStub(RECORD_HELPER_STUB, (c) => { LOG.push(["recordHelper", c.reg(4) >>> 0]); return CONTROL.record; });
    rt.cpu.setStub(SPECIES_STUB, (c) => {
        LOG.push(["speciesHelper", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        return CONTROL.species;
    });
    const buildLists = (c) => { LOG.push(["buildLists", c.reg(4) | 0, c.reg(5) | 0]); return 0; };
    rt.cpu.setStub(BUILD_LISTS, buildLists);

    const factory = (tag) => (c) => {
        LOG.push([tag, c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const w = makeWidget();
        for (const [slot, , addr] of METHODS) rt.mem.write32(w + slot, addr);
        return w;
    };
    rt.cpu.setStub(WIDGET_FACTORY, factory("factory"));
    rt.cpu.setStub(WIDGET_FACTORY2, factory("factory2"));

    for (const [slot, arity, addr] of METHODS) {
        rt.cpu.setStub(addr, (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }

    rt.mem.write32(FOLD_START_CELL, FOLD_START_STUB);
    rt.mem.write32(FOLD_STATUS_CELL, FOLD_STATUS_STUB);
    rt.mem.write32(PAD_READ_CELL, PAD_READ_STUB);
    rt.mem.write32(PAD_HELD_CELL, PAD_HELD_STUB);
    rt.mem.write32(PAD_SHIFT_CELL, PAD_SHIFT_STUB);
    rt.mem.write32(SOUND_CELL, SOUND_STUB);
    rt.mem.write32(PARTY_SLOT_CELL, PARTY_SLOT_STUB);
    rt.mem.write32(RECORD_HELPER_CELL, RECORD_HELPER_STUB);
    rt.cpu.setStub(SPECIES_HELPER, (c) => {
        LOG.push(["speciesHelper", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        return CONTROL.species;
    });
}

function runtime() {
    const rt = new NativeStageRuntime(name, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    installHooks(rt);
    return rt;
}

function portHost() {
    return {
        foldStart(target, value) { LOG.push(["foldStart", target | 0, value | 0]); },
        foldStatus(target) { LOG.push(["foldStatus", target | 0]); return CONTROL.fold[target >>> 0] ?? 0; },
        padRead(port) { LOG.push(["padRead", port | 0]); return CONTROL.padRead; },
        padHeld(port) { LOG.push(["padHeld", port | 0]); return CONTROL.padHeld; },
        padShift(port, button) { LOG.push(["padShift", port | 0, button | 0]); return button | 0; },
        playSound(id) { LOG.push(["sound", id >>> 0]); },
        partySlot(position) { LOG.push(["partySlot", position | 0]); return CONTROL.partySlot; },
        speciesHelper(slot, a, b) { LOG.push(["speciesHelper", slot | 0, a | 0, b | 0]); return CONTROL.species; },
        widgetFactory(scale, kind, x, y) { LOG.push(["factory", scale | 0, kind | 0, x | 0, y | 0]); return makeWidget(); },
        widgetFactory2(scale, kind, x, y) { LOG.push(["factory2", scale | 0, kind | 0, x | 0, y | 0]); return makeWidget(); },
        recordHelper(arg) { LOG.push(["recordHelper", arg >>> 0]); return CONTROL.record; },
        buildLists(o, a) { LOG.push(["buildLists", o | 0, a | 0]); },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

function clear(rt, addr, size) {
    for (let i = 0; i < size; i++) rt.mem.write8(addr + i, 0);
}

function seed(rt, c) {
    clear(rt, OBJ, 0x140);
    clear(rt, ARG1, 0x80);
    clear(rt, PARENT, 0x80);
    clear(rt, WIDGET_BASE, 0x1000);
    clear(rt, HIDE_BASE, 0x40);
    made = 0;

    rt.mem.write32(SLOT_GLOBAL, c.slotGlobal ?? 0x80190000);
    rt.mem.write32(OBJ + 0x10, c.state ?? 0);
    rt.mem.write32(OBJ + 0x14, c.unk14 ?? 0);
    rt.mem.write32(OBJ + 0x20, c.unk20 ?? 0);
    rt.mem.write32(OBJ + 0x24, c.hideArray ? HIDE_BASE : 0);
    rt.mem.write32(OBJ + 0x50, PARENT);
    rt.mem.write32(OBJ + 0x54, c.unk54 ?? 0);
    rt.mem.write32(OBJ + 0x58, c.unk58 ?? 0x40);
    rt.mem.write32(OBJ + 0x5c, c.unk5c ?? 3);
    rt.mem.write32(OBJ + 0x60, c.unk60 ?? 0);
    rt.mem.write32(OBJ + 0x94, c.unk94 ?? 0);
    rt.mem.write32(OBJ + 0x9c, c.unk9c ?? 0);
    rt.mem.write32(OBJ + 0x110, c.unk110 ?? 0);
    for (const [slot, , addr] of METHODS) if (slot === 0x2c || slot === 0x28 || slot === 0x3c) rt.mem.write32(OBJ + slot, addr);

    rt.mem.write32(PARENT + 0x5c, c.parentCount ?? 3);
    rt.mem.write32(PARENT + 0x60, c.parentStanding ?? 2);
    rt.mem.write32(PARENT + 0x64, c.parentSelected ?? 0);
    rt.mem.write32(PARENT + 0x78, METHOD_ADDR[0x78]);

    const a = c.arg1 ?? {};
    rt.mem.write32(ARG1 + 0x00, a.a ?? 0);
    rt.mem.write32(ARG1 + 0x04, a.b ?? 0);
    rt.mem.write32(ARG1 + 0x08, a.c ?? 0);
    rt.mem.write32(ARG1 + 0x10, a.d ?? 0);
    rt.mem.write32(ARG1 + 0x14, a.e ?? 0);
    rt.mem.write32(ARG1 + 0x28, a.f ?? 0);
    rt.mem.write32(ARG1 + 0x3c, a.g ?? 0);
    rt.mem.write32(ARG1 + 0x40, a.h ?? 0);
    rt.mem.write32(ARG1 + 0x44, a.i ?? 0);
    rt.mem.write32(ARG1 + 0x48, a.j ?? 0);

    for (const v of Object.values(a)) {
        if (typeof v === "number" && (v >>> 0) !== 0) {
            for (const [slot, , addr] of METHODS) rt.mem.write32((v >>> 0) + slot, addr);
        }
    }

    if (c.hideArray) {
        for (let i = 0; i < c.hideArray.length; i++) {
            if (c.hideArray[i]) {
                const w = makeWidget();
                for (const [slot, , addr] of METHODS) rt.mem.write32(w + slot, addr);
                rt.mem.write32(HIDE_BASE + i * 4, w);
            }
        }
    }

    CONTROL.fold = c.fold ?? {};
    CONTROL.padRead = c.padRead ?? 0;
    CONTROL.padHeld = c.padHeld ?? 0;
    CONTROL.partySlot = c.partySlot ?? 1;
    CONTROL.species = c.species ?? 0x1234;
    CONTROL.record = c.record ?? 0x0abc0000;
}

function snap(rt) {
    const out = [];
    for (const off of [0x10, 0x14, 0x54, 0x60, 0x94, 0x9c, 0x110]) {
        out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    }
    for (const off of [0x00, 0x04, 0x08, 0x10, 0x14, 0x28, 0x3c, 0x40, 0x44, 0x48]) {
        out.push(`a${off.toString(16)}=${rt.mem.read32(ARG1 + off) >>> 0}`);
    }
    out.push(`sel=${rt.mem.read32(PARENT + 0x64) >>> 0}`);
    return out;
}

function presses(...buttons) {
    let v = 0;
    for (const b of buttons) v |= (1 << b);
    return v;
}

const FOLD_ADDR = (off) => (OBJ + off) >>> 0;

const CASES = [
    { name: "default state 0", state: 0 },
    { name: "default state 9", state: 9, unk58: 0x50, unk5c: 4 },
    {
        name: "state 1 nothing ready", state: 1,
    },
    {
        name: "state 1 first fold ready", state: 1,
        fold: { [FOLD_ADDR(0x64)]: 1 },
    },
    {
        name: "state 1 both folds ready", state: 1,
        fold: { [FOLD_ADDR(0x64)]: 1, [FOLD_ADDR(0x84)]: 1 },
        arg1: { a: 0x80170000 },
    },
    { name: "state 2 not ready", state: 2 },
    {
        name: "state 2 builds rows", state: 2,
        fold: { [FOLD_ADDR(0x74)]: 1 },
        arg1: { b: 0x80170100 },
    },
    {
        name: "state 3 left press", state: 3, unk60: 2, padRead: presses(4),
        arg1: { i: 0x80170200 },
    },
    {
        name: "state 3 left clamp", state: 3, unk60: 0, padRead: presses(4),
        arg1: { i: 0x80170200 },
    },
    {
        name: "state 3 right press", state: 3, unk60: 1, padRead: presses(6),
        arg1: { i: 0x80170200 },
    },
    {
        name: "state 3 right clamp", state: 3, unk60: 2, padRead: presses(6),
        arg1: { i: 0x80170200 },
    },
    { name: "state 3 confirm", state: 3, padRead: presses(0xd) },
    { name: "state 3 cancel", state: 3, padRead: presses(0xe) },
    {
        name: "state 4 hides and clears", state: 4, unk20: 4,
        hideArray: [true, true, false],
        arg1: { i: 0x80170200 },
    },
    { name: "state 5 not all ready", state: 5, fold: { [FOLD_ADDR(0x64)]: 1 } },
    {
        name: "state 5 ready switch", state: 5, unk14: 0, unk60: 0,
        fold: { [FOLD_ADDR(0x64)]: 1, [FOLD_ADDR(0x74)]: 1, [FOLD_ADDR(0x84)]: 1 },
    },
    {
        name: "state 5 ready digivolve", state: 5, unk14: 1,
        fold: { [FOLD_ADDR(0x64)]: 1, [FOLD_ADDR(0x74)]: 1, [FOLD_ADDR(0x84)]: 1 },
    },
    { name: "state 10 open with switch", state: 10, unk60: 0 },
    { name: "state 10 open without switch", state: 10, unk60: 1 },
    {
        name: "state 11 panel ready", state: 11,
        fold: { [FOLD_ADDR(0xA4)]: 1 },
    },
    { name: "state 11 panel not ready", state: 11 },
    {
        name: "state 12 fully ready", state: 12, unk60: 0,
        fold: { [FOLD_ADDR(0xE4)]: 1, [FOLD_ADDR(0xC4)]: 1 },
    },
    {
        name: "state 12 first panel only", state: 12, unk60: 0,
        fold: { [FOLD_ADDR(0xE4)]: 1 },
    },
    { name: "state 14 ready", state: 14, fold: { [FOLD_ADDR(0xD4)]: 1 } },
    { name: "state 14 not ready", state: 14 },
    {
        name: "state 15 scroll down", state: 15, padRead: presses(5),
        arg1: { i: 0x80170300 },
    },
    {
        name: "state 15 scroll down to last", state: 15, unk110: 2, padRead: presses(5),
        arg1: { i: 0x80170300 },
    },
    {
        name: "state 15 scroll up to zero", state: 15, unk110: 3, parentSelected: 1, padRead: presses(7),
        arg1: { i: 0x80170300 },
    },
    {
        name: "state 15 scroll up wrap", state: 15, unk110: 1, padRead: presses(7),
        arg1: { i: 0x80170300 },
    },
    { name: "state 15 confirm", state: 15, padRead: presses(0xd) },
    { name: "state 15 cancel", state: 15, padRead: presses(0xe) },
    { name: "state 15 select valid", state: 15, unk60: 0, padRead: presses(0xc), partySlot: 1 },
    { name: "state 15 select invalid", state: 15, unk60: 0, padRead: presses(0xc), partySlot: -1 },
    { name: "state 16 close panel", state: 16 },
    {
        name: "state 17 close everything", state: 17, unk14: 0,
        fold: { [FOLD_ADDR(0xD4)]: 1 }, unk60: 0,
        arg1: {
            a: 0x80171000, d: 0x80171200, h: 0x80171400,
            e: 0x80171600, f: 0x80171800, g: 0x80171a00,
        },
    },
    { name: "state 17 not ready", state: 17 },
    {
        name: "state 18 kind 0 all six", state: 18, unk14: 0,
        fold: {
            [FOLD_ADDR(0x94)]: 1, [FOLD_ADDR(0xA4)]: 1, [FOLD_ADDR(0xB4)]: 1,
            [FOLD_ADDR(0xC4)]: 1, [FOLD_ADDR(0xD4)]: 1, [FOLD_ADDR(0xE4)]: 1,
        },
    },
    {
        name: "state 18 kind 1 five", state: 18, unk14: 1,
        fold: {
            [FOLD_ADDR(0xA4)]: 1, [FOLD_ADDR(0xB4)]: 1, [FOLD_ADDR(0xC4)]: 1,
            [FOLD_ADDR(0xD4)]: 1, [FOLD_ADDR(0xE4)]: 1,
        },
    },
    {
        name: "state 18 kind 2 five", state: 18, unk14: 2,
        fold: {
            [FOLD_ADDR(0x94)]: 1, [FOLD_ADDR(0xA4)]: 1, [FOLD_ADDR(0xB4)]: 1,
            [FOLD_ADDR(0xC4)]: 1, [FOLD_ADDR(0xD4)]: 1,
        },
    },
    { name: "state 19 open", state: 19, unk54: 0, unk9c: 0 },
    { name: "state 19 hold", state: 19, unk54: 0, unk9c: 1 },
    { name: "state 19 skip", state: 19, unk54: 1 },
    { name: "state 30 build helper", state: 30 },
    { name: "state 30 already built", state: 30, arg1: { j: 0x80170500 } },
    { name: "state 31 not built", state: 31 },
    { name: "state 31 built", state: 31, arg1: { j: 0x80170500 } },
];

test("selectActionTick matches F0x80088B5C", () => {
    const rt = runtime();
    for (const c of CASES) {
        seed(rt, c);
        LOG.length = 0;
        rt.cpu.call(TICK_FN, [OBJ, ARG1], 120000);
        const olog = LOG.slice();
        const osnap = snap(rt);

        seed(rt, c);
        LOG.length = 0;
        selectActionTick(rt.mem, OBJ, ARG1, portHost());

        assert.deepEqual(LOG.slice(), olog, `${c.name}: calls`);
        assert.deepEqual(snap(rt), osnap, `${c.name}: fields`);
    }
});
