// Phase 4 oracle: engine/dw3/ui/text-window.ts must reproduce the original
// rescan F0x80019FB0 and the handler-table entries F0x8001A6E8, F0x8001A73C and
// F0x8001A82C on the same widget, line and scratch. engine/native runs the
// original addresses as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    rescanVisibleWindow,
    textHandlerEntry0,
    textHandlerNoop,
    textHandlerPageScan,
    textHandlerSetLine,
    textHandlerSetText,
    textHandlerWait,
} from "../engine/dw3/ui/text-window.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const W_A = 0x80150000;
const W_B = 0x80150200;
const LINE = 0x80150400;
const TOK_A = 0x80150600;
const TOK_B = 0x80150640;
const BUF = 0x80150800;
const FONT = 0x80151000;
const GLYPH = 0x80152000;
const WIN = 0x180;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(FONT + 4, GLYPH);
    rt.mem.write32(FONT + 8, GLYPH + 0x100);
    rt.mem.write16(FONT + 0x14, 0x20);
    rt.mem.write16(FONT + 0x16, 3);
    rt.mem.write8(FONT + 1, 0xfe); // s8 -2, the wait handler's line delta
    for (let c = 0; c < 0x20; c++) {
        rt.mem.write8(GLYPH + 11 * c + 9, 5);
        rt.mem.write8(GLYPH + 11 * c + 7, 0);
    }
    return rt;
}

function seedWidget(rt, base, bytes, flag, state, bf, bufAddr) {
    for (let i = 0; i < WIN; i++) rt.mem.write8(base + i, 0);
    rt.mem.write32(base + 0xc, state);
    rt.mem.write32(base + 0x50, FONT);
    rt.mem.write32(base + 0x5c, bufAddr);
    rt.mem.write16(base + 0x62, bytes.length);
    rt.mem.write16(base + 0x66, flag);
    rt.mem.write16(base + 0xa4, 0xbeef);
    rt.mem.write16(base + 0xa6, 0);
    rt.mem.write8(base + 0xbf, bf);
    rt.mem.write16(base + 0xb8, 0x1111);
    rt.mem.write16(base + 0xba, 0x2222);
    rt.mem.write16(base + 0xb6, 3);
}

function setBuffer(rt, bytes) {
    for (let i = 0; i < 32; i++) rt.mem.write8(BUF + i, 0);
    for (let i = 0; i < bytes.length; i++) rt.mem.write8(BUF + i, bytes[i]);
}

function bytesOf(rt, base, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rt.mem.read8(base + i));
    return out;
}

test("rescanVisibleWindow matches F0x80019FB0", () => {
    const cases = [
        { bytes: [4, 5, 6, 0], flag: 0, state: 1, bf: 2, name: "basic then end" },
        { bytes: [1, 1, 0], flag: 0, state: 1, bf: 2, name: "ext advances 2" },
        { bytes: [3, 0], flag: 0, state: 1, bf: 2, name: "invalid flag 0" },
        { bytes: [3, 0], flag: 1, state: 1, bf: 2, name: "invalid flag 1" },
        { bytes: [2, 3, 1], flag: 0, state: 1, bf: 2, name: "operand 3 stops" },
        { bytes: [2, 2, 3], flag: 0, state: 1, bf: 2, name: "operand 2 byte<5 stops after 3" },
        { bytes: [2, 2, 7, 0], flag: 0, state: 1, bf: 2, name: "operand 2 byte>=5 continues" },
        { bytes: [2, 5, 1, 0], flag: 0, state: 1, bf: 2, name: "operand 5 substitution" },
        { bytes: [1, 2, 2, 3, 0], flag: 0, state: 1, bf: 2, name: "ext then operand 3" },
        { bytes: [4, 2, 1, 4, 2, 1, 0], flag: 0, state: 1, bf: 2, name: "page breaks" },
        { bytes: [4, 2, 1, 4, 0], flag: 0, state: 1, bf: 5, name: "budget not reached" },
        { bytes: [4, 2, 0, 4, 0], flag: 0, state: 1, bf: 2, name: "operand 0 advance" },
        { bytes: [4, 5, 0], flag: 0, state: 0, bf: 2, name: "state guard" },
        { bytes: [4, 0], flag: 0, state: 2, bf: 2, name: "state 2 guard" },
    ];
    const rt = runtime();
    for (const c of cases) {
        setBuffer(rt, c.bytes);
        seedWidget(rt, W_A, c.bytes, c.flag, c.state, c.bf, BUF);
        seedWidget(rt, W_B, c.bytes, c.flag, c.state, c.bf, BUF);
        // operand-5 substitution: sibling line 1's length at self+0xc+0x62
        rt.mem.write16(W_A + 0xc + 0x62, 7);
        rt.mem.write16(W_B + 0xc + 0x62, 7);
        rt.cpu.call(0x80019fb0, [W_A]);
        rescanVisibleWindow(rt.mem, W_B);
        assert.deepEqual(bytesOf(rt, W_B, WIN), bytesOf(rt, W_A, WIN), `${c.name}`);
    }
});

test("textHandlerEntry0 matches F0x8001A6E8", () => {
    const rt = runtime();
    for (const operand of [0, 7, 2, 3]) {
        for (const flag of [0, 1]) {
            setBuffer(rt, [4, operand, 3, 0]);
            rt.mem.write32(LINE, BUF);
            rt.mem.write16(LINE + 8, 0);
            rt.mem.write16(LINE + 0xa, flag);
            seedWidget(rt, W_A, [4, operand, 3, 0], flag, 1, 2, BUF);
            seedWidget(rt, W_B, [4, operand, 3, 0], flag, 1, 2, BUF);
            const oracle = rt.cpu.call(0x8001a6e8, [W_A, LINE, TOK_A]) | 0;
            const port = textHandlerEntry0(rt.mem, W_B, LINE) | 0;
            assert.equal(port, oracle, `operand=${operand} flag=${flag} return`);
            assert.deepEqual(bytesOf(rt, W_B, WIN), bytesOf(rt, W_A, WIN), `operand=${operand} flag=${flag}`);
        }
    }
});

test("textHandlerSetText matches F0x8001A82C", () => {
    const rt = runtime();
    for (const operand of [0, 1, 2, 3, 4, 5, 0xff]) {
        setBuffer(rt, [4, 6, operand, 7, 0]);
        rt.mem.write32(LINE, BUF);
        rt.mem.write16(LINE + 8, 0);
        rt.mem.write16(LINE + 0xa, 0);
        seedWidget(rt, W_A, [4, 6, operand, 7, 0], 0, 1, 2, BUF);
        seedWidget(rt, W_B, [4, 6, operand, 7, 0], 0, 1, 2, BUF);
        const oracle = rt.cpu.call(0x8001a82c, [W_A, LINE, TOK_A]) | 0;
        const port = textHandlerSetText(rt.mem, W_B, LINE) | 0;
        assert.equal(port, oracle, `operand=${operand} return`);
        assert.deepEqual(bytesOf(rt, W_B, WIN), bytesOf(rt, W_A, WIN), `operand=${operand}`);
    }
});

test("textHandlerWait matches F0x8001A73C", () => {
    const rt = runtime();
    function run(name, counter, bf, tok10, tok18) {
        setBuffer(rt, [4, 2, 1, 5, 0]);
        rt.mem.write32(LINE, BUF);
        rt.mem.write16(LINE + 8, 3);
        rt.mem.write16(LINE + 0xa, 0);
        seedWidget(rt, W_A, [], 0, 1, bf, BUF);
        seedWidget(rt, W_B, [], 0, 1, bf, BUF);
        rt.mem.write32(W_A + 0xa6, 0x33);
        rt.mem.write32(W_B + 0xa6, 0x33);
        rt.mem.write16(TOK_A + 0x18, tok18);
        rt.mem.write16(TOK_B + 0x18, tok18);
        rt.mem.write32(TOK_A + 0x10, tok10);
        rt.mem.write32(TOK_B + 0x10, tok10);
        const oracle = rt.cpu.call(0x8001a73c, [W_A, LINE, TOK_A]) | 0;
        const port = textHandlerWait(rt.mem, W_B, LINE, TOK_B) | 0;
        assert.equal(port, oracle, `${name} return`);
        assert.equal(rt.mem.read16(TOK_B + 0x18), rt.mem.read16(TOK_A + 0x18), `${name} tok18`);
        assert.equal(rt.mem.read32(TOK_B + 0x10) >>> 0, rt.mem.read32(TOK_A + 0x10) >>> 0, `${name} tok10`);
        assert.deepEqual(bytesOf(rt, W_B, WIN), bytesOf(rt, W_A, WIN), `${name} widget (counter=${counter})`);
        assert.equal(counter, 0);
    }
    // first call: counter becomes 1 -> records the line cursor, resets the line
    run("first", 0, 2, 0, 0);
    // counter below the budget -> reset path (0x8004)
    run("below budget", 0, 5, 0x1234, 3);
    // counter at/over the budget -> publish + rescan (0x8000)
    run("budget spent", 0, 2, 0x1234, 3);
    run("budget 1 (no rescan)", 0, 1, 0x1234, 3);
});

function seedLine(rt, bytes, cursor, length, flag) {
    setBuffer(rt, bytes);
    rt.mem.write32(LINE + 0, BUF);
    rt.mem.write16(LINE + 6, length);
    rt.mem.write16(LINE + 8, cursor);
    rt.mem.write16(LINE + 0xa, flag);
}

test("textHandlerPageScan matches F0x8001A8B4", () => {
    const rt = runtime();
    const cases = [
        { bytes: [4, 5, 0], len: 3, cursor: 0, width: 0, flag: 0, name: "basic jumps past end" },
        { bytes: [4, 5, 0], len: 3, cursor: 0, width: 9, flag: 0, name: "measured width arm" },
        { bytes: [2, 5, 9, 0], len: 4, cursor: 0, width: 1, flag: 0, name: "operand 5" },
        { bytes: [2, 8, 9, 0], len: 4, cursor: 0, width: 1, flag: 0, name: "operand 8" },
        { bytes: [2, 0, 0, 0], len: 4, cursor: 0, width: 0, flag: 0, name: "operand 0 then end" },
        { bytes: [2, 2, 9, 0], len: 4, cursor: 0, width: 0, flag: 0, name: "operand 2 halfword then end" },
        { bytes: [3, 0], len: 2, cursor: 0, width: 0, flag: 0, name: "invalid" },
        { bytes: [1, 1, 0], len: 3, cursor: 0, width: 0, flag: 0, name: "ext" },
        { bytes: [0, 0, 0, 0, 9, 0], len: 6, cursor: 5, width: 0, flag: 0, name: "cursor near end" },
        { bytes: [4, 0, 0], len: 3, cursor: 3, width: 0, flag: 0, name: "cursor at length" },
    ];
    for (const c of cases) {
        seedLine(rt, c.bytes, c.cursor, c.len, c.flag);
        seedWidget(rt, W_A, c.bytes, c.flag, 1, 2, BUF);
        seedWidget(rt, W_B, c.bytes, c.flag, 1, 2, BUF);
        rt.mem.write16(W_A + 0xaa, c.width);
        rt.mem.write16(W_B + 0xaa, c.width);
        const beforeLine = bytesOf(rt, LINE, 0x20);
        const oracle = rt.cpu.call(0x8001a8b4, [W_A, LINE]) | 0;
        const afterOracleLine = bytesOf(rt, LINE, 0x20);
        // restore the line for the port run
        for (let i = 0; i < 0x20; i++) rt.mem.write8(LINE + i, beforeLine[i]);
        const port = textHandlerPageScan(rt.mem, W_B, LINE) | 0;
        assert.equal(port, oracle, `${c.name} return`);
        assert.deepEqual(bytesOf(rt, W_B, WIN), bytesOf(rt, W_A, WIN), `${c.name} widget`);
        assert.deepEqual(bytesOf(rt, LINE, 0x20), afterOracleLine, `${c.name} line`);
    }
});

test("textHandlerNoop matches F0x8001AA08", () => {
    const rt = runtime();
    assert.equal(textHandlerNoop(), rt.cpu.call(0x8001aa08, [W_A, LINE, TOK_A]) | 0);
});

test("textHandlerSetLine matches F0x8001AB30", () => {
    const rt = runtime();
    for (const operand of [0, 1, 0x40, 0xfe, 0xff, 0x100]) {
        seedLine(rt, [4, 6, operand, 7, 0], 0, 5, 0);
        seedWidget(rt, W_A, [], 0, 1, 2, BUF);
        seedWidget(rt, W_B, [], 0, 1, 2, BUF);
        rt.mem.write32(LINE + 0, BUF);
        rt.mem.write16(LINE + 8, 0);
        const oracle = rt.cpu.call(0x8001ab30, [W_A, LINE, TOK_A]) | 0;
        const afterBuffer = [];
        for (let i = 0; i < 8; i++) afterBuffer.push(rt.mem.read8(BUF + i));
        // reset the buffer byte the original overwrote, then run the port
        for (let i = 0; i < 8; i++) rt.mem.write8(BUF + i, [4, 6, operand, 7, 0][i] ?? 0);
        const port = textHandlerSetLine(rt.mem, W_B, LINE) | 0;
        assert.equal(port, oracle, `operand=${operand} return`);
        assert.deepEqual(bytesOf(rt, W_B, WIN), bytesOf(rt, W_A, WIN), `operand=${operand} widget`);
        for (let i = 0; i < 8; i++) {
            assert.equal(rt.mem.read8(BUF + i), afterBuffer[i], `operand=${operand} buffer[${i}]`);
        }
    }
});
