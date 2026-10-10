// Phase-4 oracle: engine/dw3/ui/duel-effect-step.ts must reproduce pro/cardgame's
// F0x800A2180 (fetchNextEffectOpcode), the between-phase stepper.
//
// The original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin with every far edge stubbed (six `jal` targets plus the four
// method pointers reached by `jalr`); the port runs against a host whose methods
// log the same ordered events and return the same values. Every dispatch state
// (0..0x13), four return-value climates and three seeds are compared on the
// return value, the ordered call log and the whole touched duel/view window.
//
// A discriminating mutation (state 1 latches the wrong pending opcode) makes the
// oracle fail — proving the comparison actually discriminates, not just passes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    FETCH_NEXT_EFFECT_OPCODE,
    SAVE_RESTORE_EFFECT_STEP,
    fetchNextEffectOpcode,
    saveRestoreEffectStepBlock,
} from "../engine/dw3/ui/duel-effect-step.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const VIEW = 0x80190000;
const PORT = 0x8004b7d0; // the shared input-port service struct
const STUB = 0x80198000;

const SLOT_EE4 = VIEW + 0xee4;
const SLOT_EE8 = VIEW + 0xee8;
const SLOT_PORT_3F4 = PORT + 0x3f4;
const SLOT_PORT_408 = PORT + 0x408;

// [port method name, original address, arity]
const CALLS = [
    ["resolvingCardProbe", 0x800a09fc, 1],
    ["waitViewWindowOpen", 0x800a1db8, 2],
    ["presentResolvingCard", 0x800a1e60, 2],
    ["cardPredicate", 0x80083e34, 3],
    ["applyResolvingStatChange", 0x800954f8, 3],
    ["repaintHudStrips", 0x8009edcc, 2],
];
// [port method name, pointer slot, arity, has-5th-stack-arg]
const INDIRECT = [
    ["viewOpenPrompt", SLOT_EE4, 5, true],
    ["viewRedrawField", SLOT_EE8, 1, false],
    ["inputPortReset", SLOT_PORT_3F4, 1, false],
    ["inputPortWord", SLOT_PORT_408, 2, false],
];

const CLIMATES = [
    { name: "zero", value: () => 0 },
    { name: "one", value: () => 1 },
    { name: "minus-one", value: () => -1 },
    { name: "varied", value: (addr) => (((addr * 2654435761) >>> 24) % 5) - 1 },
];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function stubOriginal(rt, events, rets) {
    for (const [name, addr, arity] of CALLS) {
        rt.cpu.setStub(addr, (c) => {
            const args = [c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0];
            events.push([name, ...args.slice(0, arity)]);
            return (rets.get(addr) | 0);
        });
    }
    let n = 0;
    for (const [name, slot, arity, stack] of INDIRECT) {
        const target = STUB + (n++) * 0x40;
        rt.mem.write32(slot, target);
        rt.cpu.setStub(target, (c) => {
            const args = [c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0];
            if (stack) args.push(rt.mem.read32((c.reg(29) >>> 0) + 0x10) >>> 0);
            events.push([name, ...args.slice(0, arity)]);
            return (rets.get(slot) | 0);
        });
    }
}

function portHost(mem, events, rets) {
    const port = {};
    for (const [name, addr, arity] of CALLS) {
        port[name] = (...args) => {
            events.push([name, ...args.slice(0, arity).map((a) => a >>> 0)]);
            return (rets.get(addr) | 0);
        };
    }
    for (const [name, slot, arity] of INDIRECT) {
        port[name] = (...args) => {
            events.push([name, ...args.slice(0, arity).map((a) => a >>> 0)]);
            return (rets.get(slot) | 0);
        };
    }
    return port;
}

const SEEDS = [
    { playCount: 1, word580: [0x14, 0x22, 0x0d, 0x09], side: [1, 0], view64: 0, viewDfa: 0, pc: 0x10, flag: 0x9a },
    { playCount: 3, word580: [0x1e, 0x0d, 0x30, 0x11], side: [0, 1], view64: 2, viewDfa: 3, pc: 0x120, flag: 0 },
    { playCount: 2, word580: [0x28, 0x4b, 0x0d, 0x0d], side: [1, 1], view64: 0, viewDfa: 0, pc: 0, flag: 0x5a },
];

function seed(rt, s) {
    for (let i = 0; i < 0x700; i++) rt.mem.write8(DUEL + i, 0);
    for (let i = 0; i < 0x1200; i++) rt.mem.write8(VIEW + i, 0);
    rt.mem.write8(DUEL + 0x575, s.playCount);
    for (let i = 0; i < 4; i++) {
        rt.mem.write16(DUEL + 0x580 + i * 8, s.word580[i]);
        rt.mem.write8(DUEL + 0x584 + i * 8, s.side[i]);
    }
    rt.mem.write8(DUEL + 0x4dd, s.flag);
    rt.mem.write16(DUEL + 0x4e0, s.pc);
    rt.mem.write16(VIEW + 0x64, s.view64);
    rt.mem.write8(VIEW + 0xdfa, s.viewDfa);
    for (let i = 0; i < 0x40; i++) rt.mem.write16(DUEL + 0x50 + i * 2, i & 0x1f);
    for (let side = 0; side < 2; side++) {
        rt.mem.write16(DUEL + side * 0xc8 + 0x5a2, side + 1);
        for (let i = 0; i < 8; i++) rt.mem.write16(DUEL + side * 0xc8 + 0x614 + i * 2, 0x70 + i);
    }
    rt.mem.write32(SCENE + 0x18, VIEW);
    rt.mem.write8(DUEL + 0x4dc - 1, 0x5b);
    rt.mem.write8(DUEL + 0x4dc + 1, 0x5c);
    rt.mem.write8(VIEW + 0xdfa + 1, 0x5d);
}

function duelWindow(rt) {
    const out = [];
    for (let i = 0x2f0; i < 0x720; i++) out.push(rt.mem.read8(DUEL + i));
    return out;
}
function viewWindow(rt) {
    const out = [];
    for (let i = 0; i < 0x500; i++) out.push(rt.mem.read8(VIEW + i));
    return out;
}

function compare(s, state, climate) {
    const rets = new Map();
    for (const [, addr] of CALLS) rets.set(addr, climate.value(addr));
    for (const [, slot] of INDIRECT) rets.set(slot, climate.value(slot));

    const evA = [];
    const a = runtime();
    seed(a, s);
    stubOriginal(a, evA, rets);
    a.mem.write8(DUEL + 0x4dc, state);
    const av = a.cpu.call(FETCH_NEXT_EFFECT_OPCODE, [DUEL, SCENE]) | 0;

    const evB = [];
    const b = runtime();
    seed(b, s);
    b.mem.write8(DUEL + 0x4dc, state);
    const bv = fetchNextEffectOpcode(b.mem, portHost(b.mem, evB, rets), DUEL, SCENE) | 0;

    const where = `state 0x${state.toString(16)} ${climate.name} seed ${s.playCount}`;
    assert.deepEqual(evB, evA, `calls differ: ${where}`);
    assert.equal(bv | 0, av | 0, `return differs: ${where}`);
    assert.deepEqual(duelWindow(b), duelWindow(a), `duel bytes differ: ${where}`);
    assert.deepEqual(viewWindow(b), viewWindow(a), `view bytes differ: ${where}`);
}

test("fetchNextEffectOpcode matches F0x800A2180 for every dispatch state", () => {
    const states = [];
    for (let st = 0; st <= 0x13; st++) states.push(st);
    for (const climate of CLIMATES) {
        for (const s of SEEDS) {
            for (const st of states) compare(s, st, climate);
        }
    }
});

// A discriminating mutation: state 1 latches the wrong pending opcode (0x4D
// instead of 0x4C). It writes the same arm byte and state byte, so only the
// pending-opcode check catches it — here on the original's own input, so the
// oracle is seen to fail when the port is wrong.
test("a mutated port makes the oracle fail", () => {
    const mutated = (mem, _host, duel, _scene) => {
        mem.write8(duel + 0x421, 0x4d); // wrong: the original latches 0x4C
        mem.write8(duel + 0x2f4, 1);
        mem.write8(duel + 0x4dc, 2);
        return 0;
    };
    const s = SEEDS[0];
    const rets = new Map();
    for (const [, addr] of CALLS) rets.set(addr, 0);
    for (const [, slot] of INDIRECT) rets.set(slot, 0);
    const a = runtime();
    seed(a, s);
    stubOriginal(a, [], rets);
    a.mem.write8(DUEL + 0x4dc, 0x01);
    a.cpu.call(FETCH_NEXT_EFFECT_OPCODE, [DUEL, SCENE]);
    const b = runtime();
    seed(b, s);
    b.mem.write8(DUEL + 0x4dc, 0x01);
    mutated(b.mem, null, DUEL, SCENE);
    assert.equal(a.mem.read8(DUEL + 0x421), 0x4c, "the original latches 0x4C");
    assert.notEqual(b.mem.read8(DUEL + 0x421), a.mem.read8(DUEL + 0x421), "mutation detected");
});

// ── F0x800A2608 saveRestoreEffectStepBlock ───────────────────────────────────

const SOUND = 0x80055c48;          // the sound service pointer at *0x80055C48
const PORT_3F4 = PORT + 0x3f4;
const PORT_3FC = PORT + 0x3fc;
const PORT_408 = PORT + 0x408;
const SLOT_EEC = VIEW + 0xeec;
const SLOT_EF4 = VIEW + 0xef4;
const SLOT_EF8 = VIEW + 0xef8;
const SLOT_EFC = VIEW + 0xefc;
const SLOT_F00 = VIEW + 0xf00;
const SAVE_BANK = 0x800a5dc8;
const STUB2 = 0x801a0000;

// [port method name, pointer slot, arity, has-5th-stack-arg]
const N_CALLS = [
    ["inputPortReset", PORT_3F4, 1, false],
    ["inputPortState", PORT_3FC, 1, false],
    ["inputPortWord", PORT_408, 2, false],
    ["playSound", SOUND, 1, false],
    ["viewOpenPrompt", SLOT_EE4, 5, true],
    ["viewOpEec", SLOT_EEC, 1, false],
    ["viewOpEf4", SLOT_EF4, 2, false],
    ["viewOpEf8", SLOT_EF8, 1, false],
    ["viewOpEfc", SLOT_EFC, 1, false],
    ["viewOpF00", SLOT_F00, 2, false],
];

function stubNested(rt, events, rets) {
    let n = 0;
    for (const [name, slot, arity, stack] of N_CALLS) {
        const target = STUB2 + (n++) * 0x40;
        rt.mem.write32(slot, target);
        rt.cpu.setStub(target, (c) => {
            const args = [c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0];
            if (stack) args.push(rt.mem.read32((c.reg(29) >>> 0) + 0x10) >>> 0);
            events.push([name, ...args.slice(0, arity)]);
            return (rets.get(slot) | 0);
        });
    }
}

function portNestedHost(mem, events, rets) {
    const port = {};
    for (const [name, slot, arity] of N_CALLS) {
        port[name] = (...args) => {
            events.push([name, ...args.slice(0, arity).map((a) => a >>> 0)]);
            return (rets.get(slot) | 0);
        };
    }
    return port;
}

function seedNested(rt, s) {
    for (let i = 0x400; i < 0x700; i++) rt.mem.write8(DUEL + i, 0);
    for (let i = 0; i < 0x1200; i++) rt.mem.write8(VIEW + i, 0);
    for (let i = 0; i < 0x40; i++) rt.mem.write8(SAVE_BANK + i, 0);
    for (let i = 0x420; i < 0x498; i++) rt.mem.write8(DUEL + i, (i * 7 + 1) & 0xff);   // save source
    for (let i = 0x4f0; i < 0x568; i++) rt.mem.write8(DUEL + i, (i * 5 + 3) & 0xff);   // restore source
    for (let i = 0; i < 6 * 4; i++) rt.mem.write8(VIEW + 0xde4 + i, (i * 3 + 9) & 0xff); // view save source
    for (let i = 0; i < 0x40; i++) rt.mem.write8(SAVE_BANK + i, (i * 11 + 5) & 0xff);    // bank source
    rt.mem.write8(DUEL + 0x568, s.state);
    rt.mem.write8(DUEL + 0x569, s.row);
    rt.mem.write8(DUEL + 0x421, 0x7e);
    rt.mem.write8(DUEL + 0x2f4, 0x7d);
    rt.mem.write16(VIEW + 0xdf4, s.viewRow);
    rt.mem.write8(VIEW + 0xdfa, s.viewMenu);
    rt.mem.write16(VIEW + 0xe0a, s.viewReady);
    rt.mem.write32(SCENE + 0x18, VIEW);
    rt.mem.write8(DUEL + 0x567, 0x5a);
    rt.mem.write8(DUEL + 0x568 + 1, 0x5b);
}

function nestedWindow(rt) {
    const out = [];
    for (let i = 0x400; i < 0x700; i++) out.push(rt.mem.read8(DUEL + i));
    // stop short of the view's method-pointer slots at +0xEE4.., which only the
    // original's stubs write (the routine never touches them)
    for (let i = 0; i < 0xee4; i++) out.push(rt.mem.read8(VIEW + i));
    for (let i = 0; i < 0x40; i++) out.push(rt.mem.read8(SAVE_BANK + i));
    return out;
}

const N_SEEDS = [
    { state: 0, row: 0, viewRow: 0, viewMenu: 0, viewReady: 0 },
    { state: 2, row: 2, viewRow: 1, viewMenu: 2, viewReady: 2 },
    { state: 3, row: 3, viewRow: 3, viewMenu: 0, viewReady: 0 },
    { state: 4, row: 2, viewRow: 0, viewMenu: 0, viewReady: 0 },
    { state: 9, row: 1, viewRow: 1, viewMenu: 2, viewReady: 0 },
    { state: 10, row: 0, viewRow: 0, viewMenu: 0, viewReady: 0 },
    { state: 15, row: 4, viewRow: 2, viewMenu: 0, viewReady: 0 },
    { state: 0x11, row: 0, viewRow: 0, viewMenu: 0, viewReady: 0 },
];

function compareNested(s, climate) {
    const rets = new Map();
    for (const [, slot] of N_CALLS) rets.set(slot, climate.value(slot));

    const evA = [];
    const a = runtime();
    seedNested(a, s);
    stubNested(a, evA, rets);
    const av = a.cpu.call(SAVE_RESTORE_EFFECT_STEP, [DUEL, SCENE]) | 0;

    const evB = [];
    const b = runtime();
    seedNested(b, s);
    const bv = saveRestoreEffectStepBlock(b.mem, portNestedHost(b.mem, evB, rets), DUEL, SCENE) | 0;

    const where = `nested state 0x${s.state.toString(16)} row ${s.row} ${climate.name}`;
    assert.deepEqual(evB, evA, `calls differ: ${where}`);
    assert.equal(bv | 0, av | 0, `return differs: ${where}`);
    assert.deepEqual(nestedWindow(b), nestedWindow(a), `bytes differ: ${where}`);
}

test("saveRestoreEffectStepBlock matches F0x800A2608 for every state", () => {
    const states = [];
    for (let st = 0; st <= 0x11; st++) states.push(st);
    for (const climate of CLIMATES) {
        for (const st of states) {
            for (const row of [0, 2, 4]) {
                compareNested({ state: st, row, viewRow: 1, viewMenu: 2, viewReady: st % 3 }, climate);
            }
        }
    }
    for (const climate of CLIMATES) for (const s of N_SEEDS) compareNested(s, climate);
});

// A discriminating mutation: state 0's save writes the wrong block length would
// clobber the restore source; here the mutation skips the state-2 -> 3 advance,
// which only the state byte comparison catches.
test("a mutated nested port makes the oracle fail", () => {
    const mutated = (mem, _host, duel, _scene) => {
        const st = mem.read8(duel + 0x568) & 0xff;
        if (st === 2) return 0; // wrong: the original advances to state 3 when ready
        return 0;
    };
    const rets = new Map();
    for (const [, slot] of N_CALLS) rets.set(slot, 0);
    const s = { state: 2, row: 2, viewRow: 1, viewMenu: 2, viewReady: 2 };
    const a = runtime();
    seedNested(a, s);
    stubNested(a, [], rets);
    a.cpu.call(SAVE_RESTORE_EFFECT_STEP, [DUEL, SCENE]);
    const b = runtime();
    seedNested(b, s);
    mutated(b.mem, null, DUEL, SCENE);
    assert.equal(a.mem.read8(DUEL + 0x568), 0x03, "the original advances state 2 -> 3");
    assert.notEqual(b.mem.read8(DUEL + 0x568), a.mem.read8(DUEL + 0x568), "mutation detected");
});
