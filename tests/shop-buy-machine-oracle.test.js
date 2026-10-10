// Phase 4 oracle: engine/dw3/ui/shop-buy-machine.ts must match pro/stitshop
// F0x80083EB0, the shop's BUY state machine (51-way switch). The original runs
// through engine/native on the shipped pro_stitshop.bin + resident.bin with
// every list, band, message, fold, pad, sound and item-table service stubbed at
// the address the machine reads, state by state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopBuyMachine } from "../engine/dw3/ui/shop-buy-machine.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF = 0x80180000;
const CTX = 0x80181000;
const LIST = 0x80182000;
const BAND = 0x80183000;
const MSG = [0x80184000, 0x80184100, 0x80184200, 0x80184300];
const ROOT = 0x80185000;
const RECORD = 0x80186000;
const STUB = 0x0fd00000;
const ITEM = 0x80187000;
let ITEM_ID = 0x11;

// Stub cell ids (offset into the STUB block).
const CELL = {
    list6E8: 0x00, list6EC: 0x10, list6F0: 0x20, list6F4: 0x30, list6F8: 0x40,
    band234: 0x50, band238: 0x60, band240: 0x70, band244: 0x80, band3C: 0x90,
    msg114: 0xa0, msg144: 0xb0, plate80: 0xc0, plate84: 0xd0,
    self2C: 0xe0, self3C: 0xf0,
    foldStart: 0x100, foldTick: 0x110, memFold: 0x120, memTick: 0x130,
    memHas: 0x140, memEntry: 0x150, memMove: 0x160,
    party: 0x170, itemRec: 0x180, itemSlot: 0x190, bank: 0x1a0,
    sound: 0x1b0, padPressed: 0x1c0, padRepeat: 0x1d0, padKey: 0x1e0,
    createList: 0x1f0, createBand: 0x200, refreshPlate: 0x210, refreshBand: 0x220,
    rootA8: 0x230,
};

let EVENTS = [];
let PAD_PRESSED = 0;
let PAD_REPEAT = 0;
let FOLD_DONE = 0;
let MEMBER_HAS = 0;
let MONEY = 1000;
let HELD = 0;

function addr(cell) { return (STUB + cell) >>> 0; }

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    const stub = (cell, fn) => rt.cpu.setStub(addr(cell), fn);

    stub(CELL.list6E8, (c) => { EVENTS.push(["listHide", c.reg(4) >>> 0]); return 0; });
    stub(CELL.list6EC, (c) => { EVENTS.push(["listTeardown", c.reg(4) >>> 0]); return 0; });
    stub(CELL.list6F0, () => { EVENTS.push(["listItemId"]); return ITEM_ID; });
    stub(CELL.list6F4, (c) => { EVENTS.push(["listCursor", c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    stub(CELL.list6F8, (c) => { EVENTS.push(["listCards", c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    stub(CELL.band234, (c) => { EVENTS.push(["bandQuantity", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    stub(CELL.band238, (c) => { EVENTS.push(["bandFold", c.reg(4) >>> 0]); return 0; });
    stub(CELL.band240, (c) => { EVENTS.push(["bandReverse", c.reg(4) >>> 0]); return 0; });
    stub(CELL.band244, (c) => { EVENTS.push(["bandHighlight", c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    stub(CELL.band3C, (c) => { EVENTS.push(["bandReset", c.reg(4) >>> 0]); return 0; });
    stub(CELL.msg114, (c) => { EVENTS.push(["messageSet", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    stub(CELL.msg144, (c) => { EVENTS.push(["messageShow", c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    stub(CELL.plate80, (c) => { EVENTS.push(["plateMode", c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    stub(CELL.plate84, (c) => { EVENTS.push(["platePos", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    stub(CELL.self2C, (c) => { EVENTS.push(["selfTransition", c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    stub(CELL.self3C, (c) => { EVENTS.push(["selfBaseAdvance", c.reg(4) >>> 0]); return 0; });
    stub(CELL.foldStart, (c) => { EVENTS.push(["foldStart", c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    stub(CELL.foldTick, (c) => { EVENTS.push(["foldTick", c.reg(4) >>> 0]); return FOLD_DONE; });
    stub(CELL.memHas, (c) => { EVENTS.push(["memberHas", c.reg(4) >>> 0, c.reg(5) | 0]); return MEMBER_HAS; });
    stub(CELL.memEntry, (c) => { EVENTS.push(["memberEntry", c.reg(4) >>> 0, c.reg(5) | 0]); return 0x400; });
    stub(CELL.memMove, (c) => { EVENTS.push(["memberMove", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
    stub(CELL.party, (c) => { EVENTS.push(["partySlot", c.reg(4) | 0]); return 0x7000 + (c.reg(4) | 0); });
    stub(CELL.itemRec, (c) => { EVENTS.push(["itemRecord", c.reg(4) | 0]); return RECORD; });
    stub(CELL.itemSlot, (c) => { EVENTS.push(["itemHasSlot", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    stub(CELL.bank, (c) => { EVENTS.push(["bankGet", c.reg(4) | 0]); return 0x1234; });
    stub(CELL.sound, (c) => { EVENTS.push(["sound", c.reg(4) >>> 0]); return 0; });
    stub(CELL.padPressed, () => { EVENTS.push(["padPressed"]); return PAD_PRESSED; });
    stub(CELL.padRepeat, () => { EVENTS.push(["padRepeat"]); return PAD_REPEAT; });
    stub(CELL.padKey, (c) => { EVENTS.push(["padKey", c.reg(4) | 0, c.reg(5) | 0]); return c.reg(5) | 0; });
    stub(CELL.createList, (c) => { EVENTS.push(["createList", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]); return LIST; });
    stub(CELL.createBand, (c) => { EVENTS.push(["createBand", c.reg(4) | 0, c.reg(5) | 0]); return BAND; });
    stub(CELL.refreshPlate, (c) => { EVENTS.push(["refreshQuantityPlate", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    stub(CELL.refreshBand, (c) => { EVENTS.push(["refreshBand", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    stub(CELL.rootA8, (c) => { EVENTS.push(["rootCommit", c.reg(4) >>> 0]); return 0; });

    // The machine's direct calls and the resident cells it jumps through.
    rt.cpu.setStub(0x800889a8, (c) => { EVENTS.push(["createList", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]); return LIST; });
    rt.cpu.setStub(0x8008b484, (c) => { EVENTS.push(["createBand", c.reg(4) | 0, c.reg(5) | 0]); return BAND; });
    rt.cpu.setStub(0x800836f8, (c) => { EVENTS.push(["refreshQuantityPlate", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(0x80083810, (c) => { EVENTS.push(["refreshBand", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    rt.mem.write32(0x8008d1b8, addr(CELL.foldStart));
    rt.mem.write32(0x8008d1bc, addr(CELL.foldTick));
    rt.mem.write32(0x8008d1ac + 0x20, addr(CELL.memHas));
    rt.mem.write32(0x8008d1ac + 0x24, addr(CELL.memEntry));
    rt.mem.write32(0x8008d1ac + 0x28, addr(CELL.memMove));
    rt.mem.write32(0x8004b44c, addr(CELL.party));
    rt.mem.write32(0x80042b98, addr(CELL.itemRec));
    rt.mem.write32(0x80042b98 + 8, addr(CELL.itemSlot));
    rt.mem.write32(0x80044f4c, addr(CELL.bank));
    rt.mem.write32(0x80055c48, addr(CELL.sound));
    rt.mem.write32(0x8004b7d0 + 0x3f4, addr(CELL.padPressed));
    rt.mem.write32(0x8004b7d0 + 0x3fc, addr(CELL.padRepeat));
    rt.mem.write32(0x8004b7d0 + 0x408, addr(CELL.padKey));
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    for (let i = 0; i < 0x120; i += 4) rt.mem.write32(SELF + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(CTX + i, 0);
    for (let i = 0; i < 0x800; i += 4) rt.mem.write32(LIST + i, 0);
    for (let i = 0; i < 0x250; i += 4) rt.mem.write32(BAND + i, 0);
    for (const m of MSG) for (let i = 0; i < 0x150; i += 4) rt.mem.write32(m + i, 0);
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(ROOT + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(RECORD + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(ITEM + i, 0);
    rt.mem.write32(ROOT + 0x60, 0x11);
    rt.mem.write32(ROOT + 0xa8, addr(CELL.rootA8));
    rt.mem.write32(SELF + 0x54, ROOT);
    rt.mem.write32(SELF + 0x2c, addr(CELL.self2C));
    rt.mem.write32(SELF + 0x3c, addr(CELL.self3C));
    rt.mem.write32(CTX + 0x00, o.list === null ? 0 : (o.list ?? LIST));
    rt.mem.write32(CTX + 0x04, o.band === null ? 0 : (o.band ?? BAND));
    rt.mem.write32(CTX + 0x14, MSG[0]);
    rt.mem.write32(CTX + 0x18, MSG[1]);
    rt.mem.write32(CTX + 0x1c, MSG[2]);
    rt.mem.write32(CTX + 0x20, MSG[3]);
    for (const [m, offs] of [[MSG[0], [0x114, 0x144]], [MSG[1], [0x114, 0x144]],
        [MSG[2], [0x114, 0x144]], [MSG[3], [0x80, 0x84]]]) {
        for (const off of offs) {
            const cell = off === 0x114 ? CELL.msg114 : off === 0x144 ? CELL.msg144
                : off === 0x80 ? CELL.plate80 : CELL.plate84;
            rt.mem.write32(m + off, addr(cell));
        }
    }
    for (const [off, cell] of [[0x6e8, CELL.list6E8], [0x6ec, CELL.list6EC], [0x6f0, CELL.list6F0],
        [0x6f4, CELL.list6F4], [0x6f8, CELL.list6F8]]) {
        rt.mem.write32(LIST + off, addr(cell));
    }
    for (const [off, cell] of [[0x234, CELL.band234], [0x238, CELL.band238], [0x240, CELL.band240],
        [0x244, CELL.band244], [0x3c, CELL.band3C]]) {
        rt.mem.write32(BAND + off, addr(cell));
    }
    rt.mem.write32(LIST + 0x0c, (o.listReady ?? 0) >>> 0);
    rt.mem.write32(BAND + 0x10, (o.bandReady ?? 0) >>> 0);
    rt.mem.write32(BAND + 0x1f0, (o.bandFlag ?? 0) >>> 0);
    rt.mem.write32(BAND + 0x60, (o.bandCount ?? 3) >>> 0);
    rt.mem.write32(SELF + 0x10, (o.state ?? 0) >>> 0);
    rt.mem.write32(SELF + 0x14, (o.flag14 ?? 0) >>> 0);
    rt.mem.write32(SELF + 0x60, (o.itemId ?? 0x11) >>> 0);
    rt.mem.write32(SELF + 0x64, (o.quantity ?? 1) >>> 0);
    rt.mem.write32(SELF + 0x68, (o.ceiling ?? 99) >>> 0);
    rt.mem.write32(SELF + 0x74, (o.cursor ?? 0) >>> 0);
    rt.mem.write32(SELF + 0x78, (o.member ?? 0) >>> 0);
    rt.mem.write32(SELF + 0x7c, (o.flag7C ?? 0) >>> 0);
    rt.mem.write32(RECORD + 0x04, (o.price ?? 100) >>> 0);
    rt.mem.write32(0x80048d34 + 0x6c, (o.money ?? MONEY) >>> 0);
    rt.mem.write8(0x80048d34 + 0x7c + (o.itemId ?? 0x11), o.held ?? HELD);
    rt.mem.write8(0x80048d34 + 0x7c + 0x12, o.heldOther ?? 0);
    PAD_PRESSED = (o.pressed ?? 0) >>> 0;
    PAD_REPEAT = (o.repeat ?? 0) >>> 0;
    FOLD_DONE = o.foldDone ?? 0;
    MEMBER_HAS = o.memberHas ?? 0;
    ITEM_ID = o.itemId ?? 0x11;
}

function fields() {
    const out = [];
    for (let i = 0; i < 0x120 / 4; i++) out.push(rt.mem.read32(SELF + i * 4) >>> 0);
    for (let i = 0; i < 0x40 / 4; i++) out.push(rt.mem.read32(CTX + i * 4) >>> 0);
    out.push(rt.mem.read32(0x80048d34 + 0x6c) >>> 0);
    for (const item of [0x11, 0x12, 0x13]) out.push(rt.mem.read8(0x80048d34 + 0x7c + item));
    return out;
}

function portHost() {
    return {
        createList() { EVENTS.push(["createList", SELF, 0x11, 0]); return LIST; },
        createBand(_kind, item) { EVENTS.push(["createBand", 0, item | 0]); return BAND; },
        refreshQuantityPlate(_self, _ctx, flag) { EVENTS.push(["refreshQuantityPlate", SELF, CTX, flag | 0]); },
        refreshBand(_self, _ctx, flag) { EVENTS.push(["refreshBand", SELF, CTX, flag | 0]); },
        listHide(obj) { EVENTS.push(["listHide", obj >>> 0]); },
        listTeardown(obj) { EVENTS.push(["listTeardown", obj >>> 0]); },
        listItemId() { EVENTS.push(["listItemId"]); return ITEM_ID; },
        listCursor(obj, show) { EVENTS.push(["listCursor", obj >>> 0, show | 0]); },
        listCards(obj, on) { EVENTS.push(["listCards", obj >>> 0, on | 0]); },
        bandQuantity(obj, item, qty) { EVENTS.push(["bandQuantity", obj >>> 0, item | 0, qty | 0]); },
        bandFold(obj) { EVENTS.push(["bandFold", obj >>> 0]); },
        bandReverse(obj) { EVENTS.push(["bandReverse", obj >>> 0]); },
        bandHighlight(obj, i) { EVENTS.push(["bandHighlight", obj >>> 0, i | 0]); },
        bandReset(obj) { EVENTS.push(["bandReset", obj >>> 0]); },
        selfTransition(obj, v) { EVENTS.push(["selfTransition", obj >>> 0, v | 0]); },
        selfBaseAdvance(obj) { EVENTS.push(["selfBaseAdvance", obj >>> 0]); },
        rootCommit(obj) { EVENTS.push(["rootCommit", obj >>> 0]); },
        messageSet(w, src, id) { EVENTS.push(["messageSet", w >>> 0, src >>> 0, id | 0]); },
        messageShow(w, v) { EVENTS.push(["messageShow", w >>> 0, v | 0]); },
        plateMode(w, v) { EVENTS.push(["plateMode", w >>> 0, v | 0]); },
        platePos(w, x, y) { EVENTS.push(["platePos", w >>> 0, x | 0, y | 0]); },
        foldStart(w, on) { EVENTS.push(["foldStart", w >>> 0, on | 0]); },
        foldTick(w) { EVENTS.push(["foldTick", w >>> 0]); return FOLD_DONE; },
        memberHas(m, item) { EVENTS.push(["memberHas", m >>> 0, item | 0]); return MEMBER_HAS; },
        memberEntry(m, item) { EVENTS.push(["memberEntry", m >>> 0, item | 0]); return 0x400; },
        memberMove(e, slot, item, flag) { EVENTS.push(["memberMove", e >>> 0, slot | 0, item | 0, flag | 0]); },
        partySlot(i) { EVENTS.push(["partySlot", i | 0]); return (0x7000 + (i | 0)) >>> 0; },
        itemRecord(item) { EVENTS.push(["itemRecord", item | 0]); return RECORD; },
        itemHasSlot(item, slot) { EVENTS.push(["itemHasSlot", item | 0, slot | 0]); return 0; },
        bankGet(id) { EVENTS.push(["bankGet", id | 0]); return 0x1234; },
        padPressed() { EVENTS.push(["padPressed"]); return PAD_PRESSED; },
        padRepeat() { EVENTS.push(["padRepeat"]); return PAD_REPEAT; },
        padKey(port, code) { EVENTS.push(["padKey", port | 0, code | 0]); return code | 0; },
        playSound(id) { EVENTS.push(["sound", id >>> 0]); },
    };
}

/** The port's root commit goes through the root object; the stub records only it. */
function compare(label, o) {
    seed(o);
    EVENTS = [];
    rt.cpu.call(0x80083eb0, [SELF, CTX]);
    const oEvents = EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v)));
    const oFields = fields();

    seed(o);
    EVENTS = [];
    shopBuyMachine(rt.mem, SELF, CTX, portHost());
    assert.deepEqual(EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v))), oEvents,
        `${label}: calls`);
    assert.deepEqual(fields(), oFields, `${label}: fields`);
}

const STATES = Array.from({ length: 51 }, (_, i) => i);
const CONFIRM = 1 << 0xd;
const CANCEL = 1 << 0xe;
const CIRCLE = 1 << 0xc;

test("shopBuyMachine matches F0x80083EB0 for every state, quiet", () => {
    for (const state of STATES) compare(`state ${state} quiet`, { state, listReady: 0, bandReady: 0 });
});

test("shopBuyMachine matches F0x80083EB0 for every state, gates ready", () => {
    for (const state of STATES) {
        compare(`state ${state} ready`, {
            state, listReady: 2, bandReady: 3, bandFlag: 1, foldDone: 1, memberHas: 0x7000, money: 5000,
        });
    }
});

test("shopBuyMachine input paths match F0x80083EB0", () => {
    compare("state 3 confirm", { state: 3, listReady: 2, bandReady: 3, pressed: CONFIRM, price: 100, money: 1000 });
    compare("state 3 confirm broke", { state: 3, listReady: 2, bandReady: 3, pressed: CONFIRM, price: 5000, money: 1000 });
    compare("state 3 confirm full", { state: 3, listReady: 2, bandReady: 3, pressed: CONFIRM, held: 0x63 });
    compare("state 3 cancel", { state: 3, listReady: 2, bandReady: 3, pressed: CANCEL });
    compare("state 3 circle", { state: 3, listReady: 2, bandReady: 3, pressed: CIRCLE });
    compare("state 8 up", { state: 8, pressed: 1 << 4, quantity: 1, ceiling: 5, money: 1000, price: 100 });
    compare("state 8 down", { state: 8, pressed: 1 << 6, quantity: 2, ceiling: 5, money: 1000, price: 100 });
    compare("state 8 big up", { state: 8, pressed: 1 << 5, quantity: 1, ceiling: 99, money: 1000, price: 100 });
    compare("state 8 big down", { state: 8, pressed: 1 << 7, quantity: 20, ceiling: 99, money: 1000, price: 100 });
    compare("state 8 confirm", { state: 8, pressed: CONFIRM, quantity: 1, ceiling: 99, money: 1000, price: 100 });
    compare("state 8 cancel", { state: 8, pressed: CANCEL, quantity: 3, ceiling: 99, money: 1000, price: 100 });
    compare("state 8 circle", { state: 8, pressed: CIRCLE, bandReady: 3, quantity: 1, money: 1000, price: 100 });
    compare("state 17 move", { state: 17, pressed: 1 << 6, cursor: 0, bandFlag: 1, price: 100, money: 1000 });
    compare("state 17 buy", { state: 17, pressed: CONFIRM, cursor: 0, bandFlag: 1, price: 100, quantity: 2, money: 1000 });
    compare("state 17 buy other", { state: 17, pressed: CONFIRM, cursor: 1, bandFlag: 1, price: 100, money: 1000 });
    compare("state 17 cancel", { state: 17, pressed: CANCEL, bandFlag: 1 });
    compare("state 17 circle", { state: 17, pressed: CIRCLE, bandReady: 3, bandFlag: 1 });
    compare("state 27 move", { state: 27, pressed: 1 << 4, bandReady: 3, member: 1 });
    compare("state 27 confirm member", { state: 27, pressed: CONFIRM, bandReady: 3, member: 1 });
    compare("state 27 confirm zero", { state: 27, pressed: CONFIRM, bandReady: 3, member: 0 });
    compare("state 27 cancel", { state: 27, pressed: CANCEL, bandReady: 3 });
    compare("state 32 up", { state: 32, pressed: 1 << 5, member: 0, memberHas: 0x7001, bandCount: 3 });
    compare("state 32 down", { state: 32, pressed: 1 << 7, member: 2, memberHas: 0x7001 });
    compare("state 32 confirm", { state: 32, pressed: CONFIRM, member: 1, memberHas: 0x7001 });
    compare("state 32 cancel", { state: 32, pressed: CANCEL, member: 1, memberHas: 0x7001 });
    compare("state 47 dismiss", { state: 47, pressed: CONFIRM });
    compare("state 47 dismiss cancel", { state: 47, pressed: CANCEL });
    compare("state 39 dismiss", { state: 39, pressed: CONFIRM, foldDone: 0 });
    compare("state 50 teardown", { state: 50, band: null });
    compare("state 0 creates list", { state: 0, list: null });
    compare("state 0 keeps list", { state: 0, list: LIST });
    compare("state 5 free item", { state: 5, price: 0, money: 500, held: 10 });
    compare("state 5 low money", { state: 5, price: 0, money: 60, held: 0 });
    compare("state 5 ceiling clamps", { state: 5, price: 100, money: 5000, held: 0x62 });
    compare("state 8 money clamp", { state: 8, pressed: 1 << 5, quantity: 50, ceiling: 99, money: 1200, price: 100 });
    compare("state 10 lands with flag", { state: 10, foldDone: 1, flag14: 1, listReady: 2 });
    compare("state 10 lands without", { state: 10, foldDone: 1, flag14: 0 });
    compare("state 21 members", { state: 21, foldDone: 1, flag14: 1, memberHas: 0x7000 });
    compare("state 21 no member", { state: 21, foldDone: 1, flag14: 1, memberHas: 0 });
    compare("state 31 skip loop", { state: 31, foldDone: 1, itemId: 0x11, memberHas: 0 });
    compare("state 31 finds member", { state: 31, foldDone: 1, itemId: 0x11, memberHas: 0x7002 });
    compare("state 32 up wraps", { state: 32, pressed: 1 << 5, member: 2, memberHas: 0, bandCount: 3 });
    compare("state 32 down wraps", { state: 32, pressed: 1 << 7, member: 0, memberHas: 0, bandCount: 3 });
    compare("state 40 no stock", { state: 40, foldDone: 1, held: 0 });
    compare("state 40 has stock", { state: 40, foldDone: 1, held: 2 });
    compare("state 28 flag set", { state: 28, foldDone: 1, flag14: 1 });
    compare("state 29 flag set", { state: 29, foldDone: 1, flag14: 1 });
    compare("state 33 lands", { state: 33, foldDone: 1 });
    compare("state 37 lands", { state: 37, foldDone: 1 });
    compare("state 38 lands", { state: 38, foldDone: 1 });
    compare("state 46 lands", { state: 46, foldDone: 1 });
    compare("state 48 lands", { state: 48, foldDone: 1 });
    compare("state 26 lands", { state: 26, foldDone: 1 });
});
