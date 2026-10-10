// Phase 4 oracle: engine/dw3/ui/fetch-table.ts must reproduce the original
// fetcher service builder F0x8001FCC0 and the code converter F0x8001FA20 over
// the same resident tables. engine/native runs the original addresses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { convertTextEncoding, FONT_TABLE_A, FONT_TABLE_B, initFetcherTable } from "../engine/dw3/ui/fetch-table.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const BLOCK_A = 0x80150000;
const BLOCK_B = 0x80150100;
const SRC = 0x80151000;
const DST_A = 0x80152000;
const DST_B = 0x80152400;
const GLOBAL = 0x8005cd18;
const DST_WIN = 0x200;
const SWAP = (v) => ((v >>> 8) | ((v & 0xff) << 8)) & 0xffff;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function setSrc(rt, bytes) {
    for (let i = 0; i < 0x400; i++) rt.mem.write8(SRC + i, 0);
    for (let i = 0; i < bytes.length; i++) rt.mem.write8(SRC + i, bytes[i] & 0xff);
}

function bytesOf(rt, base, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rt.mem.read8(base + i));
    return out;
}

function tableEntries(rt, base, start) {
    const out = [];
    let e = base + start;
    for (let i = 0; i < 512; i++) {
        const code = rt.mem.read16(e);
        if (code === 0xffff) break;
        out.push({ code, byte: rt.mem.read8(e + 2) & 0xff });
        e += 4;
    }
    return out;
}

test("initFetcherTable matches F0x8001FCC0", () => {
    const rt = runtime();
    for (let i = 0; i < 0x20; i++) { rt.mem.write8(BLOCK_A + i, 0xaa); rt.mem.write8(BLOCK_B + i, 0xaa); }
    rt.cpu.call(0x8001fcc0, [BLOCK_A]);
    initFetcherTable(rt.mem, BLOCK_B);
    assert.deepEqual(bytesOf(rt, BLOCK_B, 0x20), bytesOf(rt, BLOCK_A, 0x20));
    assert.equal(rt.mem.read32(BLOCK_A) >>> 0, rt.mem.read32(BLOCK_B) >>> 0);
    assert.equal(rt.mem.read32(GLOBAL) >>> 0, BLOCK_B >>> 0);
    assert.equal(rt.mem.read32(BLOCK_B) >>> 0, 0x8001f744);
    assert.equal(rt.mem.read32(BLOCK_B + 4) >>> 0, 0x8001f770);
    assert.equal(rt.mem.read32(BLOCK_B + 8) >>> 0, 0x8001fa20);
});

test("convertTextEncoding mode 0 matches F0x8001FA20 over single bytes", () => {
    const rt = runtime();
    for (let b = 1; b < 0x100; b++) {
        setSrc(rt, [b, 0]);
        for (let i = 0; i < DST_WIN; i++) { rt.mem.write8(DST_A + i, 0xcc); rt.mem.write8(DST_B + i, 0xcc); }
        const oracle = rt.cpu.call(0x8001fa20, [DST_A, SRC, 0]) | 0;
        const port = convertTextEncoding(rt.mem, DST_B, SRC, 0) | 0;
        assert.equal(port, oracle, `byte=0x${b.toString(16)} return`);
        assert.deepEqual(bytesOf(rt, DST_B, DST_WIN), bytesOf(rt, DST_A, DST_WIN), `byte=0x${b.toString(16)}`);
    }
});

test("convertTextEncoding mode 0 matches on pair and table-built sources", () => {
    const rt = runtime();
    const a = tableEntries(rt, FONT_TABLE_A, 0x10);
    const sources = [
        [1, 0x41, 0],
        [2, 0x41, 0],
        [3, 0x41, 0],
        [1, 0x7f, 2, 0x20, 3, 0x10, 0],
        a.slice(0, 24).map((e) => e.byte).concat([0]),
        a.slice(0, 8).map((e) => e.byte).concat([1, 0x41, 0]),
        new Array(0x80).fill(0).map((_, i) => (i % 251) + 1).concat([0]),
    ];
    for (const bytes of sources) {
        setSrc(rt, bytes);
        for (let i = 0; i < DST_WIN; i++) { rt.mem.write8(DST_A + i, 0xcc); rt.mem.write8(DST_B + i, 0xcc); }
        const oracle = rt.cpu.call(0x8001fa20, [DST_A, SRC, 0]) | 0;
        const port = convertTextEncoding(rt.mem, DST_B, SRC, 0) | 0;
        assert.equal(port, oracle, `src=[${bytes.slice(0, 8)}...] return`);
        assert.deepEqual(bytesOf(rt, DST_B, DST_WIN), bytesOf(rt, DST_A, DST_WIN), `src=[${bytes.slice(0, 8)}...]`);
    }
});

test("convertTextEncoding mode 1 matches F0x8001FA20", () => {
    const rt = runtime();
    const a = tableEntries(rt, FONT_TABLE_A, 0x10);
    const b = tableEntries(rt, FONT_TABLE_B, 4);
    const halfword = (code) => [code & 0xff, (code >>> 8) & 0xff]; // source is byte-swapped back
    const sources = [
        halfword(SWAP(a[0]?.code ?? 0x8140)).concat([0, 0]),
        halfword(SWAP(a[1]?.code ?? 0x8141)).concat(halfword(SWAP(a[2]?.code ?? 0x8142)), [0, 0]),
        halfword(SWAP(b[0]?.code ?? 0x1234)).concat([0, 0]),
        halfword(SWAP(b[3]?.code ?? 0x1234)).concat([0, 0]),
        halfword(SWAP(b[5]?.code ?? 0x1234)).concat([0, 0]),
        [0x41, 0x42, 0x43, 0x44, 0],
        a.slice(0, 6).flatMap((e) => halfword(SWAP(e.code))).concat([0, 0]),
        a.slice(0, 3).flatMap((e) => halfword(SWAP(e.code))).concat(halfword(SWAP(b[0]?.code ?? 0x1234)), [0, 0]),
        new Array(0x80).fill(0).map((_, i) => (i * 7) & 0xff).concat([0, 0]),
    ];
    // A matching halfword planted just past the NUL: a port that walks the
    // whole strlen instead of strlen>>1 halfwords writes it.
    const planted = halfword(SWAP(a[5]?.code ?? 0x8254));
    const planted2 = halfword(SWAP(a[6]?.code ?? 0x8255));
    // three source halfwords, NUL at +6, a matching halfword planted at +8:
    // a port that walks strlen halfwords instead of strlen>>1 writes one extra
    sources.push([0x43, 0x81, 0x43, 0x81, planted[0], planted[1], 0x00, 0x00, planted2[0], planted2[1], 0x00, 0x00]);
    for (const bytes of sources) {
        setSrc(rt, bytes);
        if (bytes.length > 8) {
            // the planted matching halfword sits at SRC+4, past the NUL
            for (let i = 0; i < bytes.length; i++) rt.mem.write8(SRC + i, bytes[i] & 0xff);
        }
        for (let i = 0; i < DST_WIN; i++) { rt.mem.write8(DST_A + i, 0xcc); rt.mem.write8(DST_B + i, 0xcc); }
        const oracle = rt.cpu.call(0x8001fa20, [DST_A, SRC, 1]) | 0;
        const port = convertTextEncoding(rt.mem, DST_B, SRC, 1) | 0;
        assert.equal(port, oracle, `mode1 src=[${bytes.slice(0, 8)}...] return`);
        assert.deepEqual(bytesOf(rt, DST_B, DST_WIN), bytesOf(rt, DST_A, DST_WIN), `mode1 src=[${bytes.slice(0, 8)}...]`);
    }
});

test("convertTextEncoding handles empty sources and unknown modes", () => {
    const rt = runtime();
    for (const mode of [0, 1, 2, 3, 0x100]) {
        setSrc(rt, [0]);
        for (let i = 0; i < DST_WIN; i++) { rt.mem.write8(DST_A + i, 0xcc); rt.mem.write8(DST_B + i, 0xcc); }
        const oracle = rt.cpu.call(0x8001fa20, [DST_A, SRC, mode]) | 0;
        const port = convertTextEncoding(rt.mem, DST_B, SRC, mode) | 0;
        assert.equal(port, oracle, `mode=${mode} return`);
        assert.deepEqual(bytesOf(rt, DST_B, DST_WIN), bytesOf(rt, DST_A, DST_WIN), `mode=${mode}`);
    }
});
