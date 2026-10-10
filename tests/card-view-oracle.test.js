// Phase 4 oracle: engine/dw3/ui/card-view.ts must reproduce the card-view class
// (F0x8001EBF8 + its executed slots) and the TIM upload helper (F0x8001FFA8 +
// F0x8001FD1C/FD28/FD3C/FD50).
//
// Every device boundary is hooked on BOTH sides at the same point: the resource
// service (the shipped [0x80044F4C] pointer), libgpu LoadImage (0x80025B14) and
// the registered view's +0x138 method. The class context and the helper's
// 0x34-byte scratch are compared byte for byte after each call.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    CARD_FILE_TABLE,
    CARD_HELPER_CELL,
    CARD_RECORD_STRIDE,
    CARD_VIEW_METHODS,
    CARD_VIEW_SIZE,
    commitCardView,
    cardViewHelperPublish,
    cardViewHelperSetPairA,
    cardViewHelperSetPairB,
    cardViewHelperSetScratchSize,
    cardViewHelperUpload,
    constructCardView,
    currentViewTableWord,
    dispatchCurrentDisplayView,
    resolveCardRecord,
    setCurrentObject4_8,
    setCurrentObjectC_10,
    setCurrentViewSize_14_18,
} from "../engine/dw3/ui/card-view.ts";
import { CURRENT_VIEW_CELL } from "../engine/dw3/globals.ts";
import { findRegisteredHandleByKey } from "../engine/dw3/display-service.ts";
import { DISPLAY_SERVICE } from "../engine/dw3/display-service.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const RESOURCE_PTR = 0x80044f4c;
const LOAD_IMAGE = 0x80025b14;
const RESOURCE_STUB = 0x80019070;
const VIEW_METHOD = 0x80019080;
const GP = 0x8005cb50;

const CTX = 0x80192000;
const HELPER = 0x80192100;
const SP0 = HELPER + 0x40; // commitCurrentView's helper lives at sp - 0x40
const VIEW = 0x80192200;
const RECORD = 0x80193000;
const VIEW_KEY = 0x00000123;
const VIEW_RESULT = 0x00004242;

function scenario() {
    const loadCalls = [];
    const viewCalls = [];
    const baseFor = (discId) => (0x80100000 + (discId & 0xff) * 0x100000) >>> 0;
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = GP;
    rt.cpu.sp = SP0;
    // The screen runtime host-serves 0x8001FFA8 as a synthetic sound-object
    // constructor and 0x8001DA84 as a synthetic layer registry. Both are the
    // card-view helper and the view lookup in the shipped image, so drop the
    // host hooks here: the oracle must compare against the real bodies.
    rt.cpu.clearStub(0x8001ffa8);
    rt.cpu.clearStub(0x8001da84);
    rt.cpu.setStub(RESOURCE_STUB, (c) => baseFor(c.reg(4) | 0));
    rt.cpu.setStub(LOAD_IMAGE, (c) => {
        const r = c.reg(4) >>> 0;
        loadCalls.push([
            rt.mem.read16(r) | 0, rt.mem.read16(r + 2) | 0,
            rt.mem.read16(r + 4) | 0, rt.mem.read16(r + 6) | 0,
            c.reg(5) >>> 0,
        ]);
        return 0;
    });
    rt.cpu.setStub(VIEW_METHOD, (c) => { viewCalls.push([c.reg(5) | 0]); return VIEW_RESULT; });
    rt.mem.write32(RESOURCE_PTR, RESOURCE_STUB);
    // one registered view: slot 0, handle VIEW_KEY, method +0x138
    rt.mem.write32(DISPLAY_SERVICE + 0x60, VIEW);
    rt.mem.write32(DISPLAY_SERVICE + 0xd8, VIEW_KEY);
    rt.mem.write32(VIEW + 0x138, VIEW_METHOD);
    // every class context starts zeroed; the constructor zeroes it anyway
    for (let i = 0; i < CARD_VIEW_SIZE; i += 4) rt.mem.write32(CTX + i, 0xdeadbeef);
    rt.mem.write32(CURRENT_VIEW_CELL, 0);
    rt.mem.write32(CARD_HELPER_CELL, 0);
    return { rt, loadCalls, viewCalls, baseFor };
}

function ctxBytes(rt) {
    const out = [];
    for (let i = 0; i < CARD_VIEW_SIZE; i += 4) out.push(rt.mem.read32(CTX + i) >>> 0);
    return out;
}

function helperBytes(rt) {
    const out = [];
    for (let i = 0; i < 0x34; i += 4) out.push(rt.mem.read32(HELPER + i) >>> 0);
    return out;
}

function portHost(scenarioRef) {
    return {
        resourceGetBase: (discId) => scenarioRef.baseFor(discId),
        loadImage: (x, y, w, h, data) => scenarioRef.loadCalls.push([x | 0, y | 0, w | 0, h | 0, data >>> 0]),
        findRegisteredHandleByKey: (key) => {
            for (let i = 0; i < 0x1e; i++) {
                const slot = DISPLAY_SERVICE + i * 4;
                if ((scenarioRef.rt.mem.read32(slot + 0x60) | 0) !== 0 &&
                    (scenarioRef.rt.mem.read32(slot + 0xd8) | 0) === (key | 0)) {
                    return scenarioRef.rt.mem.read32(slot + 0x60) | 0;
                }
            }
            return 0;
        },
        callViewMethod: (view, arg) => {
            scenarioRef.viewCalls.push([arg | 0]);
            return VIEW_RESULT;
        },
    };
}

test("constructCardView matches F0x8001EBF8", () => {
    const a = scenario();
    a.rt.cpu.call(0x8001ebf8, [CTX]);
    const bytesA = ctxBytes(a.rt);
    assert.equal(a.rt.mem.read32(CURRENT_VIEW_CELL) >>> 0, CTX, "original published the context");
    assert.equal(a.rt.mem.read32(CTX + 0x1c) | 0, 8, "original pitch");

    const b = scenario();
    constructCardView(b.rt.mem, CTX);
    assert.deepEqual(ctxBytes(b.rt), bytesA, "context bytes");
    assert.equal(b.rt.mem.read32(CURRENT_VIEW_CELL) >>> 0, CTX, "port published the context");
    for (const [off, addr] of CARD_VIEW_METHODS) {
        assert.equal(b.rt.mem.read32(CTX + off) >>> 0, addr >>> 0, `slot +0x${off.toString(16)}`);
    }
    // the two unported slots are still installed as the original addresses
    assert.equal(b.rt.mem.read32(CTX + 0x34) >>> 0, 0x8001e9e0, "queue slot");
    assert.equal(b.rt.mem.read32(CTX + 0x48) >>> 0, 0x8001e9c8, "pitch slot");
});

test("resolveCardRecord matches F0x8001E7EC for every file/slot edge", () => {
    for (const id of [0, 1, 2, 63, 64, 65, 315, 316, 317, -1, -64]) {
        const a = scenario();
        constructCardView(a.rt.mem, CTX);
        a.rt.cpu.call(0x8001ebf8, [CTX]);
        a.rt.cpu.call(0x8001e7ec, [id]);

        const b = scenario();
        constructCardView(b.rt.mem, CTX);
        constructCardView(b.rt.mem, CTX);
        b.rt.mem.write32(CURRENT_VIEW_CELL, CTX);
        resolveCardRecord(b.rt.mem, portHost(b), id);

        assert.equal(b.rt.mem.read32(CTX) >>> 0, a.rt.mem.read32(CTX) >>> 0, `id=${id} record pointer`);
        // the pointer is what the selector promises: base + slot*0x62C
        if (id > 0) {
            const n = (id - 1) | 0;
            const discId = a.rt.mem.read32(CARD_FILE_TABLE + (n >> 6) * 4) | 0;
            assert.equal(
                (a.rt.mem.read32(CTX) - a.baseFor(discId)) >>> 0,
                ((n & 0x3f) * CARD_RECORD_STRIDE) >>> 0,
                `id=${id} offset`,
            );
        }
    }
});

test("the three setters match F0x8001E98C / F0x8001E9A0 / F0x8001E9B4", () => {
    const a = scenario();
    a.rt.cpu.call(0x8001ebf8, [CTX]);
    a.rt.cpu.call(0x8001e98c, [0x11, 0x22]);
    a.rt.cpu.call(0x8001e9a0, [0x33, 0x44]);
    a.rt.cpu.call(0x8001e9b4, [0x55, 0x66]);

    const b = scenario();
    constructCardView(b.rt.mem, CTX);
    b.rt.mem.write32(CURRENT_VIEW_CELL, CTX);
    setCurrentObject4_8(b.rt.mem, 0x11, 0x22);
    setCurrentObjectC_10(b.rt.mem, 0x33, 0x44);
    setCurrentViewSize_14_18(b.rt.mem, 0x55, 0x66);

    assert.deepEqual(ctxBytes(b.rt), ctxBytes(a.rt), "context bytes");
});

test("commitCardView matches F0x8001E890 (both TIM shapes)", () => {
    const tims = [
        { name: "two blocks", flags: 0x9, block1: { len: 0x20, w: 8, h: 8 }, block2: { w: 16, h: 16 } },
        { name: "single block", flags: 0x0, block2: { w: 32, h: 32 } },
        { name: "flags bit3, bpp 2 -> one transfer", flags: 0xa, block1: { len: 0x30, w: 4, h: 4 }, block2: { w: 24, h: 24 } },
    ];
    for (const tc of tims) {
        // original
        const a = scenario();
        a.rt.cpu.call(0x8001ebf8, [CTX]);
        a.rt.cpu.call(0x8001e7ec, [7]);
        // stage the two destination pairs and the 3,2 cell (distinct values, so
        // a swapped or dropped term in the commit arithmetic is observable)
        a.rt.mem.write32(CTX + 0x4, 0x30);
        a.rt.mem.write32(CTX + 0x8, 0x40);
        a.rt.mem.write32(CTX + 0xc, 0x50);
        a.rt.mem.write32(CTX + 0x10, 0x60);
        a.rt.mem.write32(CTX + 0x14, 3);
        a.rt.mem.write32(CTX + 0x18, 2);
        a.rt.mem.write32(CTX + 0x1c, 8);
        const recordA = a.rt.mem.read32(CTX) >>> 0;
        const timA = (recordA + 0xc) >>> 0;
        a.rt.mem.write32(timA + 4, tc.flags);
        const block1A = (timA + 8) >>> 0;
        if (tc.block1) {
            a.rt.mem.write32(block1A, tc.block1.len);
            a.rt.mem.write16(block1A + 8, tc.block1.w);
            a.rt.mem.write16(block1A + 0xa, tc.block1.h);
        }
        const block2A = (tc.block1 ? block1A + tc.block1.len : block1A) >>> 0;
        a.rt.mem.write16(block2A + 8, tc.block2.w);
        a.rt.mem.write16(block2A + 0xa, tc.block2.h);
        a.rt.cpu.sp = SP0;
        a.rt.cpu.call(0x8001e890, []);

        // port
        const b = scenario();
        constructCardView(b.rt.mem, CTX);
        resolveCardRecord(b.rt.mem, portHost(b), 7);
        b.rt.mem.write32(CTX + 0x4, 0x30);
        b.rt.mem.write32(CTX + 0x8, 0x40);
        b.rt.mem.write32(CTX + 0xc, 0x50);
        b.rt.mem.write32(CTX + 0x10, 0x60);
        b.rt.mem.write32(CTX + 0x14, 3);
        b.rt.mem.write32(CTX + 0x18, 2);
        b.rt.mem.write32(CTX + 0x1c, 8);
        const recordB = b.rt.mem.read32(CTX) >>> 0;
        const timB = (recordB + 0xc) >>> 0;
        b.rt.mem.write32(timB + 4, tc.flags);
        const block1B = (timB + 8) >>> 0;
        if (tc.block1) {
            b.rt.mem.write32(block1B, tc.block1.len);
            b.rt.mem.write16(block1B + 8, tc.block1.w);
            b.rt.mem.write16(block1B + 0xa, tc.block1.h);
        }
        const block2B = (tc.block1 ? block1B + tc.block1.len : block1B) >>> 0;
        b.rt.mem.write16(block2B + 8, tc.block2.w);
        b.rt.mem.write16(block2B + 0xa, tc.block2.h);
        commitCardView(b.rt.mem, portHost(b), HELPER);

        assert.deepEqual(b.loadCalls, a.loadCalls, `${tc.name} LoadImage calls`);
        assert.deepEqual(helperBytes(b.rt), helperBytes(a.rt), `${tc.name} helper bytes`);
        assert.equal(b.rt.mem.read32(CARD_HELPER_CELL) >>> 0, a.rt.mem.read32(CARD_HELPER_CELL) >>> 0,
            `${tc.name} helper singleton`);
        assert.deepEqual(ctxBytes(b.rt), ctxBytes(a.rt), `${tc.name} context bytes`);
        assert.ok(a.loadCalls.length >= 1, `${tc.name} transferred something`);
    }
});

test("dispatchCurrentDisplayView matches F0x8001E938", () => {
    const a = scenario();
    a.rt.cpu.call(0x8001ebf8, [CTX]);
    const retA = a.rt.cpu.call(0x8001e938, [VIEW_KEY, 0x7788]) | 0;

    const b = scenario();
    constructCardView(b.rt.mem, CTX);
    b.rt.mem.write32(CURRENT_VIEW_CELL, CTX);
    const retB = dispatchCurrentDisplayView(b.rt.mem, portHost(b), VIEW_KEY, 0x7788) | 0;

    assert.equal(retB, retA, "return value");
    assert.deepEqual(b.viewCalls, a.viewCalls, "method calls");
    assert.equal(b.rt.mem.read32(CTX + 0x24) >>> 0, a.rt.mem.read32(CTX + 0x24) >>> 0, "view field");
    assert.equal(b.rt.mem.read32(CTX + 0x28) >>> 0, a.rt.mem.read32(CTX + 0x28) >>> 0, "result field");

    // a miss (no registered handle) leaves both fields at whatever the method
    // path produces; the original returns 0 and caches 0
    const c = scenario();
    c.rt.cpu.call(0x8001ebf8, [CTX]);
    c.rt.mem.write32(DISPLAY_SERVICE + 0x60, 0);
    const retC = c.rt.cpu.call(0x8001e938, [0x999, 1]) | 0;
    assert.equal(retC, 0, "original miss returns 0");
});

test("currentViewTableWord matches F0x8001EBCC", () => {
    for (const kind of [0, 1, 5, 0x14]) {
        const a = scenario();
        a.rt.cpu.call(0x8001ebf8, [CTX]);
        const recA = 0x80194000;
        a.rt.mem.write32(CTX, recA);
        a.rt.mem.write8(recA + 0x3, kind);
        a.rt.mem.write32(0x8004dfcc + kind * 4, 0xabcd0000 | kind);
        const expected = a.rt.cpu.call(0x8001ebcc, []) | 0;

        const b = scenario();
        constructCardView(b.rt.mem, CTX);
        const recB = 0x80194000;
        b.rt.mem.write32(CTX, recB);
        b.rt.mem.write8(recB + 0x3, kind);
        b.rt.mem.write32(0x8004dfcc + kind * 4, 0xabcd0000 | kind);
        assert.equal(currentViewTableWord(b.rt.mem) | 0, expected, `kind=${kind}`);
        assert.notEqual(expected, 0, `kind=${kind} table word is not vacuous`);
    }
});

test("the helper slots match F0x8001FD1C / FD28 / FD3C / FF9C one by one", () => {
    // Each slot reads the helper singleton, so seed it to HELPER on both sides.
    const slots = [
        { name: "FD1C publish", addr: 0x8001fd1c, args: [CTX + 0x40], port: (mem, h) => cardViewHelperPublish(mem, CTX + 0x40) },
        { name: "FD28 pair A", addr: 0x8001fd28, args: [0x1234, 0x5678], port: (mem, h) => cardViewHelperSetPairA(mem, 0x1234, 0x5678) },
        { name: "FD3C pair B", addr: 0x8001fd3c, args: [-0x10, 0x2468], port: (mem, h) => cardViewHelperSetPairB(mem, -0x10, 0x2468) },
        { name: "FF9C scratch size", addr: 0x8001ff9c, args: [0x9000], port: (mem, h) => cardViewHelperSetScratchSize(mem, 0x9000) },
    ];
    for (const s of slots) {
        const a = scenario();
        a.rt.mem.write32(CARD_HELPER_CELL, HELPER);
        const retA = a.rt.cpu.call(s.addr, s.args) >>> 0;
        const bytesA = helperBytes(a.rt);

        const b = scenario();
        b.rt.mem.write32(CARD_HELPER_CELL, HELPER);
        s.port(b.rt.mem, null);
        assert.deepEqual(helperBytes(b.rt), bytesA, `${s.name} helper bytes`);
        assert.equal(b.rt.mem.read32(CARD_HELPER_CELL) >>> 0, a.rt.mem.read32(CARD_HELPER_CELL) >>> 0, `${s.name} singleton`);
        if (s.addr === 0x8001fd1c) assert.equal(retA, 0, "publish returns v0 untouched");
    }
});

test("the TIM upload F0x8001FD50 matches for every flag shape", () => {
    const shapes = [
        { flags: 0x0, blocks: [{ w: 16, h: 16 }] },
        { flags: 0x8, blocks: [{ len: 0x20, w: 8, h: 8 }, { w: 32, h: 16 }] },
        { flags: 0x9, blocks: [{ len: 0x20, w: 8, h: 8 }, { w: 32, h: 16 }] },
        { flags: 0xa, blocks: [{ len: 0x30, w: 4, h: 4 }, { w: 24, h: 24 }] },
        { flags: 0xf, blocks: [{ len: 0x40, w: 2, h: 2 }, { w: 64, h: 32 }] },
    ];
    for (const sh of shapes) {
        const tim = 0x80195000;
        const seedTim = (mem) => {
            mem.write32(tim + 4, sh.flags);
            let at = tim + 8;
            for (let i = 0; i < sh.blocks.length; i++) {
                const b = sh.blocks[i];
                if (b.len !== undefined) mem.write32(at, b.len);
                mem.write16(at + 8, b.w);
                mem.write16(at + 0xa, b.h);
                for (let k = 0; k < 0x20; k++) mem.write8(at + 0xc + k, (0x40 + k) & 0xff);
                if (b.len !== undefined) at += b.len;
            }
        };

        const a = scenario();
        a.rt.cpu.sp = 0x801ff000; // the original's frame must not overlap HELPER
        a.rt.mem.write32(CARD_HELPER_CELL, HELPER);
        a.rt.mem.write32(HELPER + 0x8, 0x30);
        a.rt.mem.write32(HELPER + 0xC, 0x40);
        a.rt.mem.write32(HELPER + 0x10, 0x50);
        a.rt.mem.write32(HELPER + 0x14, 0x60);
        seedTim(a.rt.mem);
        a.rt.cpu.call(0x8001fd50, [tim]);

        const b = scenario();
        b.rt.mem.write32(CARD_HELPER_CELL, HELPER);
        b.rt.mem.write32(HELPER + 0x8, 0x30);
        b.rt.mem.write32(HELPER + 0xC, 0x40);
        b.rt.mem.write32(HELPER + 0x10, 0x50);
        b.rt.mem.write32(HELPER + 0x14, 0x60);
        seedTim(b.rt.mem);
        cardViewHelperUpload(b.rt.mem, portHost(b), tim);

        assert.deepEqual(b.loadCalls, a.loadCalls, `flags=0x${sh.flags.toString(16)} LoadImage calls`);
        assert.deepEqual(helperBytes(b.rt), helperBytes(a.rt), `flags=0x${sh.flags.toString(16)} helper bytes`);
        assert.ok(a.loadCalls.length >= 1 && a.loadCalls.length <= 2, `flags=0x${sh.flags.toString(16)} 1..2 transfers`);
    }
});

test("findRegisteredHandleByKey matches F0x8001DA84", () => {
    const cases = [
        { key: 0, slots: [], expect: 0 },
        { key: 0x123, slots: [[0, 0x123, VIEW]], expect: VIEW },
        { key: 0x55, slots: [[3, 0x55, 0x80196000], [7, 0x99, 0x80196100]], expect: 0x80196000 },
        { key: 0x99, slots: [[7, 0x99, 0x80196100]], expect: 0x80196100 },
        { key: 0x77, slots: [[1, 0x11, 0x80196200]], expect: 0 },
        { key: -1, slots: [[2, -1, 0x80196300]], expect: 0x80196300 },
    ];
    for (const tc of cases) {
        const seed = (rt) => {
            for (const [slot, handle, obj] of tc.slots) {
                rt.mem.write32(DISPLAY_SERVICE + slot * 4 + 0x60, obj);
                rt.mem.write32(DISPLAY_SERVICE + slot * 4 + 0xd8, handle);
            }
        };
        const a = scenario();
        seed(a.rt);
        const retA = a.rt.cpu.call(0x8001da84, [tc.key]) >>> 0;
        const b = scenario();
        seed(b.rt);
        const retB = findRegisteredHandleByKey(b.rt.mem, tc.key) >>> 0;
        assert.equal(retB, retA, `key=0x${(tc.key >>> 0).toString(16)}`);
        assert.equal(retA, tc.expect >>> 0, `key=0x${(tc.key >>> 0).toString(16)} expected result`);
    }
});
