// Phase 4 oracle: engine/dw3/ui/card-view.ts's pack uploader must reproduce
// F0x8001FE38 (the helper's +0x2C slot) and its table reader F0x80014110.
//
// One seeded pack is uploaded by the original through engine/native and by the
// port on an identical image. Every device boundary (the heap's alloc/free
// cells, DrawSync and libgpu LoadImage) is a deterministic stub on BOTH sides,
// so the ordered uploads, the RLEN decode output and the helper state are
// compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    CARD_HELPER_CELL,
    RLEN_TAG,
    cardViewHelperUploadPack,
    decodeRlenStream,
    resolveRelativeTableEntry,
} from "../engine/dw3/ui/card-view.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const GP = 0x8005cb50;
const HELPER = 0x80192000;
const SCRATCH = 0x80193000;
const PACK = 0x80194000;
const ALLOC_CELL = 0x8004b5f4;
const FREE_CELL = 0x8004b5ec;
const ALLOC_STUB = 0x800190a0;
const FREE_STUB = 0x800190b0;
const DRAWSYNC = 0x80025868;

/** Encode bytes as an RLEN stream (runs + literals) so the decode is exercised. */
function rlen(bytes) {
    const out = [];
    let i = 0;
    while (i < bytes.length) {
        let run = 1;
        while (i + run < bytes.length && bytes[i + run] === bytes[i] && run < 0x7f) run++;
        if (run >= 3) {
            out.push(0x80 | run, bytes[i]);
            i += run;
            continue;
        }
        let lit = 1;
        while (i + lit < bytes.length && lit < 0x7f) {
            const b = bytes[i + lit];
            let r = 1;
            while (i + lit + r < bytes.length && bytes[i + lit + r] === b && r < 3) r++;
            if (r >= 3) break;
            lit++;
        }
        out.push(lit);
        for (let k = 0; k < lit; k++) out.push(bytes[i + k]);
        i += lit;
    }
    out.push(0);
    return out;
}

/** A TIM header the uploader accepts: flags 0 at +4, one block at +8. */
function timBytes(w, h) {
    const b = new Uint8Array(0x20);
    b[4] = 0; // flags: no CLUT, 4-bit
    b[8] = w & 0xff; b[9] = (w >> 8) & 0xff;
    b[10] = h & 0xff; b[11] = (h >> 8) & 0xff;
    for (let i = 0; i < 0x10; i++) b[0xc + i] = (0x11 * (i + 1)) & 0xff;
    return b;
}

function scenario() {
    const loads = [];
    const syncs = [];
    const allocs = [];
    const frees = [];
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = GP;
    rt.cpu.setStub(ALLOC_STUB, (c) => { allocs.push([c.reg(4) | 0, c.reg(5) | 0]); return SCRATCH; });
    rt.cpu.setStub(FREE_STUB, (c) => { frees.push(c.reg(4) >>> 0); return 0; });
    rt.cpu.setStub(DRAWSYNC, (c) => { syncs.push(c.reg(4) | 0); return 0; });
    rt.cpu.setStub(0x80025b14, (c) => {
        const r = c.reg(4) >>> 0;
        loads.push([
            rt.mem.read16(r) | 0, rt.mem.read16(r + 2) | 0,
            rt.mem.read16(r + 4) | 0, rt.mem.read16(r + 6) | 0,
            c.reg(5) >>> 0,
        ]);
        return 0;
    });
    rt.mem.write32(ALLOC_CELL, ALLOC_STUB);
    rt.mem.write32(FREE_CELL, FREE_STUB);
    rt.mem.write32(CARD_HELPER_CELL, HELPER);
    rt.mem.write32(HELPER + 0x8, 0x140);   // pair A x (advanced per record)
    rt.mem.write32(HELPER + 0xc, 0x100);   // pair A y
    rt.mem.write32(HELPER + 0x10, 0x300);  // pair B x
    rt.mem.write32(HELPER + 0x14, 0x100);  // pair B y
    rt.mem.write32(HELPER + 0x18, 0x200);  // scratch size
    for (let i = 0; i < 0x40; i++) rt.mem.write8(SCRATCH + i, 0xee);
    return { rt, loads, syncs, allocs, frees };
}

function helperBytes(rt) {
    const out = [];
    for (let i = 0; i < 0x34; i += 4) out.push(rt.mem.read32(HELPER + i) >>> 0);
    return out;
}

function scratchBytes(rt, n = 0x40) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rt.mem.read8(SCRATCH + i));
    return out;
}

/** Write a pack: records as [ {offset, bytes} ] laid out from PACK. */
function seedPack(rt, records) {
    let at = PACK + 0x40;
    const table = [];
    for (const rec of records) {
        const bytes = rec.bytes ?? rec;
        table.push(at - PACK);
        for (let i = 0; i < bytes.length; i++) rt.mem.write8(at + i, bytes[i]);
        at += Math.max(0x20, bytes.length);
    }
    for (let i = 0; i < table.length; i++) rt.mem.write32(PACK + i * 4, table[i]);
    rt.mem.write32(PACK + table.length * 4, 0); // the walk's stop
    return records.map((r, i) => PACK + table[i]);
}

function portHost(s) {
    return {
        resourceGetBase: () => 0,
        loadImage: (x, y, w, h, data) => s.loads.push([x | 0, y | 0, w | 0, h | 0, data >>> 0]),
        findRegisteredHandleByKey: () => 0,
        callViewMethod: () => 0,
        allocScratch: (size, tag) => { s.allocs.push([size | 0, tag | 0]); return SCRATCH; },
        free: (ptr) => { s.frees.push(ptr >>> 0); },
        drawSync: () => { s.syncs.push(0); },
    };
}

function plainRecord(w, h) {
    return timBytes(w, h);
}

function rlenRecord(w, h) {
    const tim = timBytes(w, h);
    const stream = rlen(Array.from(tim));
    const out = new Uint8Array(8 + stream.length);
    out[0] = RLEN_TAG & 0xff; out[1] = (RLEN_TAG >>> 8) & 0xff;
    out[2] = (RLEN_TAG >>> 16) & 0xff; out[3] = (RLEN_TAG >>> 24) & 0xff;
    for (let i = 0; i < stream.length; i++) out[8 + i] = stream[i] & 0xff;
    return out;
}

/**
 * A hand-built RLEN stream that decodes to a 4x4 TIM and exercises the run,
 * the count-0 run and the literal branch: 8 zero bytes, a literal 04 00 04 00
 * and a three-byte run. Compared through the scratch bytes the pack uploader
 * writes.
 */
function edgeRlenRecord(w, h) {
    const tim = timBytes(w, h);
    const stream = [0x84, 0x00, 0x80, 0x7a, 0x84, 0x00,
        0x04, tim[8], tim[9], tim[10], tim[11],
        0x83, 0x11, 0x00];
    const out = new Uint8Array(8 + stream.length);
    out[0] = RLEN_TAG & 0xff; out[1] = (RLEN_TAG >>> 8) & 0xff;
    out[2] = (RLEN_TAG >>> 16) & 0xff; out[3] = (RLEN_TAG >>> 24) & 0xff;
    for (let i = 0; i < stream.length; i++) out[8 + i] = stream[i] & 0xff;
    return out;
}

test("cardViewHelperUploadPack matches F0x8001FE38", () => {
    const packs = [
        { name: "two plain", records: [plainRecord(8, 8), plainRecord(16, 8)] },
        { name: "plain + rlen", records: [plainRecord(8, 8), rlenRecord(4, 4)] },
        { name: "rlen only", records: [rlenRecord(2, 2)] },
        { name: "rlen edge stream", records: [edgeRlenRecord(4, 4)] },
        { name: "many records", records: [plainRecord(8, 8), rlenRecord(4, 4), plainRecord(8, 8), rlenRecord(4, 4), plainRecord(8, 8)] },
        { name: "empty pack", records: [] },
    ];
    for (const p of packs) {
        const a = scenario();
        const recsA = seedPack(a.rt, p.records);
        const retA = a.rt.cpu.call(0x8001fe38, [PACK]) >>> 0;

        const b = scenario();
        seedPack(b.rt, p.records);
        cardViewHelperUploadPack(b.rt.mem, portHost(b), PACK);

        assert.deepEqual(b.loads, a.loads, `${p.name} LoadImage calls`);
        assert.deepEqual(b.syncs, a.syncs, `${p.name} DrawSync calls`);
        assert.deepEqual(b.allocs, a.allocs, `${p.name} allocs`);
        assert.deepEqual(b.frees, a.frees, `${p.name} frees`);
        assert.deepEqual(helperBytes(b.rt), helperBytes(a.rt), `${p.name} helper bytes`);
        assert.deepEqual(scratchBytes(b.rt, 0x40), scratchBytes(a.rt, 0x40), `${p.name} scratch bytes`);
        assert.equal(a.loads.length, p.records.length, `${p.name} uploaded every record`);
        assert.equal(a.syncs.length, p.records.length, `${p.name} synced every record`);
        assert.equal(a.allocs.length, 1, `${p.name} one scratch allocation`);
        assert.equal(a.frees.length, 1, `${p.name} one free`);
        assert.equal(retA, 0, `${p.name} returns v0 untouched`);
        for (const rec of recsA) assert.ok(rec > PACK, "records live inside the pack");
    }
});

test("resolveRelativeTableEntry matches F0x80014110", () => {
    const a = scenario();
    const recs = [plainRecord(8, 8), plainRecord(4, 4)];
    const addrs = seedPack(a.rt, recs);
    for (const i of [0, 1, 2, 3, 0x10000, -1]) {
        const orig = a.rt.cpu.call(0x80014110, [i, PACK]) >>> 0;
        const port = resolveRelativeTableEntry(a.rt.mem, i, PACK) >>> 0;
        assert.equal(port, orig, `index=${i}`);
        if (i === 0) assert.equal(orig, addrs[0] >>> 0, "first record");
        if (i === 2) assert.equal(orig, PACK >>> 0, "the terminator returns the pack");
    }
});
