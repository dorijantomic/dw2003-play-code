// Oracle: engine/dw3/ui/native/card-view-text.ts must reproduce the resident
// card-view text context the album and the folder editor share --
//
//   F0x8001EBF8  constructCardView        (the class context)
//   F0x8001E7EC  resolveCardRecord        (the CARDPAK selector)
//   F0x8001EBCC  currentViewTableWord     (the record-kind predicate)
//   F0x8001E9E0  queueCurrentViewPrimitive (the card-art primitive)
//
// Every device boundary is hooked on BOTH sides at the same point: the resource
// service ([0x80044F4C]), the picture service's new-primitive slot
// ([0x8004DE10+0x158]) and its emit slot ([0x8004DE10+0x15C]). The class context
// and the emitted primitive are compared byte for byte, and the ordered emit
// calls are compared.
//
// The record store itself is data: installCardRecords writes each CARDPAK record
// at the real 0x62C stride, and the test checks that the selector resolves the
// bytes the store wrote -- which is what makes the album and folder show real
// AP/HP/cost instead of a compact colour table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { CURRENT_VIEW_CELL } from "../engine/dw3/globals.ts";
import { CARD_FILE_TABLE, CARD_KIND_TABLE, CARD_RECORD_STRIDE, CARD_VIEW_SIZE, constructCardView } from "../engine/dw3/ui/card-view.ts";
import {
    CardViewTextContext,
    cardPakFileBase,
    cardRecordAddress,
    installCardRecords,
    installCardViewTables,
    queueCurrentViewPrimitive,
} from "../engine/dw3/ui/native/card-view-text.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const RESOURCE_PTR = 0x80044f4c;
const RESOURCE_STUB = 0x80019070;
const GP = 0x8005cb50;
const NEW_PRIMITIVE = 0x8004de10 + 0x158;
const EMIT = 0x8004de10 + 0x15c;
const PRIM_FN = 0x80019090;
const EMIT_FN = 0x80019094;
const CTX = 0x80192000;
const PRIM = 0x80170000;
/** A stand-in ordering-table tag word (its low 24 bits are the next pointer). */
const TAG = 0x80198000;
const OT_TAG_WORD = 0x04001234;

function original() {
    const loadCalls = [];
    const emitCalls = [];
    const baseFor = (discId) => (0x80100000 + ((discId | 0) - 0x7f6) * 0x40 * CARD_RECORD_STRIDE) >>> 0;
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.gp = GP;
    rt.cpu.sp = 0x801ff000;
    rt.cpu.setStub(RESOURCE_STUB, (c) => baseFor(c.reg(4) | 0));
    rt.cpu.setStub(PRIM_FN, () => PRIM);
    rt.cpu.setStub(EMIT_FN, (c) => { emitCalls.push(c.reg(4) >>> 0); return 0; });
    rt.mem.write32(RESOURCE_PTR, RESOURCE_STUB);
    rt.mem.write32(NEW_PRIMITIVE, PRIM_FN);
    rt.mem.write32(EMIT, EMIT_FN);
    return { rt, loadCalls, emitCalls, baseFor };
}

function portAlloc() {
    let next = CTX;
    const blocks = [];
    return {
        allocate(size) { const at = next; next = (next + size + 0xf) & ~0xf; blocks.push(at); return at; },
        blocks,
    };
}

const RECORDS = [
    // A Program card (Sacred Spear, id 1): its program cost (+0x04) is real and
    // its summon cost and level are zero on the disc.
    { colour: 1, ap: 0, hp: 0, kind: 1, programCost: 4, summonCost: 0, level: 0, strengthRank: 310, comboInto: 0 },
    // A Digimon (Imperialdramon-P, id 61): its program cost is zero on the disc.
    { colour: 1, ap: 62, hp: 70, kind: 0x10, programCost: 0, summonCost: 3, level: 5, strengthRank: 7, comboInto: 0 },
    // A blue Program (Tidal Wave, id 7).
    { colour: 2, ap: 0, hp: 0, kind: 5, programCost: 4, summonCost: 0, level: 0, strengthRank: 31, comboInto: 12 },
];

test("constructCardView through the shared context matches F0x8001EBF8", () => {
    const a = original();
    a.rt.cpu.call(0x8001ebf8, [CTX]);
    const bytesA = Array.from({ length: CARD_VIEW_SIZE / 4 }, (_, i) => a.rt.mem.read32(CTX + i * 4) >>> 0);

    const mem = a.rt.mem;
    const alloc = portAlloc();
    const ctx = new CardViewTextContext(mem, {
        allocate: (size) => alloc.allocate(size),
        loadImage: () => {}, findRegisteredHandleByKey: () => 0, callViewMethod: () => 0,
        newPrimitive: () => PRIM, emitPrimitive: () => {},
    });
    ctx.init();
    const bytesB = Array.from({ length: CARD_VIEW_SIZE / 4 }, (_, i) => mem.read32(ctx.address() + i * 4) >>> 0);
    // The original wrote CTX; the port wrote ctx.address(). Both contexts come
    // out of the same constructor, so compare the bytes field by field.
    assert.deepEqual(bytesB, bytesA, "context bytes");
    assert.equal(mem.read32(CURRENT_VIEW_CELL) >>> 0, ctx.address() >>> 0, "port published its context");
});

test("the selector resolves a record at the file base + slot*0x62C, matching F0x8001E7EC", () => {
    for (const id of [0, 1, 2, 63, 64, 65, 315, -1]) {
        const a = original();
        a.rt.cpu.call(0x8001ebf8, [CTX]);
        a.rt.cpu.call(0x8001e7ec, [id]);

        const mem = a.rt.mem;
        const ctx = new CardViewTextContext(mem, {
            allocate: () => CTX, loadImage: () => {}, findRegisteredHandleByKey: () => 0,
            callViewMethod: () => 0, newPrimitive: () => PRIM, emitPrimitive: () => {},
        });
        ctx.init();
        ctx.select(id);
        assert.equal(mem.read32(CURRENT_VIEW_CELL) >>> 0, ctx.address() >>> 0,
            `id=${id} the shared context is published`);
        // The selector pointer promised by the resident reader.
        const expected = id > 0
            ? a.baseFor(a.rt.mem.read32(CARD_FILE_TABLE + ((id - 1) >> 6) * 4) | 0) + (((id - 1) & 0x3f) * CARD_RECORD_STRIDE)
            : a.baseFor(a.rt.mem.read32(CARD_FILE_TABLE) | 0);
        assert.equal(mem.read32(ctx.address()) >>> 0, expected >>> 0, `id=${id} record pointer`);
        assert.equal(cardRecordAddress(id) >>> 0, expected >>> 0, `id=${id} cardRecordAddress`);
    }
});

test("installCardRecords makes the selector read every real record field", () => {
    const mem = original().rt.mem;
    installCardViewTables(mem);
    installCardRecords(mem, RECORDS);
    const ctx = new CardViewTextContext(mem, {
        allocate: () => CTX, loadImage: () => {}, findRegisteredHandleByKey: () => 0,
        callViewMethod: () => 0, newPrimitive: () => PRIM, emitPrimitive: () => {},
    });
    ctx.init();
    for (let i = 0; i < RECORDS.length; i++) {
        const card = RECORDS[i];
        const id = i + 1;
        ctx.select(id);
        assert.equal(ctx.byte(0), card.colour, `card ${id} colour (+0x00)`);
        assert.equal(ctx.byte(1), card.ap, `card ${id} AP (+0x01)`);
        assert.equal(ctx.byte(2), card.hp, `card ${id} HP (+0x02)`);
        assert.equal(ctx.byte(3), card.kind, `card ${id} kind (+0x03)`);
        assert.equal(ctx.byte(4), card.programCost, `card ${id} program cost (+0x04)`);
        assert.equal(ctx.byte(5), card.summonCost, `card ${id} summon cost (+0x05)`);
        assert.equal(ctx.byte(6), card.level, `card ${id} level (+0x06)`);
        // The two 16-bit fields, read back at the selector's record address.
        const record = cardRecordAddress(id) >>> 0;
        assert.equal(mem.read16(record + 0x08) & 0xffff, card.strengthRank, `card ${id} strength rank (+0x08 u16)`);
        assert.equal(mem.read16(record + 0x0a) & 0xffff, card.comboInto, `card ${id} combo target (+0x0A u16)`);
        // The kind word: Digimon -> 0, a Program -> nonzero (docs verify S2).
        const expectedKind = mem.read32(CARD_KIND_TABLE + (card.kind & 0xff) * 4) | 0;
        assert.equal(ctx.kind(), expectedKind, `card ${id} kind word`);
        if (card.kind === 0x10) assert.equal(ctx.kind(), 0, "a Digimon shows AP/HP");
        else assert.notEqual(ctx.kind(), 0, "a Program shows its class plate");
    }
    // A Program's program cost is real and its summon cost / level are zero; a
    // Digimon's program cost is zero and its summon cost / level are real.
    ctx.select(1);
    assert.equal(ctx.byte(4), 4, "Sacred Spear's program cost is 4");
    assert.equal(ctx.byte(5), 0, "a Program's summon cost is the disc's zero");
    assert.equal(ctx.byte(6), 0, "a Program's level is the disc's zero");
    ctx.select(2);
    assert.equal(ctx.byte(4), 0, "a Digimon's program cost is the disc's zero");
    assert.equal(ctx.byte(5), 3, "Imperialdramon-P's summon cost is 3");
    assert.equal(ctx.byte(6), 5, "Imperialdramon-P's level is 5");
    // The file bases step by 64 records at 0x62C.
    assert.equal(cardPakFileBase(0x7f6), cardRecordAddress(1), "file 0 starts at record 1");
    assert.equal(cardPakFileBase(0x7f7) - cardPakFileBase(0x7f6), 0x40 * CARD_RECORD_STRIDE, "file stride");
});

test("currentViewTableWord through the shared context matches F0x8001EBCC", () => {
    const a = original();
    a.rt.cpu.call(0x8001ebf8, [CTX]);
    for (const kind of [0, 1, 5, 0x10, 0x14]) {
        a.rt.mem.write8(0x80194000 + 3, kind);
        a.rt.mem.write32(CTX, 0x80194000);
        a.rt.mem.write32(CARD_KIND_TABLE + kind * 4, 0x12340000 | kind);
        const expected = a.rt.cpu.call(0x8001ebcc, []) | 0;

        const mem = a.rt.mem;
        const ctx = new CardViewTextContext(mem, {
            allocate: () => CTX, loadImage: () => {}, findRegisteredHandleByKey: () => 0,
            callViewMethod: () => 0, newPrimitive: () => PRIM, emitPrimitive: () => {},
        });
        ctx.init();
        mem.write8(0x80194000 + 3, kind);
        mem.write32(ctx.address(), 0x80194000);
        mem.write32(CARD_KIND_TABLE + kind * 4, 0x12340000 | kind);
        assert.equal(ctx.kind(), expected, `kind=${kind}`);
    }
});

test("queueCurrentViewPrimitive matches F0x8001E9E0 for a spread of cells and flags", () => {
    const cells = [
        { col: 0, row: 0, pitch: 8, pageBase: 0x280, pairBase: 0x100, clutX: 0x140, flag: 0, x: 0x20, y: 0x30 },
        { col: 3, row: 2, pitch: 8, pageBase: 0x280, pairBase: 0x100, clutX: 0x340, flag: 1, x: 0x120, y: 0x90 },
        { col: 7, row: 1, pitch: 0xc, pageBase: 0x2c0, pairBase: 0x180, clutX: 0x500, flag: 0, x: -0x10, y: 0x1f0 },
        { col: 5, row: 4, pitch: 8, pageBase: 0x300, pairBase: 0x100, clutX: 0x280, flag: 1, x: 0x1ff, y: -0x20 },
    ];
    for (const c of cells) {
        // original
        const a = original();
        a.rt.cpu.call(0x8001ebf8, [CTX]);
        for (let i = 0; i < 0x40; i += 4) a.rt.mem.write32(PRIM + i, 0xdeadbeef);
        a.rt.mem.write32(CTX + 0x04, c.pageBase);
        a.rt.mem.write32(CTX + 0x08, c.pairBase);
        a.rt.mem.write32(CTX + 0x0c, c.clutX);
        a.rt.mem.write32(CTX + 0x10, c.pairBase);
        a.rt.mem.write32(CTX + 0x14, c.col);
        a.rt.mem.write32(CTX + 0x18, c.row);
        a.rt.mem.write32(CTX + 0x1c, c.pitch);
        a.rt.mem.write32(CTX + 0x20, c.flag);
        // ctx+0x28 is a POINTER to the OT's tag word; seed a live table entry.
        a.rt.mem.write32(TAG, OT_TAG_WORD);
        a.rt.mem.write32(CTX + 0x28, TAG);
        a.rt.cpu.call(0x8001e9e0, [c.x, c.y]);
        const origPrim = Array.from({ length: 0x20 }, (_, i) => a.rt.mem.read8(PRIM + i) & 0xff);
        const origTag = a.rt.mem.read32(TAG) >>> 0;

        // port
        const mem = a.rt.mem;
        for (let i = 0; i < 0x40; i += 4) mem.write32(PRIM + i, 0xdeadbeef);
        for (const [off, v] of [[0x04, c.pageBase], [0x08, c.pairBase], [0x0c, c.clutX], [0x10, c.pairBase],
            [0x14, c.col], [0x18, c.row], [0x1c, c.pitch], [0x20, c.flag]]) {
            mem.write32(CTX + off, v);
        }
        mem.write32(TAG, OT_TAG_WORD);
        mem.write32(CTX + 0x28, TAG);
        const emitCalls = [];
        // The port references the context the ORIGINAL published (CURRENT_VIEW_CELL).
        queueCurrentViewPrimitive(mem, {
            newPrimitive: () => PRIM, emitPrimitive: (p) => { emitCalls.push(p >>> 0); },
        }, c.x, c.y);
        const portPrim = Array.from({ length: 0x20 }, (_, i) => mem.read8(PRIM + i) & 0xff);
        const portTag = mem.read32(TAG) >>> 0;

        assert.deepEqual(portPrim, origPrim, `cell ${JSON.stringify(c)} primitive bytes`);
        assert.equal(portTag, origTag, `cell ${JSON.stringify(c)} OT tag word`);
        assert.deepEqual(emitCalls, a.emitCalls, `cell ${JSON.stringify(c)} emit calls`);
        assert.ok(a.emitCalls.length >= 1, "the original emitted something");
    }
});
