// Lane B Phase 4 oracle: engine/dw3/ui/native/album-grid.ts must match the
// original pro/stcrdabm album-grid bodies.
//
//   F0x80083114  albumGridBeginPage
//   F0x80084BC8  albumPageCollectedMask
//   F0x800835BC  albumGridDrawSilhouettes
//
// The original runs through engine/native (the interpreter) as the oracle. The
// draw context is recorded into rt.drawCalls; the +0x28 page method and the
// [0x80044F5C] pack getter are stubs. The resident collection table is poked to
// force both the collected and uncollected branches.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    ALBUM_COLLECTION_BYTE,
    ALBUM_COLLECTION_TABLE,
    albumGridBeginPage,
    albumGridDrawSilhouettes,
    albumPageCollectedMask,
} from "../../engine/dw3/ui/native/album-grid.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const album = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: album.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;
const PACK_STUB = 0x0fd40000;
const PACK_PTR = 0x80190000;
const M28 = 0x0fd60028;

const ARITY = { setLayer: 2, setOrigin: 2, m_0x88: 1, drawSprite: 4 };

const pageCalls = [];

function runtime() {
    const rt = new NativeStageRuntime(album, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PACK_STUB, (c) => (c.reg(4) >>> 0) === 0x06050000 ? PACK_PTR : 0);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(M28, (c) => {
        pageCalls.push(["m28", (c.reg(4) >>> 0) - OBJ_A, c.reg(5) | 0]);
        return 0;
    });
    return rt;
}

function norm(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function clearObj(rt, obj) {
    for (let i = 0; i < 0x120; i += 4) rt.mem.write32(obj + i, 0);
}

function setByte(rt, card, value) {
    rt.mem.write8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE, value);
}

test("albumPageCollectedMask matches F0x80084BC8", () => {
    const rt = runtime();
    const pages = [0, 1, 2, 10, 26];
    for (const page of pages) {
        const first = page * 12 + 1;
        for (let i = 0; i < 12; i++) setByte(rt, first + i, i % 3 === 0 ? 1 : 0);
        clearObj(rt, OBJ_A);
        clearObj(rt, OBJ_B);
        rt.mem.write32(OBJ_A + 0x60, page);
        rt.mem.write32(OBJ_B + 0x60, page);
        rt.cpu.call(0x80084bc8, [OBJ_A]);
        albumPageCollectedMask(rt.mem, OBJ_B);
        for (const off of [0x7c]) {
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0, `page ${page} +0x${off.toString(16)}`);
        }
        for (let i = 0; i < 12; i++) {
            const off = 0x80 + i * 4;
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0, `page ${page} slot ${i}`);
        }
    }
    // At least one tested page produced an all-collected mask, so the collected
    // branch ran.
    assert.equal(rt.mem.read32(OBJ_B + 0x7c) >>> 0, 1, "last page has a collected slot");
});

test("albumGridBeginPage matches F0x80083114", () => {
    const rt = runtime();
    for (const page of [0, 1, 7, 26]) {
        for (const prev of [0, 3, 26]) {
            clearObj(rt, OBJ_A);
            clearObj(rt, OBJ_B);
            for (const obj of [OBJ_A, OBJ_B]) {
                rt.mem.write32(obj + 0x5c, prev);
                rt.mem.write32(obj + 0x60, 0xaaaa);
                rt.mem.write32(obj + 0x68, 0xbbbb);
                rt.mem.write32(obj + 0x70, 0xcccc);
                rt.mem.write32(obj + 0x28, M28);
            }
            pageCalls.length = 0;
            rt.cpu.call(0x80083114, [OBJ_A, page]);
            const oracleCalls = pageCalls.slice();

            const portCalls = [];
            albumGridBeginPage(rt.mem, OBJ_B, page, {
                pageMethod28(o, v) { portCalls.push(["m28", (o >>> 0) - OBJ_B, v | 0]); },
            });
            assert.deepEqual(portCalls, oracleCalls, `page ${page} prev ${prev} call`);
            for (const off of [0x5c, 0x60, 0x68, 0x70]) {
                assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
                    `page ${page} prev ${prev} +0x${off.toString(16)}`);
            }
        }
    }
});

test("albumGridDrawSilhouettes matches F0x800835BC", () => {
    const rt = runtime();
    const cases = [
        { visible: 0, page: 0, depth: 0x100 },
        { visible: 12, page: 0, depth: 0x100 },
        { visible: 7, page: 0, depth: 0x200 },
        { visible: 12, page: 26, depth: 0x123 },
        { visible: 5, page: 1, depth: 0 },
    ];
    for (const c of cases) {
        // Force a mix of collected/uncollected in the resident table.
        for (let i = 0; i < 12; i++) setByte(rt, c.page * 12 + 1 + i, i % 2);
        for (const obj of [OBJ_A, OBJ_B]) {
            clearObj(rt, obj);
            rt.mem.write32(obj + 0x54, 0x1000);
            rt.mem.write32(obj + 0x58, 6);
            rt.mem.write32(obj + 0x5c, c.page);
            rt.mem.write32(obj + 0x68, c.visible);
            rt.mem.write32(obj + 0x70, c.depth);
        }
        const before = rt.drawCalls.length;
        rt.cpu.call(0x800835bc, [OBJ_A]);
        const oracleIntents = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        rt.drawCalls.length = before;

        const portIntents = [];
        albumGridDrawSilhouettes(rt.mem, OBJ_B, {
            initDrawContext() {},
            setLayer(a, b) { portIntents.push(["setLayer", [a, b]]); },
            setOrigin(a, b) { portIntents.push(["setOrigin", [a, b]]); },
            m_0x88(a) { portIntents.push(["m_0x88", [a]]); },
            drawSprite(a, b, x, y) { portIntents.push(["drawSprite", [a, b, x, y]]); },
            packResolve(h) { return (h >>> 0) === 0x06050000 ? PACK_PTR : 0; },
            pageMethod28() {},
        });
        assert.deepEqual(norm(portIntents), oracleIntents,
            `visible ${c.visible} page ${c.page} depth ${c.depth} intents`);
    }
});
