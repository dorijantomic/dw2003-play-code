// Phase 4 oracle: engine/dw3/ui/native/folder-card-grid.ts must match the
// original pro/stcrddek editor bodies the folder chooser hands off to:
//
//   F0x80086574 folderCardGridTick      F0x8008397C folderGridCreateChrome
//   F0x80085210 folderCardGridMachine   F0x80084890 folderCardGridDraw
//   F0x800835D8 folderGridDrawSlots     F0x800837B4 folderGridDealIn
//   F0x800838C4 folderGridObjectsTick   F0x80083934 folderGridCreateObjects
//   F0x80083D28 folderEditorHeader      F0x80084278 folderSwapRowsFill
//   F0x80084440 folderDetailPanel       F0x800847C0 folderWorkingTable
//   F0x80088AC8 folderPagerCreate       F0x800888B0 folderPagerTick
//
// The original runs through engine/native on the shipped overlay + resident
// image; every service the bodies call (the widget factory and methods, the
// card-view text context, the window-fold pair, the draw context, the picture
// service the pager draws through, the pad, sound, text banks, pack resolver and
// clock) is stubbed on both sides so the ordered calls, the object fields and
// the folder records can be compared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { windowFoldStart, windowFoldTick } from "../engine/dw3/ui/window-fold.ts";
import {
    FOLDER_GRID_HANDLER, FOLDER_GRID_SIZE, FOLDER_GRID_EXTRA,
    FOLDER_GRID_OBJECT_HANDLER, FOLDER_GRID_OBJECT_SIZE,
    FOLDER_PAGER_HANDLER, FOLDER_PAGER_SIZE,
    FOLDER_RECORDS_BASE, FOLDER_SLOT_STRIDE, FOLDER_SLOTS_BASE,
    FOLDER_OWNED_BASE, FOLDER_OWNED_OFF, FOLDER_CARD_MAX,
    FOLDER_GRID_SAVE_PTR, GRID_FIELDS as G, GRID_CHILD as C, GRID_OBJ_FIELDS as O,
    folderCardGridTick, folderGridCreateChrome, folderCardGridMachine, folderCardGridDraw,
    folderGridDrawSlots, folderGridDealIn, folderGridObjectsTick, folderGridCreateObjects,
    folderEditorHeader, folderSwapRowsFill, folderDetailPanel, folderWorkingTable,
    folderPagerCreate, folderPagerTick, pagerSetA, pagerSetB, pagerSetC, pagerSetD,
} from "../engine/dw3/ui/native/folder-card-grid.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stcrddek = new Uint8Array(readFileSync(join(dir, "pro_stcrddek.bin")));
const entry = { size: stcrddek.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const G_OBJ = 0x80150000;
const C_OBJ = 0x80152000;
const L_OBJ = 0x80154000;
const POOL = 0x80170000;
const POOL_STEP = 0x200;
const RECORDS = 0x80160000;
const RECORD_STEP = 0x20;
const G_REC = 0x80168000; // a scratch cell for the card-view context pointer
const PAGER = 0x8016c000;

const S = {
    alloc: 0x0fe10000, widget: 0x0fe10004, icon: 0x0fe10008,
    drawInit: 0x0fe1000c, gpuInit: 0x0fe10010,
    d74: 0x0fe10014, d7c: 0x0fe10018, dSprite: 0x0fe1001c, d88: 0x0fe10020,
    d8c: 0x0fe10024, d94: 0x0fe10028,
    cardInit: 0x0fe1002c, cardResolve: 0x0fe10030, cardBadge: 0x0fe10034,
    cardPairA: 0x0fe10038, cardPairB: 0x0fe1003c, cardSize: 0x0fe10040,
    cardDispatch: 0x0fe10044, cardDrawCell: 0x0fe10048, cardCommit: 0x0fe1004c,
    padPressed: 0x0fe10050, padRepeat: 0x0fe10054, padKey: 0x0fe10058, padHeld: 0x0fe10090,
    sound: 0x0fe1005c, bank: 0x0fe10060, pack: 0x0fe10064, frame: 0x0fe10068,
    time: 0x0fe1006c, foldStart: 0x0fe10070, foldTick: 0x0fe10074,
    pagerLayer: 0x0fe10078, pagerPrim: 0x0fe1007c, pagerEmit: 0x0fe10080, pagerSlotFn: 0x0fe10094,
    base2c: 0x0fe10084, base38: 0x0fe10088, recount: 0x0fe1008c,
    methodBase: 0x0fe12000,
};
const METHOD_ARITY = { 0x80: 1, 0x84: 2, 0x88: 1, 0x94: 1, 0x114: 2, 0x118: 2, 0x144: 1, 0x148: 1, 0x15c: 1, 0x160: 1 };

const LOG = [];
const RNG = { s: 1 };
const next = () => { RNG.s = (Math.imul(RNG.s, 1103515245) + 12345) >>> 0; return RNG.s >>> 8; };
const CTL = { widgetN: 0, language: 2, pad: 0, frame: 100, time: 1 };
    const padBits = () => (CTL.pad === 0 ? 0 : CTL.pad === 3 ? 1 << 13 : CTL.pad === 4 ? 1 << 14 : 1 << (3 + (next() % 12)));
    const heldBits = () => (CTL.pad === 0 ? 0 : next() & ((1 << 10) | (1 << 11)));

function recordAddr(id) { return (RECORDS + (id & 0xffff) * RECORD_STEP) >>> 0; }

function widgetAt(rt, n) {
    const w = POOL + n * POOL_STEP;
    for (let i = 0; i < POOL_STEP; i += 4) rt.mem.write32(w + i, 0);
    for (const slot of Object.keys(METHOD_ARITY)) rt.mem.write32(w + Number(slot), S.methodBase + Number(slot));
    return w;
}

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(stcrddek, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    const st = (a, fn) => rt.cpu.setStub(a, fn);
    // Factories.
    st(0x80014504, (c) => { LOG.push(["alloc", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]); return PAGER; });
    st(0x8001ae38, (c) => { LOG.push(["widget", c.reg(6) | 0, c.reg(7) | 0]); return widgetAt(rt, CTL.widgetN++); });
    st(0x8001b364, (c) => { LOG.push(["icon", c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return widgetAt(rt, CTL.widgetN++); });
    // Base task methods and the folder-list recount.
    st(S.base2c, (c) => { LOG.push(["base2c", c.reg(5) | 0]); return 0; });
    st(S.base38, () => { LOG.push(["base38"]); return 0; });
    st(S.recount, () => { LOG.push(["recount"]); return 0; });
    // Widget methods.
    for (const [slot, arity] of Object.entries(METHOD_ARITY)) {
        st(S.methodBase + Number(slot), (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push([`w${Number(slot).toString(16)}`, c.reg(4) >>> 0, ...args]);
            return 0;
        });
    }
    // Draw context.
    st(0x8001f648, (c) => {
        LOG.push(["drawInit"]);
        const t = c.reg(4);
        rt.mem.write32(t + 0x74, S.d74); rt.mem.write32(t + 0x7c, S.d7c); rt.mem.write32(t + 0x84, S.dSprite);
        rt.mem.write32(t + 0x88, S.d88); rt.mem.write32(t + 0x8c, S.d8c); rt.mem.write32(t + 0x94, S.d94);
        return 0;
    });
    st(S.d74, (c) => { LOG.push(["d74", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.d7c, (c) => { LOG.push(["d7c", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.dSprite, (c) => { LOG.push(["sprite", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
    st(S.d88, (c) => { LOG.push(["d88", c.reg(4) | 0]); return 0; });
    st(S.d8c, (c) => { LOG.push(["d8c", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    st(S.d94, (c) => { LOG.push(["d94", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    // Card-view text context.
    st(0x8001ebf8, (c) => {
        LOG.push(["cardInit"]);
        const chan = c.reg(4);
        rt.mem.write32(G_REC, chan);
        for (let i = 0; i < 0x54; i += 4) rt.mem.write32(chan + i, 0);
        rt.mem.write32(chan + 0x2c, S.cardResolve);
        rt.mem.write32(chan + 0x30, S.cardCommit);
        rt.mem.write32(chan + 0x34, S.cardDrawCell);
        rt.mem.write32(chan + 0x38, S.cardDispatch);
        rt.mem.write32(chan + 0x3c, S.cardPairA);
        rt.mem.write32(chan + 0x40, S.cardPairB);
        rt.mem.write32(chan + 0x44, S.cardSize);
        rt.mem.write32(chan + 0x50, S.cardBadge);
        return 0;
    });
    st(S.cardResolve, (c) => {
        const id = c.reg(4) | 0;
        LOG.push(["cardResolve", id]);
        const chan = rt.mem.read32(G_REC) >>> 0;
        rt.mem.write32(chan, recordAddr(id));
        return 0;
    });
    st(S.cardBadge, () => { LOG.push(["cardBadge"]); const chan = rt.mem.read32(G_REC) >>> 0; const rec = rt.mem.read32(chan) >>> 0; return rt.mem.read8(rec + 0x1f) & 1; });
    st(S.cardPairA, (c) => { LOG.push(["cardPairA", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.cardPairB, (c) => { LOG.push(["cardPairB", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.cardSize, (c) => { LOG.push(["cardSize", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.cardDispatch, (c) => { LOG.push(["cardDispatch", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.cardDrawCell, (c) => { LOG.push(["cardDrawCell", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    st(S.cardCommit, () => { LOG.push(["cardCommit"]); return 0; });
    // Fold pair (F0x8008A2D8 / F0x8008A36C).
    st(0x8008a2d8, (c) => { LOG.push(["foldStart", c.reg(4) - 1 | 0, c.reg(5) | 0]); windowFoldStart(rt.mem, c.reg(4) >>> 0, c.reg(5) | 0); return 0; });
    st(0x8008a36c, (c) => { LOG.push(["foldTick", c.reg(4) - 1 | 0]); return windowFoldTick(rt.mem, c.reg(4) >>> 0); });
    // Services.
    st(S.padPressed, () => { const v = padBits(); LOG.push(["pressed", 0, v]); return v; });
    st(S.padRepeat, () => { const v = padBits(); LOG.push(["repeat", 0, v]); return v; });
    st(S.padHeld, () => { const v = heldBits(); LOG.push(["held", 0, v]); return v; });
    st(S.padKey, (c) => { LOG.push(["key", c.reg(5) | 0]); return c.reg(5) | 0; });
    st(S.sound, (c) => { LOG.push(["sound", c.reg(4) >>> 0]); return 0; });
    st(S.bank, (c) => { LOG.push(["bank", c.reg(4) | 0]); return 0x4000 + (c.reg(4) | 0); });
    st(S.pack, (c) => { LOG.push(["pack", c.reg(4) >>> 0]); return 0x8888; });
    st(S.frame, () => { const v = CTL.frame; LOG.push(["frame", v]); return v; });
    st(S.time, () => { LOG.push(["time", CTL.time]); return CTL.time; });
    st(S.pagerLayer, (c) => { LOG.push(["pagerLayer", c.reg(4) | 0]); rt.mem.write32(0x8016d400 + 0x138, S.pagerSlotFn); return 0x8016d400; });
    st(S.pagerSlotFn, (c) => { LOG.push(["pagerSlot", c.reg(5) | 0]); return 0x8016d500; });
    st(S.pagerPrim, () => { LOG.push(["pagerPrim"]); return 0x8016d100; });
    st(S.pagerEmit, (c) => { LOG.push(["pagerEmit", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]); return 0; });
    // Function-pointer cells.
    rt.mem.write32(0x8004b7d0 + 0x3f4, S.padPressed);
    rt.mem.write32(0x8004b7d0 + 0x3f8, S.padHeld);
    rt.mem.write32(0x8004b7d0 + 0x3fc, S.padRepeat);
    rt.mem.write32(0x8004b7d0 + 0x408, S.padKey);
    rt.mem.write32(0x80055c48, S.sound);
    rt.mem.write32(0x80044b38 + 0x414, S.bank);
    rt.mem.write32(0x80044b38 + 0x424, S.pack);
    rt.mem.write32(0x80044f5c, S.pack);
    rt.mem.write32(0x80044f4c, S.bank);
    rt.mem.write32(0x8004de10 + 0x188, S.frame);
    rt.mem.write32(0x8004de10 + 0x17c, S.pagerLayer);
    rt.mem.write32(0x8004de10 + 0x158, S.pagerPrim);
    rt.mem.write32(0x8004df6c, S.pagerEmit);
    rt.mem.write32(0x8004df9c, S.time);
    return rt;
}

/** The port-side host that logs the same keys as the stubs. */
function portHost(rt) {
    let currentRecord = 0;
    return {
        allocate(h, s, e) { LOG.push(["alloc", h >>> 0, s | 0, e | 0]); return PAGER; },
        baseMethod38() { LOG.push(["base38"]); },
        baseMethod2C(_o, v) { LOG.push(["base2c", v | 0]); },
        folderRecount() { LOG.push(["recount"]); },
        createWidget(target, kind, x, y) { LOG.push(["widget", x | 0, y | 0]); return widgetAt(rt, CTL.portWidgetN++); },
        spawnUiIcon(target, value, x, y) { LOG.push(["icon", value | 0, x | 0, y | 0]); return widgetAt(rt, CTL.portWidgetN++); },
        widget58(w, v) { LOG.push(["w15c", w >>> 0, v | 0]); },
        widgetBF(w, v) { LOG.push(["w160", w >>> 0, v | 0]); },
        widgetLine(w, s, i) { LOG.push(["w114", w >>> 0, s | 0, i | 0]); },
        widgetNumber(w, f, v) { LOG.push(["w118", w >>> 0, f | 0, v | 0]); },
        widgetHide(w, f) { LOG.push(["w144", w >>> 0, f | 0]); },
        widgetShow(w, f) { LOG.push(["w148", w >>> 0, f | 0]); },
        widget84(w, x, y) { LOG.push(["w84", w >>> 0, x | 0, y | 0]); },
        widget80(w, v) { LOG.push(["w80", w >>> 0, v | 0]); },
        widget88(w, v) { LOG.push(["w88", w >>> 0, v | 0]); },
        widget94(w, v) { LOG.push(["w94", w >>> 0, v | 0]); },
        initDrawContext() { LOG.push(["drawInit"]); },
        draw74(x, y) { LOG.push(["d74", x | 0, y | 0]); },
        draw7C(l, b) { LOG.push(["d7c", l | 0, b | 0]); },
        draw88(v) { LOG.push(["d88", v | 0]); },
        draw8C(a, b, c) { LOG.push(["d8c", a | 0, b | 0, c | 0]); },
        draw94(a, b) { LOG.push(["d94", a | 0, b | 0]); },
        drawSprite(p, c, x, y) { LOG.push(["sprite", p >>> 0, c | 0, x | 0, y | 0]); },
        packResolve(h) { LOG.push(["pack", h >>> 0]); return 0x8888; },
        initCardView() { LOG.push(["cardInit"]); },
        cardResolve(id) { LOG.push(["cardResolve", id | 0]); currentRecord = recordAddr(id); },
        cardBadge() { LOG.push(["cardBadge"]); return rt.mem.read8(currentRecord + 0x1f) & 1; },
        cardByte(off) { return rt.mem.read8(currentRecord + off) & 0xff; },
        cardSetPairA(x, y) { LOG.push(["cardPairA", x | 0, y | 0]); },
        cardSetPairB(x, y) { LOG.push(["cardPairB", x | 0, y | 0]); },
        cardSetSize(c, r) { LOG.push(["cardSize", c | 0, r | 0]); },
        cardDispatch(l, b) { LOG.push(["cardDispatch", l | 0, b | 0]); },
        cardDrawCell(x, y) { LOG.push(["cardDrawCell", x | 0, y | 0]); },
        cardCommit() { LOG.push(["cardCommit"]); },
        foldStart(sub, dir) { LOG.push(["foldStart", sub - 1 | 0, dir | 0]); windowFoldStart(rt.mem, sub >>> 0, dir | 0); },
        foldTick(sub) { LOG.push(["foldTick", sub - 1 | 0]); return windowFoldTick(rt.mem, sub >>> 0); },
        pagerLayerSlot(layer, bucket) { LOG.push(["pagerLayer", layer | 0]); LOG.push(["pagerSlot", bucket | 0]); return 0x8016d500; },
        pagerNewPrimitive() { LOG.push(["pagerPrim"]); return 0x8016d100; },
        pagerEmit(a0, a1, a2) { LOG.push(["pagerEmit", a0 >>> 0, a1 >>> 0, a2 >>> 0]); },
        pagerSet(bar, slot, a, b) {
            if (slot === 0x8c) pagerSetA(rt.mem, bar, a, b ?? 0);
            else if (slot === 0x90) pagerSetB(rt.mem, bar, a, b ?? 0);
            else if (slot === 0x94) pagerSetC(rt.mem, bar, a, b ?? 0);
            else pagerSetD(rt.mem, bar, a);
        },
        padPressed() { const v = padBits(); LOG.push(["pressed", 0, v]); return v; },
        padRepeat() { const v = padBits(); LOG.push(["repeat", 0, v]); return v; },
        padHeld() { const v = heldBits(); LOG.push(["held", 0, v]); return v; },
        padKey(_p, code) { LOG.push(["key", code | 0]); return code | 0; },
        playSound(id) { LOG.push(["sound", id >>> 0]); },
        resourceGet(id) { LOG.push(["bank", id | 0]); return 0x4000 + (id | 0); },
        frameCount() { LOG.push(["frame", CTL.frame]); return CTL.frame; },
        timeDelta() { LOG.push(["time", CTL.time]); return CTL.time; },
    };
}

function seedGrid(rt, c) {
    for (let i = 0; i < 0x494; i += 4) rt.mem.write32(G_OBJ + i, 0);
    for (let i = 0; i < 0xd4; i += 4) rt.mem.write32(C_OBJ + i, 0);
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(L_OBJ + i, 0);
    // The children widgets the header/rows/detail fill: valid objects with the
    // widget method slots installed, identical on both sides.
    const widgetOffsets = [0x00, 0x04, 0x08, 0x0c, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24,
        0x28, 0x2c, 0x30, 0x34, 0x38, 0x3c, 0x40, 0x44, 0x48, 0x4c, 0x50, 0x54, 0x58, 0x5c, 0x60];
    for (let i = 0; i < 8; i++) widgetOffsets.push(0x64 + i * 0xc, 0x68 + i * 0xc, 0x6c + i * 0xc);
    widgetOffsets.push(0xc4, 0xc8);
    CTL.widgetN = 0;
    CTL.portWidgetN = 0;
    for (const off of widgetOffsets) rt.mem.write32(C_OBJ + off, widgetAt(rt, CTL.widgetN++));
    CTL.widgetN = 0;
    CTL.portWidgetN = 0;
    // The two base-method slots and the folder-list recount slot.
    rt.mem.write32(G_OBJ + 0x2c, S.base2c);
    rt.mem.write32(G_OBJ + 0x38, S.base38);
    rt.mem.write32(L_OBJ + 0x11c, S.recount);
    rt.mem.write32(FOLDER_GRID_SAVE_PTR, c.language ?? 2);
    const set = (off, v) => rt.mem.write32(G_OBJ + off, v | 0);
    set(G.layer, 0x1000); set(G.bucket, 6); set(G.folder, c.folder ?? 1);
    set(G.state, c.state ?? 1); set(G.taskState, c.taskState ?? 1);
    set(G.col, c.col ?? 3); set(G.row, c.row ?? 2);
    set(G.cursorOn, c.cursorOn ?? 1); set(G.listTop, c.listTop ?? 0); set(G.listCursor, c.listCursor ?? 0);
    set(G.listCount, c.listCount ?? 0); set(G.messageSel, c.messageSel ?? 1); set(G.messageTimer, c.messageTimer ?? 0);
    set(G.flag14, c.flag14 ?? 0); set(G.flag18, 0); set(G.scrollBlink, c.scrollBlink ?? 0); set(G.scrollBlinkTime, c.scrollBlinkTime ?? 0);
    set(0x50, L_OBJ); set(0x68, c.frame ?? 0); set(0x6c, c.frameTime ?? 0);
    set(G.foldWindow, 0xa); set(G.foldMsg, 0xa); set(G.foldList, 0xa); set(G.foldListMsg, 0xa); set(G.foldWarn, 0xa);
    rt.mem.write32(G_OBJ + G.foldWindow + 0xc, c.foldWindowActive ?? 0);
    rt.mem.write32(G_OBJ + G.foldList + 0xc, c.foldListActive ?? 0);
    rt.mem.write32(G_OBJ + G.foldWarn + 0xc, c.foldWarnActive ?? 0);
    // The folder list's colour counters for the edited folder.
    for (let f = 0; f < 3; f++) for (let i = 0; i < 6; i++) {
        rt.mem.write32(L_OBJ + Math.imul(f, 0x18) + 0x74 + i * 4, (f * 6 + i + 1) | 0);
    }
    // The three folder records and the owned counts.
    for (let f = 0; f < 3; f++) {
        for (let i = 0; i < 40; i++) {
            rt.mem.write16(FOLDER_SLOTS_BASE + Math.imul(f, FOLDER_SLOT_STRIDE) + i * 2, (c.slots?.[f]?.[i] ?? ((f === 1 ? 5 : 2) + i)) & 0xffff);
        }
    }
    for (let id = 0; id < FOLDER_CARD_MAX; id++) {
        rt.mem.write8(FOLDER_OWNED_BASE + FOLDER_OWNED_OFF + id, (c.owned?.[id] ?? 3) & 0xff);
    }
    // The available table and the remaining bytes the machine reads.
    for (let i = 0; i < FOLDER_CARD_MAX; i++) {
        rt.mem.write16(G_OBJ + G.avail + i * 2, (c.avail?.[i] ?? (i + 1)) & 0xffff);
        rt.mem.write8(G_OBJ + G.remain + i, (c.remain?.[i] ?? 2) & 0xff);
    }
    // The card-view record table.
    for (let id = 0; id <= FOLDER_CARD_MAX; id++) {
        for (let k = 0; k < RECORD_STEP; k++) rt.mem.write8(recordAddr(id) + k, (id * 7 + k) & 0xff);
    }
    CTL.widgetN = 0;
    CTL.portWidgetN = 0;
    CTL.pad = c.pad ?? 0;
    CTL.frame = c.frameNow ?? 100;
    CTL.time = c.time ?? 1;
    RNG.s = c.seed ?? 7;
}

function snapshot(rt) {
    const out = [];
    for (let i = 0; i < 0x494; i += 4) out.push(rt.mem.read32(G_OBJ + i) >>> 0);
    for (let i = 0; i < 0xd4; i += 4) out.push(rt.mem.read32(C_OBJ + i) >>> 0);
    for (let f = 0; f < 3; f++) for (let i = 0; i < 40; i++) out.push(rt.mem.read16(FOLDER_SLOTS_BASE + Math.imul(f, FOLDER_SLOT_STRIDE) + i * 2) & 0xffff);
    return out;
}

let RT;
let host;
function compare(name, c, runOrig, runPort) {
    RT = RT ??= runtime();
    host = host ?? portHost(RT);
    seedGrid(RT, c);
    if (c.__before) c.__before();
    LOG.length = 0;
    runOrig(RT, c);
    const olog = LOG.slice();
    const osnap = snapshot(RT);
    seedGrid(RT, c);
    if (c.__before) c.__before();
    LOG.length = 0;
    runPort(RT, c);
    if (!sameLog(LOG, olog)) {
        for (let i = 0; i < Math.max(LOG.length, olog.length); i++) {
            const a = JSON.stringify(olog[i]); const b = JSON.stringify(LOG[i]);
            if (a !== b) { console.error(`[compare ${name}] first diff idx ${i}: O ${a} P ${b}`); break; }
        }
    }
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snapshot(RT), osnap, `${name}: memory`);
    return { log: olog, snap: osnap };
}
function sameLog(a, b) { return a.length === b.length && a.every((v, i) => JSON.stringify(v) === JSON.stringify(b[i])); }

const ORIG = {
    tick: (o, c) => RT.cpu.call(0x80086574, [G_OBJ, C_OBJ], 400000),
    chrome: (o, c) => RT.cpu.call(0x8008397c, [G_OBJ, C_OBJ], 400000),
    machine: (o, c) => RT.cpu.call(0x80085210, [G_OBJ, C_OBJ], 400000),
    draw: (o, c) => RT.cpu.call(0x80084890, [G_OBJ], 400000),
    slots: (o, c) => RT.cpu.call(0x800835d8, [G_OBJ], 400000),
    dealIn: (o, c) => RT.cpu.call(0x800837b4, [G_OBJ], 400000),
    objTick: (o, c) => RT.cpu.call(0x800838c4, [G_OBJ], 400000),
    createObjs: (o, c) => RT.cpu.call(0x80083934, [G_OBJ], 400000),
    header: (o, c) => RT.cpu.call(0x80083d28, [G_OBJ, C_OBJ, c.show ?? 1], 400000),
    swapRows: (o, c) => RT.cpu.call(0x80084278, [G_OBJ, C_OBJ, c.show ?? 1], 400000),
    detail: (o, c) => RT.cpu.call(0x80084440, [G_OBJ, C_OBJ, c.show ?? 1], 400000),
    table: (o, c) => RT.cpu.call(0x800847c0, [G_OBJ], 400000),
    pagerCreate: (o, c) => RT.cpu.call(0x80088ac8, [], 400000),
    pagerTick: (o, c) => RT.cpu.call(0x800888b0, [PAGER, 0], 400000),
};
const PORT = {
    tick: (o, c) => folderCardGridTick(RT.mem, G_OBJ, C_OBJ, host),
    chrome: (o, c) => folderGridCreateChrome(RT.mem, G_OBJ, C_OBJ, host),
    machine: (o, c) => folderCardGridMachine(RT.mem, G_OBJ, C_OBJ, host),
    draw: (o, c) => folderCardGridDraw(RT.mem, G_OBJ, host),
    slots: (o, c) => folderGridDrawSlots(RT.mem, G_OBJ, host),
    dealIn: (o, c) => folderGridDealIn(RT.mem, G_OBJ, host),
    objTick: (o, c) => folderGridObjectsTick(RT.mem, G_OBJ, host),
    createObjs: (o, c) => folderGridCreateObjects(RT.mem, G_OBJ, host),
    header: (o, c) => folderEditorHeader(RT.mem, G_OBJ, C_OBJ, c.show ?? 1, host),
    swapRows: (o, c) => folderSwapRowsFill(RT.mem, G_OBJ, C_OBJ, c.show ?? 1, host),
    detail: (o, c) => folderDetailPanel(RT.mem, G_OBJ, C_OBJ, c.show ?? 1, host),
    table: (o, c) => folderWorkingTable(RT.mem, G_OBJ, host),
    pagerCreate: (o, c) => folderPagerCreate(RT.mem, host),
    pagerTick: (o, c) => folderPagerTick(RT.mem, PAGER, host),
};

test("folderWorkingTable matches F0x800847C0", () => {
    for (const c of [{ folder: 0 }, { folder: 1 }, { folder: 2, owned: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, 0])) }]) {
        compare(`table folder${c.folder}`, c, ORIG.table, PORT.table);
    }
});

test("folderGridCreateObjects matches F0x80083934", () => {
    compare("createObjs", {}, ORIG.createObjs, PORT.createObjs);
});

test("folderGridCreateChrome matches F0x8008397C", () => {
    compare("chrome", {}, ORIG.chrome, PORT.chrome);
});

test("folderGridDrawSlots / folderGridDealIn match F0x800835D8 / F0x800837B4", () => {
    for (const count of [0, 1, 5, 11, 40]) {
        compare(`slots ${count}`, { listCount: count }, ORIG.slots, PORT.slots);
        compare(`dealIn ${count}`, { listCount: count }, ORIG.dealIn, PORT.dealIn);
    }
});

test("folderGridObjectsTick matches F0x800838C4", () => {
    for (const s of [0, 1, 2, 3]) compare(`objTick state${s}`, { state: s }, ORIG.objTick, PORT.objTick);
});

test("folderEditorHeader matches F0x80083D28", () => {
    for (const show of [0, 1]) {
        for (const sel of [0, 1]) {
            for (const timer of [0, 0x40]) {
                for (const card of [1, 0x45, 0x70]) {
                    compare(`header s${show} sel${sel} t${timer} card${card}`,
                        { show, messageSel: sel, messageTimer: timer, folder: 1, slots: { 1: Array.from({ length: 40 }, (_, i) => (i === 11 ? card : i + 1)) } },
                        ORIG.header, PORT.header);
                }
            }
        }
    }
});

test("folderSwapRowsFill / folderDetailPanel match F0x80084278 / F0x80084440", () => {
    for (const show of [0, 1]) {
        for (const count of [0, 3, 40]) {
            compare(`rows s${show} n${count}`, { show, listCount: count }, ORIG.swapRows, PORT.swapRows);
            compare(`detail s${show} n${count}`, { show, listCount: count }, ORIG.detail, PORT.detail);
        }
    }
});

test("folderPagerCreate / folderPagerTick match F0x80088AC8 / F0x800888B0", () => {
    compare("pagerCreate", {}, ORIG.pagerCreate, PORT.pagerCreate);
    const shapes = [
        { state: 0, a78: 1, a68: 1, a7c: 0, a80: 0x50, a70: 8, a6c: 6, a74: 0, a58: 0x10, a60: 0x30, a64: 0x40 },
        { state: 1, a74: 3, a70: 8, a7c: 0, a80: 0x50, a88: 0x10, a64: 0x40, a58: 0x10, a60: 0x30 },
        { state: 1, a74: 8, a70: 8, a7c: 0, a80: 0x50, a88: 0x10, a64: 0x40, a58: 0x10, a60: 0x30 },
        { state: 2, a78: 1, a68: 1, a7c: 0, a80: 0x50, a70: 8, a6c: 6 },
        { state: 5, a78: 1, a68: 1, a7c: 0, a80: 0x50, a70: 8, a6c: 6 },
    ];
    for (const [i, s] of shapes.entries()) {
        const setup = (rt) => {
            for (let k = 0; k < 0xa0; k += 4) rt.mem.write32(PAGER + k, 0);
            for (let k = 0x8016d100; k < 0x8016d600; k += 4) rt.mem.write32(k, 0);
            for (const [name, off] of Object.entries({ state: 0x0c, a58: 0x58, a60: 0x60, a64: 0x64, a68: 0x68, a6c: 0x6c, a70: 0x70, a74: 0x74, a78: 0x78, a7c: 0x7c, a80: 0x80, a88: 0x88 })) rt.mem.write32(PAGER + off, s[name] | 0);
            rt.mem.write32(PAGER + 0x50, 0x1000); rt.mem.write32(PAGER + 0x54, 3);
            rt.cpu.setStub(S.methodBase + 0x38, () => { LOG.push(["base38"]); return 0; });
            rt.mem.write32(PAGER + 0x38, S.methodBase + 0x38);
        };
        const snapPager = () => {
            const out = [];
            for (let k = 0; k < 0xa0 / 4; k++) out.push(RT.mem.read32(PAGER + k * 4) >>> 0);
            for (let k = 0x8016d100; k < 0x8016d140; k += 4) out.push(RT.mem.read32(k) >>> 0);
            out.push(RT.mem.read32(0x8016d500) >>> 0);
            return out;
        };
        RT ??= runtime();
        seedGrid(RT, {});
        setup(RT);
        LOG.length = 0;
        ORIG.pagerTick(RT, s);
        const olog = LOG.slice();
        const osnap = snapPager();
        seedGrid(RT, {});
        setup(RT);
        LOG.length = 0;
        PORT.pagerTick(RT, s);
        if (!sameLog(LOG, olog)) {
            for (let k = 0; k < Math.max(LOG.length, olog.length); k++) {
                const a = JSON.stringify(olog[k]); const b = JSON.stringify(LOG[k]);
                if (a !== b) { console.error(`[pagerTick ${i}] first diff idx ${k}: O ${a} P ${b}`); break; }
            }
        }
        assert.deepEqual(LOG, olog, `pagerTick ${i}: calls`);
        const psnap = snapPager();
        if (!psnap.every((v, k) => v === osnap[k])) {
            for (let k = 0; k < psnap.length; k++) {
                if (psnap[k] !== osnap[k]) console.error(`[pagerTick ${i} mem] idx ${k} (0x${(k * 4).toString(16)}): O ${osnap[k].toString(16)} P ${psnap[k].toString(16)}`);
            }
        }
        assert.deepEqual(psnap, osnap, `pagerTick ${i}: memory`);
    }
});

test("folderCardGridTick matches F0x80086574", () => {
    for (const state of [0, 1, 2, 3]) compare(`tick state${state}`, { taskState: state, state: 1 }, ORIG.tick, PORT.tick);
});

test("folderCardGridMachine matches F0x80085210 across states", () => {
    const states = [0, 1, 2, 5, 0xa, 0xb, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1e, 0x1f, 0x20, 0x32, 0x33, 0x3c, 0x3d, 0x3e, 0x3f];
    const seen = new Set();
    for (let n = 0; n < 900; n++) {
        RNG.s = n * 104729 + 13;
        const state = states[next() % states.length];
        const c = {
            state, folder: next() % 3, col: next() % 15, row: next() % 5,
            cursorOn: next() % 2, listTop: next() % 9, listCursor: next() % 9, listCount: next() % 12,
            messageSel: next() % 2, messageTimer: next() % 0x80, pad: 1 + (next() % 4), seed: n + 1,
            foldWindowActive: next() % 2, foldListActive: next() % 2, foldWarnActive: next() % 2,
            frameNow: 100 + (next() % 40), time: next() % 3 === 0 ? 0 : 1,
            avail: Array.from({ length: FOLDER_CARD_MAX }, (_, i) => (next() % 4 === 0 ? 0 : i + 1)),
            remain: Array.from({ length: FOLDER_CARD_MAX }, () => next() % 5),
        };
        c.__before = () => { RT.mem.write32(C_OBJ + C.gridObject, G_OBJ2); RT.mem.write32(G_OBJ2 + O.taskState, next() % 3); };
        compare(`machine #${n} state${state.toString(16)}`, c, ORIG.machine, PORT.machine);
        seen.add(state);
    }
    for (const s of states) assert.ok(seen.has(s), `coverage: state ${s.toString(16)} reached`);
});

const G_OBJ2 = 0x80159000;
