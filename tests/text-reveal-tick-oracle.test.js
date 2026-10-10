// Phase 4 oracle: engine/dw3/ui/text-window.ts textRevealTick (F0x8001AC14) must
// reproduce the original on the same widget. The drawer F0x800197A4 is stubbed
// on BOTH sides (it is the next unit and needs the display service); the pad
// service methods are stubbed too, so the tick's own state machine is what is
// compared. engine/native runs the original address as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { LOGICAL_BUTTON_TABLE, PAD_SERVICE_BLOCK, textRevealTick } from "../engine/dw3/ui/text-window.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF_A = 0x80180000;
const SELF_B = 0x80180200;
const BUF0_A = 0x80181000;
const BUF0_B = 0x80181200;
const WIN = 0x120;

function runtime(log) {
    const host = {
        setFlag() {}, getFlag: () => 0, rand16: () => 0x777,
        playPackedSound(id) { log.sounds.push(id | 0); },
    };
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(0x800197a4, () => { log.draws += 1; return 0; });
    rt.cpu.setStub(0x80018854, () => log.padWord | 0);
    rt.cpu.setStub(0x80018980, () => log.padBit | 0);
    rt.mem.write32(PAD_SERVICE_BLOCK + 0x3f4, 0x80018854);
    rt.mem.write32(PAD_SERVICE_BLOCK + 0x408, 0x80018980);
    return rt;
}

function seed(rt, self, buf) {
    for (let i = 0; i < WIN; i += 4) rt.mem.write32(self + i, 0);
    rt.mem.write32(self + 0x5c, buf);
    for (let i = 0; i < 0x40; i++) rt.mem.write8(buf + i, 0);
    rt.mem.write8(buf + 0x20, 0x41);
}

function setState(rt, self, state, c1, delay, acc, a4, sound, c3, sub, sel) {
    rt.mem.write32(self + 0xc, state);
    rt.mem.write8(self + 0xc1, c1);
    rt.mem.write8(self + 0xc3, c3);
    rt.mem.write16(self + 0xaa, delay);
    rt.mem.write16(self + 0xa8, acc);
    rt.mem.write16(self + 0xa4, a4);
    rt.mem.write32(self + 0xc8, sound);
    rt.mem.write32(self + 0x10, sub);
    rt.mem.write32(self + 0x14, sel);
    rt.mem.write32(self + 0x18, 0x20);
    // the widget's own methods, as the constructor installs them
    rt.mem.write32(self + 0x28, 0x80014274); // setState
    rt.mem.write32(self + 0x38, 0x800142ac); // advanceState
}

function fields(rt, self) {
    return {
        state: rt.mem.read32(self + 0xc) | 0,
        state2: rt.mem.read32(self + 0x10) | 0,
        selected: rt.mem.read32(self + 0x14) | 0,
        cursor: rt.mem.read32(self + 0x18) | 0,
        a8: rt.mem.read16(self + 0xa8) & 0xffff,
        a4: rt.mem.read16(self + 0xa4) & 0xffff,
        c1: rt.mem.read8(self + 0xc1),
        c3: rt.mem.read8(self + 0xc3),
        lineByte: rt.mem.read8((rt.mem.read32(self + 0x5c) >>> 0) + 0x20),
    };
}

function caseBoth(label, seedSelf, setup, ticks = 1) {
    const logA = { draws: 0, sounds: [], padWord: setup.padWord ?? 0, padBit: setup.padBit ?? 0 };
    const logB = { draws: 0, sounds: [], padWord: setup.padWord ?? 0, padBit: setup.padBit ?? 0 };
    const rt = runtime(logA);
    rt.host = null;
    const rtB = runtime(logB);
    seed(rt, SELF_A, BUF0_A);
    seed(rtB, SELF_B, BUF0_B);
    setup.seed(rt, SELF_A);
    setup.seed(rtB, SELF_B);
    for (let i = 0; i < ticks; i++) rt.cpu.call(0x8001ac14, [SELF_A]);
    const portHost = {
        draw: () => { logB.draws += 1; },
        playPackedSound: (id) => logB.sounds.push(id | 0),
        padButtonWord: () => rtB.cpu.call(0x80018854, [0]) | 0,
        logicalButtonBit: (id) => rtB.cpu.call(0x80018980, [0, id]) | 0,
        free: (p) => { (logB.freed ??= []).push(p >>> 0); },
    };
    const freedA = [];
    void freedA;
    for (let i = 0; i < ticks; i++) textRevealTick(rtB.mem, portHost, SELF_B);
    assert.deepEqual(fields(rtB, SELF_B), fields(rt, SELF_A), `${label} fields`);
    assert.equal(logB.draws, logA.draws, `${label} draws`);
    assert.deepEqual(logB.sounds, logA.sounds, `${label} sounds`);
    return { rt: rtB, log: logB };
}

test("textRevealTick matches F0x8001AC14 on the default arm", () => {
    for (const state of [0, 4, 5, -1]) {
        caseBoth(`default state=${state}`, null, {
            seed: (rt, self) => setState(rt, self, state, 1, 0, 0, 0, 0, 0, 0, 0),
        });
    }
});

test("textRevealTick matches F0x8001AC14 on state 1", () => {
    caseBoth("c1 gate", null, { seed: (rt, s) => setState(rt, s, 1, 0, 2, 0, 0, 0, 0, 0, 0) });
    caseBoth("delay 0", null, { seed: (rt, s) => setState(rt, s, 1, 1, 0, 0, 0, 0, 0, 0, 0) });
    caseBoth("pause byte", null, { seed: (rt, s) => setState(rt, s, 1, 1, 2, 0, 0, 0, 1, 0, 0) });
    // accumulation across the delay, with and without the packed sound
    caseBoth("accumulate no sound", null, { seed: (rt, s) => setState(rt, s, 1, 1, 2, 0, 0, 0, 0, 0, 0) }, 6);
    caseBoth("accumulate sound", null, { seed: (rt, s) => setState(rt, s, 1, 1, 1, 0, 0, 0x1234, 0, 0, 0) }, 6);
    caseBoth("mid accumulation", null, { seed: (rt, s) => setState(rt, s, 1, 1, 3, 1, 5, 0x99, 0, 0, 0) }, 4);
});

test("textRevealTick matches F0x8001AC14 on state 2", () => {
    caseBoth("timed", null, { seed: (rt, s) => setState(rt, s, 2, 1, 0, 0, 0, 0, 0, 0, 2) }, 5);
    caseBoth("timed long", null, { seed: (rt, s) => setState(rt, s, 2, 1, 0, 0, 0, 0, 0, 0, 3) }, 6);
    // stop exactly at the transition tick: frames=2 must not fire at acc=2
    caseBoth("timed boundary", null, { seed: (rt, s) => setState(rt, s, 2, 1, 0, 0, 0, 0, 0, 0, 2) }, 2);
    caseBoth("timed boundary+1", null, { seed: (rt, s) => setState(rt, s, 2, 1, 0, 0, 0, 0, 0, 0, 2) }, 3);
    // pad arm: the stub returns word 0b100 and bit 2 -> pressed
    caseBoth("pad pressed", null, {
        padWord: 0b100, padBit: 2,
        seed: (rt, s) => setState(rt, s, 2, 1, 7, 0, 0, 0, 0, 1, 0),
    });
    caseBoth("pad not pressed", null, {
        padWord: 0b0, padBit: 2,
        seed: (rt, s) => setState(rt, s, 2, 1, 7, 0, 0, 0, 0, 1, 0),
    });
    caseBoth("pad other bit", null, {
        padWord: 0b1000, padBit: 2,
        seed: (rt, s) => setState(rt, s, 2, 1, 7, 0, 0, 0, 0, 1, 0),
    });
});

test("textRevealTick matches F0x8001AC14 on state 3 (the buffer release)", () => {
    const freed = [];
    const tick = (rt, self, record) => {
        const log = { draws: 0, sounds: [] };
        return textRevealTick(rt.mem, {
            draw: () => { log.draws += 1; },
            playPackedSound: (id) => log.sounds.push(id),
            padButtonWord: () => 0,
            logicalButtonBit: () => 0,
            free: (p) => record.push(p >>> 0),
        }, self);
    };
    // the original frees through the heap's +0x10 slot; stub that cell so the
    // oracle run cannot wander into the real heap
    const logA = { draws: 0, sounds: [], padWord: 0, padBit: 0 };
    const rtA = runtime(logA);
    const freedA = [];
    const freeStub = 0x80017b70;
    rtA.cpu.setStub(freeStub, (c) => { freedA.push(c.reg(4) >>> 0); return 0; });
    rtA.mem.write32(0x8004b5dc + 0x10, freeStub);
    const logB = { draws: 0, sounds: [], padWord: 0, padBit: 0 };
    const rtB = runtime(logB);
    for (const [rt, self, buf] of [[rtA, SELF_A, BUF0_A], [rtB, SELF_B, BUF0_B]]) {
        seed(rt, self, buf);
        setState(rt, self, 3, 1, 0, 0, 0, 0, 0, 0, 0);
        for (let i = 1; i < 6; i += 2) rt.mem.write32(self + 0x5c + i * 0xc, 0x80190000 + i * 0x100);
    }
    rtA.cpu.call(0x8001ac14, [SELF_A]);
    tick(rtB, SELF_B, freed);
    // The two runs use different line-0 buffers by design; the shared records
    // are identical, so compare each side against its own expectation.
    assert.deepEqual(freedA, [BUF0_A, 0x80190100, 0x80190300, 0x80190500], "oracle freed pointers");
    assert.deepEqual(freed, [BUF0_B, 0x80190100, 0x80190300, 0x80190500], "port freed pointers");
    assert.equal(freed.length, 4, "four non-null records freed (line 0 + 1/3/5)");
    assert.deepEqual(fields(rtB, SELF_B), fields(rtA, SELF_A), "state 3 fields");
});
