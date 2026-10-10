// Phase 4 oracle: engine/dw3/ui/int-to-decimal.ts must write exactly the bytes
// the original F0x80019508 writes for the same destination buffer and value. The
// resident image runs through engine/native (the interpreter) as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { intToDecimalAscii } from "../engine/dw3/ui/int-to-decimal.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const BUF_A = 0x80150000;
const BUF_B = 0x80150040;
const LEN = 24;

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

function bytes(rt, base) {
    const out = [];
    for (let i = 0; i < LEN; i++) out.push(rt.mem.read8(base + i));
    return out;
}

function ascii(rt, base, n) {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(rt.mem.read8(base + i));
    return s;
}

test("intToDecimalAscii matches the interpreter (F0x80019508)", () => {
    const rt = runtime();
    const values = [
        -2147483648, -123, -1, 0, 1, 2, 5, 9, 10, 11, 42, 99, 100, 101, 999,
        1000, 1001, 12345, 100000, 999999, 1000000, 1000000000, 1234567890, 2147483647,
    ];
    for (const v of values) {
        for (let i = 0; i < LEN; i++) {
            rt.mem.write8(BUF_A + i, 0xaa);
            rt.mem.write8(BUF_B + i, 0xaa);
        }
        rt.cpu.call(0x80019508, [BUF_A, v]);
        intToDecimalAscii(rt.mem, BUF_B, v);
        assert.deepEqual(bytes(rt, BUF_B), bytes(rt, BUF_A), `value ${v}`);
    }
});

test("intToDecimalAscii writes the documented plain digits", () => {
    const rt = runtime();
    const cases = [
        [0, "0"],
        [-5, "0"],
        [1, "1"],
        [9, "9"],
        [10, "10"],
        [12345, "12345"],
        [1000000, "1000000"],
    ];
    for (const [v, expected] of cases) {
        for (let i = 0; i < LEN; i++) rt.mem.write8(BUF_B + i, 0);
        intToDecimalAscii(rt.mem, BUF_B, v);
        assert.equal(ascii(rt, BUF_B, expected.length), expected, `value ${v}`);
        // No terminator is written: the byte after the digits stays untouched.
        assert.equal(rt.mem.read8(BUF_B + expected.length), 0, `terminator after ${v}`);
    }
});
