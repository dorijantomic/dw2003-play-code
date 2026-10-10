// Lane B oracle: engine/dw3/ui/native/album-leaves.ts's three bodies must match
// the original pro/stcrdabm bodies.
//
//   F0x80084BC8  albumPageMask
//   F0x800840AC  albumCellPaint
//   F0x80083008  albumMakePopup
//
// The originals run through engine/native (the interpreter) as the oracle on
// the shipped pro_stcrdabm.bin + resident.bin. The resident text context
// (F0x8001EBF8), its card/badge fields, the shared resource getter
// (0x80044F4C), the ten text widgets' four methods and the object factory
// (F0x80014504) are stubs on both sides, so the ordered call stream and the
// object writes are what is compared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    ALBUM_CELL_SLOTS, ALBUM_COUNT_OFF, ALBUM_POPUP_FIELDS, ALBUM_POPUP_METHOD64,
    albumCellPaint, albumMakePopup, albumPageMask,
} from "../engine/dw3/ui/native/album-leaves.ts";
import { ALBUM_CARD_MAX, ALBUM_COLLECTION_BYTE, ALBUM_COLLECTION_TABLE } from "../engine/dw3/ui/native/album-grid.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const PAGE_MASK = 0x80084bc8;
const CELL_PAINT = 0x800840ac;
const MAKE_POPUP = 0x80083008;
const TEXT_CTX_FILL = 0x8001ebf8;
const FACTORY = 0x80014504;

const OBJ = 0x80160000;
const CTX = 0x80161000;
const WIDGET_BASE = 0x80162000;
const WIDGET_STRIDE = 0x180;
const TEXT_CTX = 0x80164000;
const SAVE_PTR = 0x80165000;
const POPUP_OBJ = 0x80166000;

const RES_STUB = 0x0fe04000;
const RES_RETURN = 0x12345678;
const T_CARD = 0x0fe04010;
const T_BADGE = 0x0fe04014;
const M_LINE = 0x0fe04020;
const M_NUM = 0x0fe04024;
const M_F0 = 0x0fe04028;
const M_F1 = 0x0fe0402c;

const SLOTS = [0x1c, 0x20, 0x24, 0x28, 0x2c, 0x30, 0x34, 0x38, 0x3c, 0x40];
const SLOT_OF = new Map(SLOTS.map((slot, i) => [WIDGET_BASE + i * WIDGET_STRIDE, slot]));

let EVENTS = [];
let BADGE = 0;

const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
    image: resident,
    base: 0x80010000,
});

rt.cpu.setStub(TEXT_CTX_FILL, (c) => {
    const ctx = c.reg(4) >>> 0;
    EVENTS.push(["init"]);
    rt.mem.write32(ctx + 0x2c, T_CARD);
    rt.mem.write32(ctx + 0x50, T_BADGE);
    return 0;
});
rt.cpu.setStub(T_CARD, (c) => { EVENTS.push(["card", c.reg(4) | 0]); return 0; });
rt.cpu.setStub(T_BADGE, () => { EVENTS.push(["badge"]); return BADGE; });
rt.cpu.setStub(RES_STUB, (c) => { EVENTS.push(["res", c.reg(4) | 0]); return RES_RETURN; });
rt.cpu.setStub(M_LINE, (c) => { EVENTS.push(["line", SLOT_OF.get(c.reg(4) >>> 0), c.reg(5) | 0, c.reg(6) | 0]); return 0; });
rt.cpu.setStub(M_NUM, (c) => { EVENTS.push(["num", SLOT_OF.get(c.reg(4) >>> 0), c.reg(5) | 0, c.reg(6) | 0]); return 0; });
rt.cpu.setStub(M_F0, (c) => { EVENTS.push(["f0", SLOT_OF.get(c.reg(4) >>> 0), c.reg(5) | 0]); return 0; });
rt.cpu.setStub(M_F1, (c) => { EVENTS.push(["f1", SLOT_OF.get(c.reg(4) >>> 0), c.reg(5) | 0]); return 0; });
rt.cpu.setStub(FACTORY, () => POPUP_OBJ);
rt.mem.write32(0x80044f4c, RES_STUB); // [0x80044B38]+0x414 === 0x80044F4C, the shared getter cell
rt.mem.write32(0x8005cca8, SAVE_PTR);

// The widget table cellPaint walks, and each widget's four methods.
for (let i = 0; i < SLOTS.length; i++) {
    const widget = WIDGET_BASE + i * WIDGET_STRIDE;
    rt.mem.write32(CTX + SLOTS[i], widget);
    rt.mem.write32(widget + 0x114, M_LINE);
    rt.mem.write32(widget + 0x118, M_NUM);
    rt.mem.write32(widget + 0x144, M_F0);
    rt.mem.write32(widget + 0x148, M_F1);
}

const portHost = (badge) => ({
    initTextContext() { EVENTS.push(["init"]); },
    textSetCard(card) { EVENTS.push(["card", card | 0]); },
    textBadge() { EVENTS.push(["badge"]); return badge; },
    textByte1: () => 0,
    textByte2: () => 0,
    textByte5: () => 0,
    resourceGet(id) { EVENTS.push(["res", id | 0]); return RES_RETURN; },
    setWidgetLine(widget, source, index) { EVENTS.push(["line", SLOT_OF.get(widget >>> 0), source | 0, index | 0]); },
    setWidgetNumber(widget, line, value) { EVENTS.push(["num", SLOT_OF.get(widget >>> 0), line | 0, value | 0]); },
    setWidgetFlag144(widget, value) { EVENTS.push(["f0", SLOT_OF.get(widget >>> 0), value | 0]); },
    setWidgetFlag148(widget, value) { EVENTS.push(["f1", SLOT_OF.get(widget >>> 0), value | 0]); },
});

function clearObj() {
    for (let off = 0; off < 0x100; off += 4) rt.mem.write32(OBJ + off, 0);
}

test("albumPageMask matches F0x80084BC8 across the page and the bound", () => {
    const cases = [0, 1, 2, 12, 25, 26, 0x100];
    // A deterministic collection table.
    for (const card of [1, 12, 13, 100, 250, 310, 0x13a]) {
        rt.mem.write8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE, 1);
    }
    for (const page of cases) {
        const seed = () => {
            clearObj();
            rt.mem.write32(OBJ + 0x60, page);
            rt.mem.write32(OBJ + 0x7c, 0xdead);
            for (let i = 0; i < 12; i++) rt.mem.write32(OBJ + 0x80 + i * 4, 0xbeef);
        };
        seed();
        rt.cpu.call(PAGE_MASK, [OBJ], 200000);
        const oracleAny = rt.mem.read32(OBJ + 0x7c) >>> 0;
        const oracleSlots = Array.from({ length: 12 }, (_, i) => rt.mem.read32(OBJ + 0x80 + i * 4) >>> 0);

        seed();
        albumPageMask(rt.mem, OBJ);
        assert.equal(rt.mem.read32(OBJ + 0x7c) >>> 0, oracleAny, `page ${page}: any flag`);
        assert.deepEqual(
            Array.from({ length: 12 }, (_, i) => rt.mem.read32(OBJ + 0x80 + i * 4) >>> 0),
            oracleSlots, `page ${page}: slot flags`,
        );
    }
});

test("albumCellPaint matches F0x800840AC for its layouts", () => {
    const cases = [
        { page: 0, cell: 0, show: 1, card: 1, badge: 0 },
        { page: 0, cell: 0, show: 0, card: 1, badge: 0 },
        { page: 0, cell: 0, show: 1, card: 2, badge: 1 },   // never obtained
        { page: 1, cell: 5, show: 1, card: 18, badge: 1 },  // obtained, badge layout
        { page: 8, cell: 3, show: 1, card: 100, badge: 0 }, // obtained, full Digimon layout
        { page: 9, cell: 0, show: 1, card: 0x45, badge: 0 },// obtained, special id
        { page: 25, cell: 10, show: 1, card: 0x13a, badge: 0 },
    ];
    for (const cs of cases) {
        const seed = () => {
            clearObj();
            rt.mem.write32(OBJ + 0x60, cs.page);
            rt.mem.write32(OBJ + 0x74, cs.cell);
            // obtained flag for the computed card
            const card = cs.page * 12 + cs.cell + 1;
            rt.mem.write8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE, cs.card === card ? 1 : 0);
            rt.mem.write8(ALBUM_COLLECTION_TABLE + ALBUM_COUNT_OFF + card, 0x80); // signed 128 -> high bit
        };
        seed();
        BADGE = cs.badge;
        rt.cpu.call(CELL_PAINT, [OBJ, CTX, cs.show], 300000);
        const oracle = EVENTS.slice();
        const oracleCard = rt.mem.read32(OBJ + 0x78) >>> 0;
        EVENTS = [];

        seed();
        albumCellPaint(rt.mem, OBJ, CTX, cs.show, portHost(cs.badge));
        const ported = EVENTS.slice();
        EVENTS = [];

        assert.deepEqual(ported, oracle, `${JSON.stringify(cs)}: call stream`);
        assert.equal(rt.mem.read32(OBJ + 0x78) >>> 0, oracleCard, `${JSON.stringify(cs)}: card field`);
    }
    // The signed byte read: 0xFF must reach the number widget as -1.
    clearObj();
    const card = 1;
    rt.mem.write32(OBJ + 0x60, 0);
    rt.mem.write32(OBJ + 0x74, 0);
    rt.mem.write8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE, 1);
    rt.mem.write8(ALBUM_COLLECTION_TABLE + ALBUM_COUNT_OFF + card, 0xff);
    BADGE = 1;
    rt.cpu.call(CELL_PAINT, [OBJ, CTX, 1], 300000);
    const oracle = EVENTS.filter((e) => e[0] === "num" && e[1] === ALBUM_CELL_SLOTS.count);
    EVENTS = [];
    albumCellPaint(rt.mem, OBJ, CTX, 1, portHost(1));
    const ported = EVENTS.filter((e) => e[0] === "num" && e[1] === ALBUM_CELL_SLOTS.count);
    assert.deepEqual(ported, oracle, "the collection count is a signed byte");
    assert.equal(ported[0][3], -1, "0xFF reads as -1");
    assert.equal(ALBUM_CARD_MAX, 0x13b);
});

test("albumMakePopup matches F0x80083008", () => {
    rt.cpu.call(MAKE_POPUP, [], 100000);
    const oracle = {
        method64: rt.mem.read32(POPUP_OBJ + ALBUM_POPUP_FIELDS.method64) >>> 0,
        depth50: rt.mem.read32(POPUP_OBJ + ALBUM_POPUP_FIELDS.depth50) >>> 0,
        scale54: rt.mem.read32(POPUP_OBJ + ALBUM_POPUP_FIELDS.scale54) >>> 0,
    };
    assert.equal(oracle.method64, ALBUM_POPUP_METHOD64);
    assert.equal(oracle.depth50, 0x1000);
    assert.equal(oracle.scale54, 0);

    const obj = albumMakePopup(rt.mem, { allocate: () => POPUP_OBJ + 0x400 });
    assert.equal(obj, POPUP_OBJ + 0x400);
    assert.equal(rt.mem.read32(obj + ALBUM_POPUP_FIELDS.method64) >>> 0, ALBUM_POPUP_METHOD64);
    assert.equal(rt.mem.read32(obj + ALBUM_POPUP_FIELDS.depth50) >>> 0, 0x1000);
    assert.equal(rt.mem.read32(obj + ALBUM_POPUP_FIELDS.scale54) >>> 0, 0);
});
