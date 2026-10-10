// Phase 4 oracle: engine/dw3/psx-env.ts setDrawTPage (F0x8002915C) and
// setIntrMask (F0x8002EB98) must match the interpreter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    buildDrawEnvPacket,
    setDrawEnvPacket,
    DISPLAY_MODE_WORD,
    DRAW_AREA_HEIGHT,
    DRAW_AREA_WIDTH,
    I_MASK_PTR_ADDR,
    displayModeWord,
    drawAreaEndCommand,
    drawAreaStartCommand,
    drawOffsetCommand,
    drawTexPageCommand,
    setDefDispEnv,
    setDefDrawEnv,
    setDrawTPage,
    setIntrMask,
    texWindowCommand,
} from "../engine/dw3/psx-env.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const ENV_A = 0x80150000;
const ENV_B = 0x80150100;
const MASK_TARGET = 0x80150200;
const WIN = 0x20;

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

// `call()` only loads a0-a3, so a routine with a fifth argument reads it from
// the caller's stack. Point sp at scratch and place the argument at sp+0x10
// (the callee's frame is 0x28 bytes, so its `sp+0x38` is our `sp+0x10`).
const STACK = 0x80159000;
function callWithFive(rt, address, a0, a1, a2, a3, a4) {
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(STACK + i, 0);
    rt.mem.write32(STACK + 0x10, a4 | 0);
    rt.cpu.sp = STACK;
    return rt.cpu.call(address, [a0, a1, a2, a3]);
}

function bytes(rt, base) {
    const out = [];
    for (let i = 0; i < WIN; i++) out.push(rt.mem.read8(base + i));
    return out;
}

test("DRAWENV packet assemblers match original bytes and ordered writes", () => {
    const native = runtime(), port = runtime();
    const packet = ENV_A + 0x1c;
    const snapshot = rt => Array.from({ length: 0x80 }, (_, i) => rt.mem.read8(ENV_A + i));
    let cases = 0;
    for (const [address, fn] of [[0x800266b4, setDrawEnvPacket], [0x800268ac, buildDrawEnvPacket]]) {
        for (const [x, y, w, h] of [[64, 90, 128, 64], [65, 90, 128, 64], [64, 90, 129, 64],
            [0, 0, 0, 0], [-1, -2, -3, -4], [0x7fff, 0x7fff, 2, 2], [0xffc0, 7, 64, 0x8000]]) {
            for (const [width, height] of [[1024, 512], [128, 32], [0, 0], [0x8000, 0xffff]]) {
                for (const clear of [0, 1, 255]) {
                    for (const rt of [native, port]) {
                        rt.mem.onWrite = null;
                        for (let i = 0; i < 0x80; i++) rt.mem.write8(ENV_A + i, (i * 37 + 0x5a) & 255);
                        for (const [off, value] of [[0, x], [2, y], [4, w], [6, h], [8, 200], [10, -200]]) rt.mem.write16(ENV_A + off, value);
                        rt.mem.write8(ENV_A + 24, clear);
                        rt.mem.write16(DRAW_AREA_WIDTH, width);
                        rt.mem.write16(DRAW_AREA_HEIGHT, height);
                    }
                    const logs = [[], []];
                    [native, port].forEach((rt, i) => {
                        rt.mem.onWrite = (_pc, addr, size, value) => {
                            if (addr >= ENV_A && addr < ENV_A + 0x80) logs[i].push([addr, size, value]);
                        };
                    });
                    const expected = native.cpu.call(address, [packet, ENV_A]) >>> 0;
                    const actual = fn(port.mem, packet, ENV_A);
                    const label = JSON.stringify({address, x, y, w, h, width, height, clear});
                    assert.equal(actual, expected, label);
                    assert.deepEqual(snapshot(port), snapshot(native), label);
                    assert.deepEqual(logs[1], logs[0], label);
                    cases++;
                }
            }
        }
    }
    assert.equal(cases, 168);
});

test("setDrawTPage matches the interpreter (F0x8002915C)", () => {
    const rt = runtime();
    const cases = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0x1ff],
        [0, 0, 0x9ff], [1, 1, 0xa00], [-1, -1, -1]];
    for (const [abr, texPage, code] of cases) {
        for (let i = 0; i < WIN; i++) {
            rt.mem.write8(ENV_A + i, 0xaa);
            rt.mem.write8(ENV_B + i, 0xaa);
        }
        rt.cpu.call(0x8002915c, [ENV_A, abr, texPage, code]);
        setDrawTPage(rt.mem, ENV_B, abr, texPage, code);
        assert.deepEqual(bytes(rt, ENV_B), bytes(rt, ENV_A), `abr=${abr} texPage=${texPage} code=${code}`);
    }
});

test("setIntrMask matches the interpreter (F0x8002EB98)", () => {
    const rt = runtime();
    // The resident cell should hold the hardware register address; point it at a
    // scratch u16 so the oracle is self-contained.
    assert.equal(rt.mem.read32(I_MASK_PTR_ADDR) >>> 0, 0x1f801074);
    rt.mem.write32(I_MASK_PTR_ADDR, MASK_TARGET);
    for (const [before, value] of [[0, 0x1234], [0xffff, 0], [0x8000, 0x00ff], [0x00ff, 0xffff]]) {
        rt.mem.write16(MASK_TARGET, before);
        const oracle = rt.cpu.call(0x8002eb98, [value]) & 0xffff;
        const afterOracle = rt.mem.read16(MASK_TARGET) & 0xffff;
        rt.mem.write16(MASK_TARGET, before);
        const port = setIntrMask(rt.mem, value);
        assert.equal(port, oracle, `return value=${value} before=${before}`);
        assert.equal(rt.mem.read16(MASK_TARGET) & 0xffff, afterOracle, `stored value=${value}`);
        assert.equal(oracle, before, `returned the previous mask (before=${before})`);
    }
});

test("setDefDispEnv matches the interpreter (F0x8002906C)", () => {
    const rt = runtime();
    const cases = [
        [0, 0, 0, 0, 0],
        [0x140, 0x100, 0x140, 0x100, 0x1c0],
        [0x1ff, 0x1ff, 0x1ff, 0x1ff, 0x1ff],
        [-1, -2, -3, -4, -5],
    ];
    for (const [x, y, w, h] of cases) {
        for (let i = 0; i < WIN; i++) {
            rt.mem.write8(ENV_A + i, 0xaa);
            rt.mem.write8(ENV_B + i, 0xaa);
        }
        const ret = callWithFive(rt, 0x8002906c, ENV_A, x, y, w, h) >>> 0;
        const port = setDefDispEnv(rt.mem, ENV_B, x, y, w, h);
        assert.deepEqual(bytes(rt, ENV_B), bytes(rt, ENV_A), `x=${x} y=${y} w=${w} h=${h}`);
        assert.equal(port >>> 0, ENV_B, `the port returns its env pointer x=${x}`);
        assert.equal(ret, ENV_A, "the original returns its env pointer");
    }
});

test("setDefDrawEnv matches the interpreter (F0x80028FAC)", () => {
    const rt = runtime();
    const cases = [];
    for (const mode of [0, 1]) {
        for (const h of [0x100, 0x101, 0x120, 0x121, 0x1c0]) {
            cases.push([mode, 0x140, 0x100, 0x140, h]);
        }
    }
    for (const [mode, x, y, w, h] of cases) {
        for (let i = 0; i < WIN; i++) {
            rt.mem.write8(ENV_A + i, 0xaa);
            rt.mem.write8(ENV_B + i, 0xaa);
        }
        rt.mem.write32(DISPLAY_MODE_WORD, mode);
        const ret = callWithFive(rt, 0x80028fac, ENV_A, x, y, w, h) >>> 0;
        const port = setDefDrawEnv(rt.mem, ENV_B, x, y, w, h);
        assert.deepEqual(bytes(rt, ENV_B), bytes(rt, ENV_A), `mode=${mode} h=0x${h.toString(16)}`);
        assert.equal(port >>> 0, ENV_B, `the port returns its env pointer mode=${mode}`);
        assert.equal(ret, ENV_A, "the original returns its env pointer");
    }
});

test("displayModeWord matches the interpreter (F0x8002F580)", () => {
    const rt = runtime();
    for (const value of [0, 1, 0x12345678, 0xffffffff]) {
        rt.mem.write32(DISPLAY_MODE_WORD, value);
        const oracle = rt.cpu.call(0x8002f580, []) >>> 0;
        assert.equal(displayModeWord(rt.mem), oracle, `value=0x${value.toString(16)}`);
        assert.equal(oracle, value >>> 0, "the leaf returns the word it reads");
    }
});

test("drawTexPageCommand matches F0x80026b1c", () => {
    const rt = runtime();
    const cases = [
        [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0x1ff],
        [0, 0, 0x9ff], [1, 1, 0xa00], [1, 0, 0x400], [-1, -1, -1],
    ];
    for (const [dither, texPage, code] of cases) {
        const oracle = rt.cpu.call(0x80026b1c, [dither, texPage, code]) >>> 0;
        assert.equal(drawTexPageCommand(dither, texPage, code), oracle,
            `dither=${dither} texPage=${texPage} code=0x${(code >>> 0).toString(16)}`);
    }
});

test("drawAreaStart/End commands match F0x80026b3c / F0x80026bd4", () => {
    const rt = runtime();
    const limits = [[0x140, 0xf0], [1, 1], [0, 0], [0x200, 0x200], [0x8000, 0x8000]];
    const coords = [[0, 0], [1, 1], [0x13f, 0xef], [0x140, 0xf0], [0x3ff, 0x3ff],
        [-1, 0], [0, -1], [-1, -1], [0x10000, 5], [5, 0x10000]];
    for (const [w, h] of limits) {
        rt.mem.write16(DRAW_AREA_WIDTH, w);
        rt.mem.write16(DRAW_AREA_HEIGHT, h);
        for (const [x, y] of coords) {
            const start = rt.cpu.call(0x80026b3c, [x, y]) >>> 0;
            const end = rt.cpu.call(0x80026bd4, [x, y]) >>> 0;
            assert.equal(drawAreaStartCommand(rt.mem, x, y), start, `E3 w=${w} h=${h} x=${x} y=${y}`);
            assert.equal(drawAreaEndCommand(rt.mem, x, y), end, `E4 w=${w} h=${h} x=${x} y=${y}`);
        }
    }
});

test("drawOffsetCommand matches F0x80026c6c", () => {
    const rt = runtime();
    for (const [x, y] of [[0, 0], [1, 2], [0x7ff, 0x7ff], [0x800, 0x800], [-1, -1], [0x12345, -0x20]]) {
        const oracle = rt.cpu.call(0x80026c6c, [x, y]) >>> 0;
        assert.equal(drawOffsetCommand(x, y), oracle, `x=${x} y=${y}`);
    }
});

test("texWindowCommand matches F0x80026c88", () => {
    const rt = runtime();
    assert.equal(rt.cpu.call(0x80026c88, [0]) >>> 0, 0, "NULL returns 0");
    assert.equal(texWindowCommand(rt.mem, 0), 0);
    const rect = 0x80151000;
    const cases = [
        [0, 0, 0, 0], [8, 16, 8, 8], [0xff, 0xff, 1, 1],
        [0, 0, -8, -8], [0x18, 0x20, 0x40, 0x20],
    ];
    for (const [u, v, w, h] of cases) {
        rt.mem.write8(rect, u);
        rt.mem.write8(rect + 1, 0xaa);
        rt.mem.write8(rect + 2, v);
        rt.mem.write8(rect + 3, 0xbb);
        rt.mem.write16(rect + 4, w);
        rt.mem.write16(rect + 6, h);
        const oracle = rt.cpu.call(0x80026c88, [rect]) >>> 0;
        assert.equal(texWindowCommand(rt.mem, rect), oracle, `u=${u} v=${v} w=${w} h=${h}`);
    }
});
