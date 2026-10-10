// Lane B Phase 4 oracle: engine/dw3/ui/native/album-cells-draw.ts must match the
// original pro/stcrdabm F0x80083174 album cell painter.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// stack draw context is recorded into rt.drawCalls. The resident text context
// F0x8001EBF8 is stubbed on both sides so its method calls are recorded in order
// and the card bytes (+0x00/+0x01/+0x02) are derived from the card index.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    ALBUM_DIGIT_BASE,
    albumGridDrawCells,
} from "../../engine/dw3/ui/native/album-cells-draw.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const album = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: album.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x801a0000;
const OBJ_B = 0x801a0400;
const PACK_PTR = 0x801b9000;
const TEXT_CTX = { addrs: [] };
const CUR_CARD = { A: -1, B: -1 };
// The shipped oracle leaves the text context's card bytes at 0 (the resident
// setCard method writes its own module context), so the byte-fed digit tiles are
// the zero-value ones. Nonzero card bytes are a runtime host boundary.
const CARD_BYTES = { name: 0, l1: 0, l2: 0 };

const ARITY = { setLayer: 2, setOrigin: 2, drawSprite: 4 };
const TEXT_METHODS = {
    0x8001e7ec: "textSetCard",
    0x8001e890: "textSetUnk30",
    0x8001e9e0: "textSetPos",
    0x8001e938: "textSetScale",
    0x8001e98c: "textSetOrigin",
    0x8001e9a0: "textSetClip",
    0x8001e9b4: "textCell",
    0x8001e9c8: "textUnk48",
    0x8001e9d4: "textUnk4C",
    0x8001ebcc: "textBadge",
};
const TEXTCALLS = [];
const INTENTS = [];
const PACK_STUB = 0x0fd70000;
const TEXT_CTX_FILL = 0x8001ebf8;

function runtime() {
    const rt = new NativeStageRuntime(album, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PACK_STUB, (c) => ((c.reg(4) >>> 0) === 0x06050000 ? PACK_PTR : 0));
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(TEXT_CTX_FILL, (c) => {
        const ctx = c.reg(4) >>> 0;
        TEXT_CTX.addrs.push(ctx);
        for (let i = 0; i < 0x60; i += 4) rt.mem.write32(ctx + i, 0);
        for (const [addr] of Object.entries(TEXT_METHODS)) rt.mem.write32(ctx + 0x2c + 0 * 4, 0);
        rt.mem.write32(ctx + 0x2c, 0x8001e7ec);
        rt.mem.write32(ctx + 0x30, 0x8001e890);
        rt.mem.write32(ctx + 0x38, 0x8001e938);
        rt.mem.write32(ctx + 0x3c, 0x8001e98c);
        rt.mem.write32(ctx + 0x40, 0x8001e9a0);
        rt.mem.write32(ctx + 0x44, 0x8001e9b4);
        rt.mem.write32(ctx + 0x48, 0x8001e9c8);
        rt.mem.write32(ctx + 0x4c, 0x8001e9d4);
        rt.mem.write32(ctx + 0x34, 0x8001e9e0);
        rt.mem.write32(ctx + 0x50, 0x8001ebcc);
        return 0;
    });
    for (const [addr, name] of Object.entries(TEXT_METHODS)) {
        rt.cpu.setStub(Number(addr), (c) => {
            TEXTCALLS.push([name, c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
            if (name === "textSetCard") {
                for (const ctx of TEXT_CTX.addrs) {
                    rt.mem.write8(ctx + 0, CARD_BYTES.name);
                    rt.mem.write8(ctx + 1, CARD_BYTES.l1);
                    rt.mem.write8(ctx + 2, CARD_BYTES.l2);
                }
            }
            if (name === "textBadge") return 0;
            return 0;
        });
    }
    return rt;
}

function portHost() {
    return {
        initDrawContext() {},
        setLayer(a, b) { INTENTS.push(["setLayer", [a, b]]); },
        setOrigin(a, b) { INTENTS.push(["setOrigin", [a, b]]); },
        drawSprite(a, b, x, y) { INTENTS.push(["drawSprite", [a, b, x, y]]); },
        packResolve(h) { return (h >>> 0) === 0x06050000 ? PACK_PTR : 0; },
        initTextContext() {},
        textSetCard(card) { TEXTCALLS.push(["textSetCard", card | 0, 0, 0]); },
        textSetPos(x, y) { TEXTCALLS.push(["textSetPos", x | 0, y | 0, 0]); },
        textSetScale(sx, sy) { TEXTCALLS.push(["textSetScale", sx | 0, sy | 0, 0]); },
        textSetOrigin(x, y) { TEXTCALLS.push(["textSetOrigin", x | 0, y | 0, 0]); },
        textSetClip(x, y) { TEXTCALLS.push(["textSetClip", x | 0, y | 0, 0]); },
        textCell(col, row) { TEXTCALLS.push(["textCell", col | 0, row | 0, 0]); },
        textBadge() { TEXTCALLS.push(["textBadge", 0, 0, 0]); return 0; },
        textNameByte() { return CARD_BYTES.name; },
        textLevel1() { return CARD_BYTES.l1; },
        textLevel2() { return CARD_BYTES.l2; },
    };
}

function norm(list) {
    return list.map(([m, a]) => [m, (a ?? []).slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function clearObj(rt, obj) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(obj + i, 0);
}

function setCollected(rt, card, on) {
    // 0x80048D34 + 0x4DF + card
    const addr = 0x80048d34 + 0x4df + card;
    rt.mem.write8(addr, on ? 1 : 0);
}

test("album digit tiles split tens/units with a separator", () => {
    // The shipped oracle leaves the card bytes at 0, so this checks the port's
    // digit arithmetic directly. 0x25 -> tens tile 0x21 (3), unit tile 0x25 (7).
    const rt = runtime();
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(OBJ_B + i, 0);
    rt.mem.write32(OBJ_B + 0x54, 0x1000);
    rt.mem.write32(OBJ_B + 0x58, 7);
    rt.mem.write32(OBJ_B + 0x5c, 1);
    rt.mem.write32(OBJ_B + 0x64, 1);
    setCollected(rt, 1, 1);
    const seen = [];
    albumGridDrawCells(rt.mem, OBJ_B, 0, {
        initDrawContext() {}, setLayer() {}, setOrigin() {},
        drawSprite(a, b, x, y) { seen.push([b, x, y]); },
        packResolve() { return PACK_PTR; },
        initTextContext() {}, textSetCard() {}, textSetPos() {}, textSetScale() {},
        textSetOrigin() {}, textSetClip() {}, textCell() {},
        textBadge() { return 0; }, textNameByte() { return 0x30; },
        textLevel1() { return 0x25; }, textLevel2() { return 0x14; },
    });
    const tiles = seen.map(([id, x]) => [id, x]);
    assert.ok(tiles.some(([id]) => id === 3 + ALBUM_DIGIT_BASE), "tens tile");
    assert.ok(tiles.some(([id]) => id === 7 + ALBUM_DIGIT_BASE), "units tile");
    assert.ok(tiles.some(([id]) => id === 0x1c), "separator tile");
    assert.ok(tiles.some(([id]) => id === 2 + ALBUM_DIGIT_BASE), "second level tens (0x14 -> 2)");
    assert.ok(tiles.some(([id]) => id === 0 + ALBUM_DIGIT_BASE), "second level units (0x14 -> 0)");
});

test("albumGridDrawCells matches F0x80083174", () => {
    const rt = runtime();
    const cases = [
        { name: "empty page", count: 0 },
        { name: "one empty cell", count: 1, page: 0, collected: [] },
        { name: "one collected cell", count: 1, page: 0, collected: [1] },
        { name: "six cells mixed", count: 6, page: 0, collected: [1, 3, 5] },
        { name: "twelve cells", count: 12, page: 0, collected: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
        { name: "second page", count: 12, page: 1, collected: [13, 20, 24] },
        { name: "out of range breaks", count: 6, page: 0, base: 0x13a, collected: [0x13a] },
    ];
    for (const c of cases) {
        for (let card = 1; card <= 0x13c; card++) setCollected(rt, card, 0);
        for (const card of c.collected ?? []) setCollected(rt, card, 1);
        for (const obj of [OBJ_A, OBJ_B]) {
            clearObj(rt, obj);
            rt.mem.write32(obj + 0x54, 0x1000);
            rt.mem.write32(obj + 0x58, 7);
            rt.mem.write32(obj + 0x5c, c.base ?? 1);
            rt.mem.write32(obj + 0x60, 1);
            rt.mem.write32(obj + 0x64, c.count);
        }

        const before = rt.drawCalls.length;
        TEXTCALLS.length = 0;
        TEXT_CTX.addrs.length = 0;
        rt.cpu.call(0x80083174, [OBJ_A, c.page ?? 0], 40000);
        const oracleDraw = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        const oracleText = TEXTCALLS.slice();
        rt.drawCalls.length = before;

        INTENTS.length = 0;
        TEXTCALLS.length = 0;
        albumGridDrawCells(rt.mem, OBJ_B, c.page ?? 0, portHost());
        assert.deepEqual(norm(INTENTS), oracleDraw, `${c.name}: draw intents`);
        assert.deepEqual(
            TEXTCALLS.map((x) => [x[0], x[1]]).filter((x) => x[0] !== "textBadge" && x[0] !== "textSetCard"),
            oracleText.map((x) => [x[0], x[1]]).filter((x) => x[0] !== "textBadge" && x[0] !== "textSetCard"),
            `${c.name}: text method order`,
        );
    }
});
