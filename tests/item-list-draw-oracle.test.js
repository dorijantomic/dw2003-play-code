// Phase 4 oracle: engine/dw3/ui/item-list-draw.ts itemListDraw must emit the
// same ordered draw intents as the original F0x80087920. The original runs
// through engine/native's draw-intent recorder; the port through an equivalent
// recorder callback. packGetEntry, f6 and the frame tick are shared stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { PACK_CMFONT, PACK_STSHOP, itemListDraw } from "../engine/dw3/ui/item-list-draw.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80180000;
const OBJ_B = 0x80181000;
const INV = 0x80182000;
const PACK_STUB = 0x0fd20000;
const F6_STUB = 0x0fd20010;
const PACK_PTR = new Map([[PACK_CMFONT, 0x80190000], [PACK_STSHOP, 0x80190010]]);
const FRAME = 1000;
const ARITY = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };

const packResolve = (h) => PACK_PTR.get(h >>> 0) ?? 0;
const iconClip = (id) => 0x100 + (id & 0xff);

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => packResolve(c.reg(4) >>> 0));
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(F6_STUB, (c) => iconClip(c.reg(4) | 0));
    rt.mem.write32(0x80042b9c, F6_STUB);
    rt.mem.write32(0x8004de20, FRAME);
    return rt;
}

function fixture(obj, opts) {
    for (let i = 0; i < 0x720; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write32(obj + 0x54, 0x1000);
    rt.mem.write32(obj + 0x58, 4);
    rt.mem.write32(obj + 0x5c, opts.mode);
    rt.mem.write32(obj + 0x6b4, INV);
    rt.mem.write32(obj + 0x6c0, opts.count);
    rt.mem.write32(obj + 0x6c4, opts.page);
    rt.mem.write32(obj + 0x6c8, opts.pageCount);
    rt.mem.write32(obj + 0x6cc, opts.k ?? 0);
    rt.mem.write32(obj + 0x6d0, opts.lastFrame ?? 0);
    rt.mem.write32(obj + 0x6d4, opts.pageSize);
    rt.mem.write32(obj + 0x6e0, opts.fold);
    for (let i = 0; i < 16; i++) {
        rt.mem.write16(INV + i * 2, opts.ids[i] ?? 0);
        rt.mem.write16(obj + 0x64 + i * 2, opts.ids[i] ?? 0);
    }
}

function norm(list) {
    // The interpreter's stub records registers as signed; normalise to u32.
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

const rt = runtime();

function runCase(label, opts) {
    fixture(OBJ_A, opts);
    fixture(OBJ_B, opts);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80087920, [OBJ_A]);
    const oracle = norm(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before; // drop this case's entries

    const portIntents = [];
    const hostPort = {
        initDrawContext() {},
        setLayer(t, b) { portIntents.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { portIntents.push(["setOrigin", [x, y, 0, 0]]); },
        setScale(x, y, z) { portIntents.push(["setScale", [x, y, z, 0]]); },
        setPos(x, y) { portIntents.push(["setPos", [x, y, 0, 0]]); },
        paletteShift(v) { portIntents.push(["m_0x88", [v, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { portIntents.push(["drawSprite", [p, c, x, y]]); },
        packResolve,
        iconClip,
        frameTick: () => FRAME,
    };
    itemListDraw(rt.mem, OBJ_B, hostPort);

    assert.deepEqual(norm(portIntents), oracle, label);
    // The plain counters the routine owns must match too.
    for (const off of [0x6cc, 0x6d0]) {
        assert.equal(rt.mem.read32(OBJ_B + off) | 0, rt.mem.read32(OBJ_A + off) | 0, `${label} +0x${off.toString(16)}`);
    }
}

test("itemListDraw matches F0x80087920 across fold, page and tab states", () => {
    const ids8 = [11, 12, 13, 14, 15, 16, 17, 18];
    // fold 0: only setLayer + setOrigin.
    runCase("fold 0", { mode: 0, fold: 0, pageSize: 8, count: 8, page: 0, pageCount: 1, ids: ids8 });
    // fold in flight: scale/pos + window.
    runCase("fold partial", { mode: 0, fold: 0x800, pageSize: 8, count: 8, page: 0, pageCount: 1, ids: ids8 });
    // open, one page, 8 cells.
    runCase("open page 0", { mode: 0, fold: 0x1000, pageSize: 8, count: 8, page: 0, pageCount: 1, ids: ids8 });
    // open, count shorter than the page: the loop breaks.
    runCase("open short", { mode: 0, fold: 0x1000, pageSize: 8, count: 3, page: 0, pageCount: 1, ids: ids8 });
    // open, a zero id breaks the loop.
    runCase("open zero id", { mode: 0, fold: 0x1000, pageSize: 8, count: 8, page: 0, pageCount: 1, ids: [11, 12, 0, 14] });
    // SELL mode page 1 of 2 with a passing blink gate.
    runCase("sell page 1 tabs", { mode: 1, fold: 0x1000, pageSize: 14, count: 20, page: 1, pageCount: 2,
        k: 1, lastFrame: FRAME - 0xb, ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] });
    // Same, but the blink gate has not elapsed.
    runCase("sell page 1 gate closed", { mode: 1, fold: 0x1000, pageSize: 14, count: 20, page: 1, pageCount: 2,
        k: 3, lastFrame: FRAME, ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] });
});
