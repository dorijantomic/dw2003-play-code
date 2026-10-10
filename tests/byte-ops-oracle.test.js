// Phase 4 oracle: engine/dw3/byte-ops.ts memcpyBytes/strlenBytes must match the
// interpreter. The resident image runs through engine/native as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { memcpyBytes, strlenBytes } from "../engine/dw3/byte-ops.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const SRC = 0x80150000;
const DST_A = 0x80150100;
const DST_B = 0x80150200;
const WIN = 0x80;

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

function bytes(rt, base, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rt.mem.read8(base + i));
    return out;
}

function seed(rt) {
    for (let i = 0; i < WIN; i++) {
        rt.mem.write8(SRC + i, (i * 7 + 3) & 0xff);
        rt.mem.write8(DST_A + i, 0xaa);
        rt.mem.write8(DST_B + i, 0xaa);
    }
}

test("memcpyBytes matches the interpreter (F0x8002514C)", () => {
    const rt = runtime();
    for (const n of [-3, 0, 1, 5, 16, 0x40]) {
        seed(rt);
        const oracleRet = rt.cpu.call(0x8002514c, [DST_A, SRC, n]) >>> 0;
        const portRet = memcpyBytes(rt.mem, DST_B, SRC, n);
        // Both must return their own dest (their addresses differ on purpose).
        assert.equal(oracleRet, DST_A, `oracle return n=${n}`);
        assert.equal(portRet, DST_B, `port return n=${n}`);
        assert.deepEqual(bytes(rt, DST_B, WIN), bytes(rt, DST_A, WIN), `bytes n=${n}`);
    }
    // dest == 0 returns 0 and writes nothing.
    const oracleNull = rt.cpu.call(0x8002514c, [0, SRC, 8]) | 0;
    assert.equal(memcpyBytes(rt.mem, 0, SRC, 8), oracleNull);
    assert.equal(oracleNull, 0);
});

test("memcpyBytes forward-copies an overlap like the original", () => {
    const rt = runtime();
    seed(rt);
    // dest = src + 1: the original copies forward, so the pattern propagates.
    const oracleRet = rt.cpu.call(0x8002514c, [SRC + 1, SRC, 8]) >>> 0;
    const portRet = memcpyBytes(rt.mem, SRC + 1, SRC, 8);
    assert.equal(portRet, oracleRet);
    assert.deepEqual(bytes(rt, SRC + 1, 16), bytes(rt, SRC + 1, 16));
    // Re-seed and run the port alone to compare its result to the oracle's.
    seed(rt);
    rt.cpu.call(0x8002514c, [SRC + 1, SRC, 8]);
    const oracle = bytes(rt, SRC, 24);
    seed(rt);
    memcpyBytes(rt.mem, SRC + 1, SRC, 8);
    assert.deepEqual(bytes(rt, SRC, 24), oracle);
});

test("strlenBytes matches the interpreter (F0x8002525C)", () => {
    const rt = runtime();
    const strings = ["", "a", "hello", "Digimon World 2003", "x".repeat(0x50)];
    for (const s of strings) {
        for (let i = 0; i < WIN; i++) rt.mem.write8(SRC + i, 0x41);
        for (let i = 0; i < s.length; i++) rt.mem.write8(SRC + i, s.charCodeAt(i));
        rt.mem.write8(SRC + s.length, 0);
        const oracle = rt.cpu.call(0x8002525c, [SRC]) | 0;
        assert.equal(strlenBytes(rt.mem, SRC), oracle, `string len ${s.length}`);
        assert.equal(oracle, s.length, `fixture len ${s.length}`);
    }
    assert.equal(rt.cpu.call(0x8002525c, [0]) | 0, 0);
    assert.equal(strlenBytes(rt.mem, 0), 0);
});
