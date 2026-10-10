// Phase 4 oracle: engine/dw3/ui/effects-card-helpers.ts must reproduce the
// originals F0x80088DB8, F0x80088E8C, F0x80088F4C and F0x800890B0. The originals
// run through engine/native with the widget method slots stubbed; the port runs
// through the same recorders. Stat bytes and the record fields are compared too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    effectsCardArrow,
    effectsCardNumber,
    effectsStatAdd,
    effectsTrailingRows,
    STAT_DISPLAY_TABLE,
} from "../engine/dw3/ui/effects-card-helpers.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const BUF = 0x80188000;
const BAND = 0x80180000;
const STATE = 0x80181000;
const WIDGETS = 0x80182000;
const WIDGET = 0x80183000;
const ARITY = { setNumber: 3, measure: 2, setC0: 2, flag: 2 };

let EVENTS = [];

function widgetAddr(addr) {
    return (addr) >>> 0;
}

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x800195b0, (c) => { EVENTS.push(["setNumber", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(0x8001a25c, (c) => { EVENTS.push(["measure", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x8001a1f4, (c) => { EVENTS.push(["setC0", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x8001a23c, (c) => { EVENTS.push(["flag", c.reg(4), c.reg(5)]); return 0; });
    return rt;
}

const rt = runtime();

function armWidget(addr) {
    rt.mem.write32(addr + 0x118, 0x800195b0);
    rt.mem.write32(addr + 0x148, 0x8001a25c);
    rt.mem.write32(addr + 0x138, 0x8001a1f4);
    rt.mem.write32(addr + 0x144, 0x8001a23c);
}

function norm(evs) {
    return evs.map(([name, ...args]) => [name, ...args.slice(0, ARITY[name]).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        widgetSetLineNumber(widget, line, value) { EVENTS.push(["setNumber", widget, line, value]); },
        widgetMeasure(widget, value) { EVENTS.push(["measure", widget, value]); },
        widgetSetC0(widget, code) { EVENTS.push(["setC0", widget, code]); },
        widgetSetFlagC1(widget, value) { EVENTS.push(["flag", widget, value]); },
    };
}

test("effectsStatAdd matches F0x80088DB8", () => {
    const seedBuf = () => {
        for (let i = 0; i < 0x2c; i += 2) rt.mem.write16(BUF + i, (0x100 + i) & 0xffff);
        rt.mem.write16(BUF + 0x0c, 999);
        rt.mem.write16(BUF + 0x18, 0xffff);
    };
    const cases = [
        [7, 5], [1, 3], [2, 300], [6, 1], [8, 2], [14, 7], [0, 9], [1, 5000], [7, -0x1100],
    ];
    for (const [code, amount] of cases) {
        seedBuf();
        rt.cpu.call(0x80088db8, [BUF, code, amount]);
        const oracle = [];
        for (let i = 0; i < 0x2c; i += 2) oracle.push(rt.mem.read16(BUF + i));
        seedBuf();
        effectsStatAdd(rt.mem, BUF, code, amount);
        const port = [];
        for (let i = 0; i < 0x2c; i += 2) port.push(rt.mem.read16(BUF + i));
        assert.deepEqual(port, oracle, `code ${code} amount ${amount}`);
    }
});

function seedRecord() {
    // before/after halves for table offsets 6..18; other halves zero.
    for (let i = 0; i < 0x58; i += 2) rt.mem.write16(BAND + 0x64 + i, 0);
    for (let idx = 0; idx < 13; idx++) {
        const off = rt.mem.read32(STAT_DISPLAY_TABLE + idx * 4);
        rt.mem.write16(BAND + 0x64 + off * 2, 10 + idx);
        rt.mem.write16(BAND + 0x64 + 0x2c + off * 2, 100 + idx);
    }
}

function seedState(key, after, skipA = -1, skipB = -1, member = 0) {
    rt.mem.write32(STATE + 0x00, member);
    rt.mem.write32(STATE + 0x04, key);
    rt.mem.write32(STATE + 0x08, after);
    rt.mem.write32(STATE + 0x0c, skipA >>> 0);
    rt.mem.write32(STATE + 0x10, skipB);
}

test("effectsCardNumber matches F0x80088E8C", () => {
    armWidget(WIDGET);
    for (const [key, after] of [[0, 0], [5, 0], [0, 1], [12, 1]]) {
        seedRecord();
        seedState(key, after);
        EVENTS = [];
        rt.cpu.call(0x80088e8c, [BAND, WIDGET, STATE]);
        const oracle = norm(EVENTS.slice());
        EVENTS = [];
        effectsCardNumber(rt.mem, BAND, WIDGET, STATE, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracle, `key ${key} after ${after}`);
    }
});

test("effectsCardArrow matches F0x80088F4C", () => {
    armWidget(WIDGET);
    const cases = [
        { key: 0, after: 0, field: 0, arrowValue: 5 },
        { key: 0, after: 0, field: 0, arrowValue: 0 },
        { key: 2, after: 0, field: 0, arrowValue: 5 },
        { key: 0, after: 1, field: 0, arrowValue: 0, beforeAt: 1, afterAt: 200 },
        { key: 0, after: 1, field: 0, arrowValue: 0, beforeAt: 200, afterAt: 1 },
        { key: 0, after: 1, field: 0, arrowValue: 5 },
        { key: 0, after: 1, field: 0, arrowValue: 0 },
        { key: 4, after: 0, field: 2, arrowValue: 0 },
    ];
    for (const c of cases) {
        seedRecord();
        const off = rt.mem.read32(STAT_DISPLAY_TABLE + c.key * 4);
        rt.mem.write16(BAND + 0x64 + 0x26 + 2 * (c.key === 0 ? 0 : c.key === 1 ? 1 : c.key === 4 ? 2 : 0), c.arrowValue);
        if (c.beforeAt !== undefined) rt.mem.write16(BAND + 0x64 + off * 2, c.beforeAt);
        if (c.afterAt !== undefined) rt.mem.write16(BAND + 0x64 + 0x2c + off * 2, c.afterAt);
        seedState(c.key, c.after);
        EVENTS = [];
        rt.cpu.call(0x80088f4c, [BAND, WIDGET, STATE]);
        const oracle = norm(EVENTS.slice());
        EVENTS = [];
        effectsCardArrow(rt.mem, BAND, WIDGET, STATE, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracle, JSON.stringify(c));
    }
});

test("effectsTrailingRows matches F0x800890B0", () => {
    for (let k = 0; k < 4; k++) {
        const w = WIDGET + 0x200 * (k + 1);
        armWidget(w);
        rt.mem.write32(WIDGETS + k * 4, w);
    }
    // The widget array has four rows: exercise only the domain where at most
    // four display indices differ, which is what the item's stat effects can do.
    const cases = [
        { equalMask: ~0x000f & 0x1fff, skipA: -1, skipB: -1 }, // four rows differ
        { equalMask: ~0x0003 & 0x1fff, skipA: -1, skipB: -1 }, // two rows, hide loop
        { equalMask: ~0x000f & 0x1fff, skipA: 1, skipB: 2 },   // skip two of the four
        { equalMask: ~0x000f & 0x1fff, skipA: 0, skipB: -1 },  // skip one
        { equalMask: 0x1fff, skipA: -1, skipB: -1 },           // no rows differ
    ];
    for (const c of cases) {
        seedRecord();
        // Make the after half equal to before for indices whose bit is set.
        for (let idx = 0; idx < 13; idx++) {
            if (c.equalMask & (1 << idx)) {
                const off = rt.mem.read32(STAT_DISPLAY_TABLE + idx * 4);
                rt.mem.write16(BAND + 0x64 + 0x2c + off * 2, rt.mem.read16(BAND + 0x64 + off * 2));
            }
        }
        seedState(0, 1, c.skipA, c.skipB);
        rt.mem.write32(BAND + 0x64 + 0x5c, 0);
        EVENTS = [];
        rt.cpu.call(0x800890b0, [BAND, WIDGETS, STATE]);
        const oracle = norm(EVENTS.slice());
        const oracleRecord = [rt.mem.read32(BAND + 0x64 + 0x5c) >>> 0];
        for (let r = 0; r < 4; r++) oracleRecord.push(rt.mem.read32(BAND + 0x64 + 0x68 + 4 * r) >>> 0);

        seedRecord();
        for (let idx = 0; idx < 13; idx++) {
            if (c.equalMask & (1 << idx)) {
                const off = rt.mem.read32(STAT_DISPLAY_TABLE + idx * 4);
                rt.mem.write16(BAND + 0x64 + 0x2c + off * 2, rt.mem.read16(BAND + 0x64 + off * 2));
            }
        }
        seedState(0, 1, c.skipA, c.skipB);
        rt.mem.write32(BAND + 0x64 + 0x5c, 0);
        EVENTS = [];
        effectsTrailingRows(rt.mem, BAND, WIDGETS, STATE, portHost());
        const port = norm(EVENTS.slice());
        const portRecord = [rt.mem.read32(BAND + 0x64 + 0x5c) >>> 0];
        for (let r = 0; r < 4; r++) portRecord.push(rt.mem.read32(BAND + 0x64 + 0x68 + 4 * r) >>> 0);

        assert.deepEqual(port, oracle, `${JSON.stringify(c)}: calls`);
        assert.deepEqual(portRecord, oracleRecord, `${JSON.stringify(c)}: record`);
    }
});
