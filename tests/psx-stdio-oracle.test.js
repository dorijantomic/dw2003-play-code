// Phase 4 oracle: engine/dw3/psx-stdio.ts must reproduce the Psy-Q stdout
// byte/flush pair byte for byte.
//
// F0x80028B2C putchar: tab expands to the next multiple of 8 columns
// (D0x80056048 is the column counter), '\n' emits '\r' first and resets the
// column counter, and any char whose ctype table entry (D0x80055E19) has any
// of 0x97 increments the column. Both buffered chars and the 0x20-byte
// buffer-full flush write through fwrite(1, D0x80081200, n).
// F0x80028C28 flush: fwrite only when D0x8005604c > 0, then zero the count.
//
// The harness stubs fwrite (a bios jump, never executed here) on the
// interpreter side and records every call; the port takes the same calls
// through the host object. Column counter, buffer bytes and return path are
// compared after each step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    STDOUT_BUFFER,
    STDOUT_COUNT,
    STDOUT_COLUMN,
    putchar,
    flushStdout,
    printfFormat,
    printfWrap,
} from "../engine/dw3/psx-stdio.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const PUTCHAR = 0x80028b2c;
const FLUSH = 0x80028c28;
const FWRITE = 0x800250cc; // the real fwrite (bios jump 0xb0/0x35, fns.s:23052)

const COL = 0x80056048;
const COUNT = STDOUT_COUNT;
const BUFFER = STDOUT_BUFFER;

function makeRt(calls) {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(FWRITE, (c) => {
        calls.push(["fwrite", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return 0;
    });
    return rt;
}

function seed(rt) {
    rt.mem.write32(COL, 0);
    rt.mem.write32(COUNT, 0);
    for (let i = 0; i < 0x20; i++) rt.mem.write8(STDOUT_BUFFER + i, 0x5a);
}

function state(rt) {
    const buffer = [];
    for (let i = 0; i < 0x20; i++) buffer.push(rt.mem.read8(STDOUT_BUFFER + i));
    return { col: rt.mem.read32(COL) >>> 0, count: rt.mem.read32(COUNT) >>> 0, buffer };
}

function portHost(calls) {
    return { fwrite: (fd, buf, len) => { calls.push(["fwrite", fd >>> 0, buf >>> 0, len >>> 0]); return 0; } };
}

test("stdout CR/LF exact byte stream matches the original interpreter", () => {
    for (const [chars, expected] of [
        [[0x0a], [0x0d, 0x0a]],
        [[0x0d], [0x0d]],
        [[0x0d, 0x0a], [0x0d, 0x0d, 0x0a]],
    ]) {
        for (const mode of ["original", "port"]) {
            const rt = makeRt([]);
            seed(rt);
            const bytes = [];
            const sink = (fd, buf, len) => {
                assert.equal(fd, 1);
                for (let i = 0; i < len; i++) bytes.push(rt.mem.read8(buf + i));
            };
            if (mode === "original") {
                rt.cpu.setStub(FWRITE, (cpu) => {
                    sink(cpu.reg(4), cpu.reg(5), cpu.reg(6));
                    return 0;
                });
                for (const ch of chars) rt.cpu.call(PUTCHAR, [ch]);
                rt.cpu.call(FLUSH, []);
            } else {
                for (const ch of chars) putchar(rt.mem, ch, { fwrite: sink });
                flushStdout(rt.mem, { fwrite: sink });
            }
            assert.deepEqual(bytes, expected, `${mode}: ${JSON.stringify(chars)}`);
            assert.equal(rt.mem.read32(COUNT), 0);
        }
    }
});

test("putchar/flushStdout match F0x80028B2C / F0x80028C28", () => {
    const SEQUENCES = [
        [0x41, 0x42],                       // plain, countable
        [0x09],                             // tab to column 8 from 0
        [0x41, 0x09],                       // tab mid-line
        [0x0a],                             // newline emits 0x0d first, resets col
        [0x41, 0x0a, 0x41],                 // reset then countable
        Array.from({ length: 0x20 }, (_, i) => 0x41 + (i & 0x1f)), // exact fill
        Array.from({ length: 0x21 }, (_, i) => 0x41 + (i & 0x1f)), // fill + 1 -> fwrite
        [0x41, 0x09, 0x0a, 0x09],           // tab-newline-tab interplay
        [0x07],                             // ctype 0 -> counted, not column-tracked
    ];
    for (const chars of SEQUENCES) {
        const callsA = [];
        const a = makeRt(callsA);
        seed(a);
        const callsB = [];
        const b = makeRt([]);
        seed(b);
        for (const ch of chars) {
            a.cpu.call(PUTCHAR, [ch]);
            putchar(b.mem, ch, portHost(callsB));
            assert.deepEqual(state(b), state(a), `step ${ch} in ${JSON.stringify(chars)}`);
            assert.deepEqual(callsB, callsA);
        }
        a.cpu.call(FLUSH, []);
        flushStdout(b.mem, portHost(callsB));
        assert.deepEqual(state(b), state(a), `state chars=${JSON.stringify(chars)}`);
        assert.deepEqual(callsB, callsA, `calls chars=${JSON.stringify(chars)}`);
    }
});

test("stdout signed counts, buffer boundaries and byte narrowing match the interpreter", () => {
    for (const count of [-1, 0, 31, 32, 33]) {
        for (const col of [0, 7, 8, 0xffffffff]) {
            for (const ch of [0x41, 0x109, 0x10a, 0x180, -1]) {
                const callsA = [], callsB = [];
                const a = makeRt(callsA), b = makeRt([]);
                for (const rt of [a, b]) {
                    seed(rt);
                    rt.mem.write32(COUNT, count);
                    rt.mem.write32(COL, col);
                    rt.mem.write8(BUFFER - 1, 0x66);
                }
                a.cpu.call(PUTCHAR, [ch]);
                putchar(b.mem, ch, portHost(callsB));
                assert.deepEqual(state(b), state(a), `count=${count} col=${col} ch=${ch}`);
                assert.equal(b.mem.read8(BUFFER - 1), a.mem.read8(BUFFER - 1));
                assert.deepEqual(callsB, callsA);
                a.cpu.call(FLUSH, []);
                flushStdout(b.mem, portHost(callsB));
                assert.deepEqual(state(b), state(a));
                assert.deepEqual(callsB, callsA);
            }
        }
    }
    for (const count of [-1, -0x80000000, 0]) {
        const callsA = [], callsB = [];
        const a = makeRt(callsA), b = makeRt([]);
        for (const rt of [a, b]) { seed(rt); rt.mem.write32(COUNT, count); }
        a.cpu.call(FLUSH, []);
        flushStdout(b.mem, portHost(callsB));
        assert.deepEqual(state(b), state(a));
        assert.deepEqual(callsB, callsA);
        assert.deepEqual(callsA, []);
    }
});

test("ctype gate matches the interpreter for ascii/hi/ctl chars", () => {
    const chars = [0x0d, 0x20, 0x41, 0x80, 0xff, 0x0a, 0x09];
    const callsA = [];
    const a = makeRt(callsA);
    seed(a);
    for (const ch of chars) a.cpu.call(PUTCHAR, [ch]);
    const callsB = [];
    const b = makeRt([]);
    seed(b);
    for (const ch of chars) putchar(b.mem, ch, portHost(callsB));
    assert.deepEqual(state(b), state(a), "column counter and buffer follow the ctype gate");
    assert.deepEqual(callsB, callsA, "fwrite calls follow the ctype gate");
    // LF resets the column, then the final tab emits eight spaces. These
    // assertions are separate from the differential comparison above.
    assert.equal(b.mem.read32(STDOUT_COLUMN), 8);
    assert.equal(b.mem.read32(STDOUT_COUNT), 15);
});


// ── the printf formatter F0x8002843C + wrapper F0x800283FC ──
//
// Oracle shape: the ORIGINAL addresses run through engine/native on the real
// resident image (the real dispatch table D0x80010528, the digit tables and
// the ctype table are IN the image), with the fwrite BIOS stub capturing the
// exact byte snapshot of every call. The TS port formats from a seeded cursor
// block on the same memory and captures the same snapshots through its host.
// Ordered snapshots, stdout state and the conversion accumulator must match.
const FMT = 0x8002843c;
const WRAP = 0x800283fc;
const BLOCK = 0x80081300;
const GPU_TIMEOUT_FMT = 0x800104b8; // the image's own "GPU timeout:que=..." string

function fmtSetup(rt, fmtBytes, argWords) {
    seed(rt);
    const fmtAddr = 0x80081500;
    for (let i = 0; i < fmtBytes.length; i++) rt.mem.write8(fmtAddr + i, fmtBytes[i]);
    rt.mem.write8(fmtAddr + fmtBytes.length, 0);
    for (let i = 0; i < argWords.length; i++) rt.mem.write32(BLOCK + i * 4, argWords[i]);
    return fmtAddr;
}

function fmtSnap(rt) {
    const buffer = [];
    for (let i = 0; i < 0x20; i++) buffer.push(rt.mem.read8(BUFFER));
    return { col: rt.mem.read32(COL) | 0, count: rt.mem.read32(COUNT) | 0, buffer: rt ? buffer : [] };
}

function runOriginal(fmtBytes, argWords) {
    const calls = [];
    const rt = makeRt(calls);
    const fmtAddr = fmtSetup(rt, fmtBytes, argWords);
    const acc = rt.cpu.call(FMT, [1, fmtAddr, BLOCK]);
    const bytes = calls.map(([fd, buf, len]) => Array.from({ length: len }, (_, i) => rt.mem.read8(buf + i)));
    return { acc: acc | 0, bytes, state: fmtSnap(rt) };
}

function runPort(fmtBytes, argWords) {
    const calls = [];
    const rt = makeRt([]);
    const fmtAddr = fmtSetup(rt, fmtBytes, argWords);
    const acc = printfFormat(rt.mem, fmtAddr, BLOCK, portHost(calls));
    const bytes = calls.map(([fd, buf, len]) => Array.from({ length: len }, (_, i) => rt.mem.read8(buf + i)));
    return { acc, bytes, state: fmtSnap(rt) };
}

const fmtBytes = (s) => Array.from(Buffer.from(s, "latin1"));

/**
 * Byte snapshots of every fwrite call. The interpreter-side stub records
 * 4-tuples ["fwrite", fd, buf, len]; the port's host pushes [fd, buf, len].
 * Both normalize here so the comparison sees the same shape.
 */
function captureSnapshots(rt, calls) {
    return calls.map((entry) => {
        const [fd, buf, len] = entry.length === 4 ? entry.slice(1) : entry;
        void fd;
        return Array.from({ length: len }, (_, i) => rt.mem.read8(buf + i));
    });
}

test("printfFormat matches F0x8002843C across the conversion ladder", () => {
    const CASES = [
        { name: "%d", fmt: "%d", args: [42] },
        { name: "%d negative", fmt: "%d", args: [-5] },
        { name: "%x full word", fmt: "%x", args: [0xdeadbeef | 0] },
        { name: "%X uppercase", fmt: "%X", args: [0xabc] },
        { name: "%o", fmt: "%o", args: [9] },
        { name: "%u large", fmt: "%u", args: [-1] },
        { name: "%p", fmt: "%p", args: [0x80140000 | 0] },
        { name: "%i INT_MIN", fmt: "%i", args: [-2147483648] },
        { name: "%08d", fmt: "%08d", args: [-42] },
        { name: "%+d", fmt: "%+d", args: [7] },
        { name: "%#x", fmt: "%#x", args: [255] },
        { name: "%.0d zero", fmt: "%.0d", args: [0] },
        { name: "%5.3d", fmt: "%5.3d", args: [7] },
        { name: "%-8x", fmt: "%-8x", args: [0xbeef] },
        { name: "%*d", fmt: "%*d", args: [6, 42] },
        { name: "%-+08.5d", fmt: "%-+08.5d", args: [42] },
        { name: "%lX", fmt: "%lX", args: [0x7fff] },
        { name: "%hd", fmt: "%hd", args: [70000] },
        { name: "%ho negative half", fmt: "%ho", args: [-1] },
        { name: "%hx", fmt: "%hx", args: [0x1234abcd | 0] },
        { name: "%D long-flag fallthrough", fmt: "%D", args: [-3] },
        { name: "%O long-flag fallthrough", fmt: "%O", args: [9] },
        { name: "%U long-flag fallthrough", fmt: "%U", args: [300] },
        { name: "%% literal percent", fmt: "A%%B", args: [] },
        { name: "unknown %q", fmt: "%q!", args: [] },
        { name: "plain literals", fmt: "plain", args: [] },
        { name: "trailing %", fmt: "x%", args: [] },
        { name: "%c", fmt: "%c", args: [65] },
        { name: "%s", fmt: "%s", args: ["hello".length + 1 > 0 ? 0x80081600 : 0] },
        { name: "%s NULL", fmt: "%s|null", args: [0] },
        { name: "%hn", fmt: "%hn", args: [BLOCK + 0x40] },
        { name: "%n", fmt: "%n", args: [BLOCK + 0x44] },
    ];
    for (const tc of CASES) {
        const argWords = tc.args.map((v, i) => (tc.name === "%s" && i === 0 ? 0x80081600 : v));
        // %s/%hn/%n need seeded memory
        const callsA = [];
        const a = makeRt(callsA);
        a.mem.write32(0x80081600, 0x6c6c6568); a.mem.write16(0x80081604, 0x006f);
        a.mem.write32(BLOCK + 0x40, 0); a.mem.write32(BLOCK + 0x44, 0);
        let fmtAddr = fmtSetup(a, Array.from(Buffer.from(tc.fmt, "latin1")), argWords);
        const accA = a.cpu.call(FMT, [1, fmtAddr, BLOCK]);
        const bytesA = captureSnapshots(a, callsA);
        const callsB = [];
        const b = makeRt([]);
        b.mem.write32(0x80081600, 0x6c6c6568); b.mem.write16(0x80081604, 0x006f);
        b.mem.write32(BLOCK + 0x40, 0); b.mem.write32(BLOCK + 0x44, 0);
        fmtAddr = fmtSetup(b, Array.from(Buffer.from(tc.fmt, "latin1")), argWords);
        const accB = printfFormat(b.mem, fmtAddr, BLOCK, portHost(callsB));
        const bytesB = captureSnapshots(b, callsB);
        assert.deepEqual(
            { acc: accB | 0, bytes: bytesB, col: b.mem.read32(COL) | 0, count: b.mem.read32(COUNT) | 0 },
            { acc: accA, bytes: bytesA, col: a.mem.read32(COL) | 0, count: a.mem.read32(COUNT) | 0 },
            tc.name,
        );
    }
});

test("printfWrap matches F0x800283FC on the image's GPU-timeout format", () => {
    const args = [0x1234, 0x04000001, 0x11000002, 0x80140000];
    // original: wrapper ABI with the 4th variadic word on the incoming stack
    const callsA = [];
    const a = makeRt(callsA);
    seed(a);
    a.cpu.sp = 0x801f8000;
    a.mem.write32(0x801f8010, args[3]);
    const accA = a.cpu.call(WRAP, [GPU_TIMEOUT_FMT, args[0], args[1], args[2]]) | 0;
    const bytesA = captureSnapshots(a, callsA);
    // port: flat block = the same four words
    const callsB = [];
    const b = makeRt([]);
    seed(b);
    const accB = printfWrap(b.mem, GPU_TIMEOUT_FMT, BLOCK, args, portHost(callsB)) | 0;
    const bytesB = captureSnapshots(b, callsB);
    assert.deepEqual({ acc: accB, bytes: bytesB, col: b.mem.read32(COL) | 0, count: b.mem.read32(COUNT) | 0 },
        { acc: accA, bytes: bytesA, col: a.mem.read32(COL) | 0, count: a.mem.read32(COUNT) | 0 },
        "GPU timeout workload through the wrapper");
    assert.equal(bytesA.length > 0, true, "the workload flushed at least once");
});
