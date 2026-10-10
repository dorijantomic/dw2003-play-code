// Lane B Phase 4 oracle: engine/dw3/ui/native/cnty-decor.ts must touch exactly
// the same object fields, return the same easing value and make the same ordered
// boundary calls as the original pro/cnty_sel overlay bodies.
//
// The original functions run through engine/native (the interpreter) as the
// oracle, on the shipped overlay image:
//   F0x800835CC / F0x80083830 / F0x80083A94  the three strip easings
//   F0x800836DC / F0x80083940 / F0x80083BC0  the three per-state handlers
//
// The draws (F0x80083630 / F0x80083894 / F0x80083B00) and the +0x28 / +0x2C /
// +0x38 base methods are host boundaries; the oracle stubs them and compares the
// ordered calls against the port's host callbacks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    DECOR_FIELD_54,
    DECOR_FIELD_56,
    DECOR_GATE,
    DECOR_INDEX,
    DECOR_METHOD_28,
    DECOR_METHOD_2C,
    DECOR_METHOD_38,
    DECOR_PROGRESS,
    DECOR_STATE,
    decorBottomBreatheTick,
    decorBottomProgress,
    decorLeftBreatheTick,
    decorLeftProgress,
    decorRightBreatheTick,
    decorRightProgress,
} from "../../engine/dw3/ui/native/cnty-decor.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const cnty = new Uint8Array(readFileSync(join(dir, "pro_cnty_sel.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: cnty.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// Scratch RAM above the images; A is driven by the interpreter, B by the port.
const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;

// Stub addresses installed into the object's +0x28 / +0x2C / +0x38 method slots.
const M28 = 0x0fd60028;
const M2C = 0x0fd6002c;
const M38 = 0x0fd60038;

const DRAW_LEFT = 0x80083630;
const DRAW_RIGHT = 0x80083894;
const DRAW_BOTTOM = 0x80083b00;

function runtime() {
    // pro/cnty_sel loads at its real resident slot base 0x80082cb0; the resident
    // EXE image sits underneath so the overlay's global calls have real addresses.
    return new NativeStageRuntime(cnty, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

// The interpreter draws object A and the port draws object B, so the recorded
// callbacks normalise the object pointer to 0 to make the two sequences equal.
function installStubs(rt, log) {
    rt.cpu.setStub(M28, (c) => {
        log.push(["m28", (c.reg(4) >>> 0) - OBJ_A, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.setStub(M2C, (c) => {
        log.push(["m2c", (c.reg(4) >>> 0) - OBJ_A, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.setStub(M38, (c) => {
        log.push(["m38", (c.reg(4) >>> 0) - OBJ_A]);
        return 0;
    });
    rt.cpu.setStub(DRAW_LEFT, (c) => {
        log.push(["draw:left", (c.reg(4) >>> 0) - OBJ_A]);
        return 0;
    });
    rt.cpu.setStub(DRAW_RIGHT, (c) => {
        log.push(["draw:right", (c.reg(4) >>> 0) - OBJ_A]);
        return 0;
    });
    rt.cpu.setStub(DRAW_BOTTOM, (c) => {
        log.push(["draw:bottom", (c.reg(4) >>> 0) - OBJ_A]);
        return 0;
    });
}

function makePortHost(tag, log) {
    return {
        baseMethod28: (o, v) => log.push(["m28", (o >>> 0) - OBJ_B, v | 0]),
        baseMethod2C: (o, v) => log.push(["m2c", (o >>> 0) - OBJ_B, v | 0]),
        baseMethod38: (o) => log.push(["m38", (o >>> 0) - OBJ_B]),
        draw: (o) => log.push([`draw:${tag}`, (o >>> 0) - OBJ_B]),
    };
}

function initObj(mem, obj, state, gate, index, progress, f54, f56) {
    mem.write32(obj + DECOR_STATE, state);
    mem.write32(obj + DECOR_GATE, gate);
    mem.write16(obj + DECOR_INDEX, index);
    mem.write16(obj + DECOR_PROGRESS, progress);
    mem.write16(obj + DECOR_FIELD_54, f54);
    mem.write16(obj + DECOR_FIELD_56, f56);
    mem.write32(obj + DECOR_METHOD_28, M28);
    mem.write32(obj + DECOR_METHOD_2C, M2C);
    mem.write32(obj + DECOR_METHOD_38, M38);
}

function fields(rt, obj) {
    return [
        rt.mem.read32(obj + DECOR_STATE) | 0,
        rt.mem.read32(obj + DECOR_GATE) | 0,
        rt.mem.read16(obj + DECOR_INDEX),
        rt.mem.read16(obj + DECOR_PROGRESS),
        rt.mem.read16(obj + DECOR_FIELD_54),
        rt.mem.read16(obj + DECOR_FIELD_56),
    ];
}

test("decor easings match the interpreter (F0x800835CC / F0x80083830 / F0x80083A94)", () => {
    const rt = runtime();
    const cases = [
        [0x800835cc, decorLeftProgress],
        [0x80083830, decorRightProgress],
        [0x80083a94, decorBottomProgress],
    ];
    for (const [addr, port] of cases) {
        for (const index of [0, 1]) {
            for (const progress of [0, 1, 4, 5, 9, 10, 11, 12, 20, 0x7fff]) {
                rt.mem.write16(OBJ_A + DECOR_PROGRESS, progress);
                rt.mem.write16(OBJ_B + DECOR_PROGRESS, progress);
                const oracle = rt.cpu.call(addr, [OBJ_A, index]) | 0;
                const got = port(rt.mem, OBJ_B, index) | 0;
                assert.equal(got, oracle, `F${addr.toString(16)} index ${index} progress ${progress}`);
            }
        }
    }
});

test("decor handler branches match the interpreter for every state", () => {
    const rt = runtime();
    const oracleLog = [];
    const portLog = [];
    installStubs(rt, oracleLog);

    const strips = [
        { addr: 0x800836dc, port: decorLeftBreatheTick, tag: "left" },
        { addr: 0x80083940, port: decorRightBreatheTick, tag: "right" },
        { addr: 0x80083bc0, port: decorBottomBreatheTick, tag: "bottom" },
    ];

    for (const strip of strips) {
        for (const state of [-1, 0, 2, 3, 4, 7]) {
            for (const progress of [0, 3, 10, 12]) {
                initObj(rt.mem, OBJ_A, state, 1, 0, progress, 0x1111, 0x2222);
                initObj(rt.mem, OBJ_B, state, 1, 0, progress, 0x1111, 0x2222);
                oracleLog.length = 0;
                portLog.length = 0;
                rt.cpu.call(strip.addr, [OBJ_A]);
                strip.port(rt.mem, OBJ_B, makePortHost(strip.tag, portLog));
                assert.deepEqual(fields(rt, OBJ_A), fields(rt, OBJ_B),
                    `${strip.tag} state ${state} progress ${progress} fields`);
                assert.deepEqual(portLog, oracleLog,
                    `${strip.tag} state ${state} progress ${progress} calls`);
            }
        }
    }
});

test("decor animate branch matches the interpreter across a full breath", () => {
    const rt = runtime();
    const oracleLog = [];
    const portLog = [];
    installStubs(rt, oracleLog);

    const strips = [
        { addr: 0x800836dc, port: decorLeftBreatheTick, tag: "left" },
        { addr: 0x80083940, port: decorRightBreatheTick, tag: "right" },
        { addr: 0x80083bc0, port: decorBottomBreatheTick, tag: "bottom" },
    ];

    for (const strip of strips) {
        // gate == 1 == state so the easing path runs; walk far enough to toggle
        // the keyframe index twice (10 + 5 ticks per cycle).
        for (const gate of [0, 1, 2]) {
            initObj(rt.mem, OBJ_A, 1, gate, 0, 0, 0x1000, 0x1000);
            initObj(rt.mem, OBJ_B, 1, gate, 0, 0, 0x1000, 0x1000);
            let toggles = 0;
            for (let tick = 0; tick < 60; tick++) {
                oracleLog.length = 0;
                portLog.length = 0;
                rt.cpu.call(strip.addr, [OBJ_A]);
                strip.port(rt.mem, OBJ_B, makePortHost(strip.tag, portLog));
                assert.deepEqual(fields(rt, OBJ_A), fields(rt, OBJ_B),
                    `${strip.tag} gate ${gate} tick ${tick} fields`);
                assert.deepEqual(portLog, oracleLog,
                    `${strip.tag} gate ${gate} tick ${tick} calls`);
                if (oracleLog.some((e) => e[0] === "m2c" && e[2] === 0)) toggles++;
            }
            // Only the gated animate path runs the keyframe toggle; the ungated
            // and wrong-gate paths must never reach it.
            if (gate === 1) {
                assert.ok(toggles >= 2, `${strip.tag} reached the keyframe toggle (${toggles})`);
            } else {
                assert.equal(toggles, 0, `${strip.tag} gate ${gate} never toggles`);
            }
            // A full breath visited both keyframe entries and moved the size.
            assert.ok(rt.mem.read16(OBJ_A + DECOR_INDEX) === rt.mem.read16(OBJ_B + DECOR_INDEX),
                `${strip.tag} gate ${gate} index in step`);
        }
    }
});

test("the shipped keyframe tables match the port's decoded view", () => {
    // Two entries each: 10 ticks up to 0x1000, 5 ticks back to 0. Re-read them
    // from the overlay the interpreter loaded, not from the port.
    const rt = runtime();
    const tables = [
        [0x800843ec, 8],
        [0x800843fc, 8],
        [0x8008440c, 12],
    ];
    for (const [base, stride] of tables) {
        assert.equal(rt.mem.read32(base) | 0, 10, `F${base.toString(16)} entry0 duration`);
        assert.equal(rt.mem.read16(base + 4), 0x1000, `F${base.toString(16)} entry0 end`);
        assert.equal(rt.mem.read16(base + 6), 0, `F${base.toString(16)} entry0 start`);
        const second = base + stride;
        assert.equal(rt.mem.read32(second) | 0, 5, `F${second.toString(16)} entry1 duration`);
        assert.equal(rt.mem.read16(second + 4), 0, `F${second.toString(16)} entry1 end`);
        assert.equal(rt.mem.read16(second + 6), 0x1000, `F${second.toString(16)} entry1 start`);
    }
});
