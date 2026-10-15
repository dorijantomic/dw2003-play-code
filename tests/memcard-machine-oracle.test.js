// Phase 4 oracle: engine/dw3/ui/memcard-machine.ts's memcardStateMachine must
// match pro/stgmcard F0x80084DCC (9624 bytes, 38 states). The original runs
// through engine/native on the shipped pro_stgmcard.bin + resident.bin with the
// pad, sound, bank, card and board services, the four overlay helpers and every
// widget method stubbed to a logging stub; the port runs against the same memory
// and a host that logs the identical call stream. Every state is driven under
// three seed variants, and the calls plus the touched memory are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { MEMCARD, MEMCARD_W, memcardStateMachine } from "../engine/dw3/ui/memcard-machine.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stgmcard.bin")));
const host0 = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const FN = 0x80084dcc;
const SCREEN = 0x80100000;
const WIDGETS = 0x80110000;
const SUB = 0x80120000;
const TRANS = 0x80121000;
const VIEW = 0x80122000;
const PANEL = 0x80123000;
const OBJ = 0x80130000;
const REC = 0x80124000;
const BUF = 0x80125000;
const LOADED = 0x80088774;
const STAGE = 0x80088768;
const CARD = 0x80048d34;
const BLOCK = 0x26c4;

const rt = new NativeStageRuntime(overlay, entry, host0(), undefined, undefined, 0x80082cb0, {
    image: resident,
    base: 0x80010000,
});

// Every widget method the machine can reach, with the number of arguments the
// original actually sets for it (later register values are leftovers and are
// not compared).
const ARGC = {
    0x80: 1, 0x84: 2, 0x88: 0, 0x8c: 0,
    0xc4: 0, 0xc8: 2, 0xcc: 3, 0xd0: 3,
    0xdc: 0, 0xe0: 0, 0xe4: 1, 0xe8: 0, 0xec: 0, 0xf0: 0,
    0x114: 2, 0x118: 2, 0x134: 2, 0x144: 1, 0x15c: 1,
};
const SLOTS = {
    cursor: [0x80, 0x84, 0x114, 0x118, 0x134, 0x144, 0x15c],
    transition: [0xc4, 0xc8, 0xcc, 0xd0, 0x114, 0x118, 0x134, 0x144, 0x15c],
    view: [0xdc, 0xe0, 0xe4, 0xe8, 0xec, 0xf0, 0x114, 0x118, 0x134, 0x144, 0x15c],
    panel: [0x84, 0x88, 0x8c, 0x114, 0x118, 0x134, 0x144, 0x15c],
    plain: [0x114, 0x118, 0x134, 0x144, 0x15c],
};

let CELL = 0x0fe30000;
const STUB = {};
for (const [slot, n] of Object.entries(ARGC)) {
    const cell = CELL;
    CELL += 0x10;
    rt.cpu.setStub(cell, (c) => {
        const args = [];
        for (let i = 0; i < n; i++) args.push(c.reg(5 + i) | 0);
        EVENTS.push(["w" + Number(slot).toString(16), c.reg(4) | 0, ...args]);
        return 0;
    });
    STUB[slot] = cell;
}

const CFG = {
    checksum: 0,
    statusList: 1,
    statusA: 1, statusB: 1, statusC: 1, statusD: 1,
    svc33c: 1, svc340: 1,
    checksum: 0, verify: 0, enumerate: 0, freeBlocks: 0,
    roster: 0, tween: 1, pad: 1 << 0xd,
};
// The service slots live in the card struct at 0x80048750: +0x338 status A,
// +0x33C the header/block transfer, +0x340 the block/file read, +0x344 status B,
// +0x348 status D, +0x34C status C, +0x358 the checksum. The struct's own data
// fields (+0xA4 file-record count, +0xC0 per-record block usage, +0x314 file
// count, +0x318 file table, +0x324 file index) are memory, not calls.
const cells = {
    bank: 0x0fe31000, sound: 0x0fe31004,
    padPressed: 0x0fe31008, padRepeat: 0x0fe3100c, padKey: 0x0fe31010,
    memZero: 0x0fe31014, saveCard: 0x0fe31018, transition: 0x0fe3101c,
    caption: 0x0fe31020, teardown: 0x0fe31024, hideStep: 0x0fe31028,
    roster: 0x0fe31068, tween: 0x0fe3106c,
};
const CARD_STRUCT = 0x80048750;
const SVC = {
    statusList: { cell: CARD_STRUCT + 0x334, code: 0x0fe320b0 },
    statusA: { cell: CARD_STRUCT + 0x338, code: 0x0fe32000 },
    svc33c: { cell: CARD_STRUCT + 0x33c, code: 0x0fe32010 },
    svc340: { cell: CARD_STRUCT + 0x340, code: 0x0fe32020 },
    statusB: { cell: CARD_STRUCT + 0x344, code: 0x0fe32030 },
    statusD: { cell: CARD_STRUCT + 0x348, code: 0x0fe32040 },
    statusC: { cell: CARD_STRUCT + 0x34c, code: 0x0fe32050 },
    checksum: { cell: CARD_STRUCT + 0x358, code: 0x0fe32060 },
};
function installService(name, fn) {
    rt.cpu.setStub(SVC[name].code, fn);
    rt.mem.write32(SVC[name].cell, SVC[name].code);
}
let EVENTS = [];
const LOG = [];

// `argc` is the number of arguments the original actually sets for that call;
// the remaining registers hold leftovers and are not part of the contract.
function plain(name, ret, argc) {
    return (c) => {
        const args = [];
        for (let i = 0; i < argc; i++) args.push(c.reg(4 + i) | 0);
        EVENTS.push([name, ...args]);
        return typeof ret === "function" ? ret(c) : ret;
    };
}

rt.cpu.setStub(cells.bank, plain("bank", 0x22220000, 1));
rt.cpu.setStub(cells.sound, plain("sound", 0, 1));
rt.cpu.setStub(cells.padPressed, plain("padPressed", () => CFG.pad | 0, 1));
rt.cpu.setStub(cells.padRepeat, plain("padRepeat", () => CFG.pad | 0, 1));
rt.cpu.setStub(cells.padKey, (c) => { EVENTS.push(["padKey", c.reg(4) | 0, c.reg(5) | 0]); return c.reg(5) | 0; });
rt.cpu.setStub(cells.memZero, plain("memZero", 0, 2));
rt.cpu.setStub(cells.saveCard, plain("saveCard", PANEL, 1));
rt.cpu.setStub(cells.transition, plain("transition", TRANS, 4));
rt.cpu.setStub(cells.caption, plain("caption", 0, 3));
rt.cpu.setStub(cells.teardown, plain("teardown", 0, 2));
rt.cpu.setStub(cells.hideStep, plain("hideStep", 0, 2));
installService("statusList", plain("statusList", () => CFG.statusList, 1));
installService("statusA", plain("statusA", () => CFG.statusA, 1));
installService("statusB", plain("statusB", () => CFG.statusB, 1));
installService("statusC", plain("statusC", () => CFG.statusC, 1));
installService("statusD", plain("statusD", () => CFG.statusD, 1));
installService("svc33c", plain("svc33c", () => CFG.svc33c, 4));
installService("svc340", plain("svc340", () => CFG.svc340, 4));
installService("checksum", plain("checksum", () => CFG.checksum, 2));
rt.cpu.setStub(cells.roster, plain("roster", () => CFG.roster, 1));
rt.cpu.setStub(cells.tween, (c) => { EVENTS.push(["tween", c.reg(4) | 0]); return CFG.tween; });

rt.mem.write32(0x80044f4c, cells.bank);
rt.mem.write32(0x80055c48, cells.sound);
rt.mem.write32(0x8004b7d0 + 0x3f4, cells.padPressed);
rt.mem.write32(0x8004b7d0 + 0x3fc, cells.padRepeat);
rt.mem.write32(0x8004b7d0 + 0x408, cells.padKey);
rt.mem.write32(0x8004b600, cells.memZero);
rt.mem.write32(0x80088310 + 4, 0x11110000);
rt.mem.write32(0x8008879c, cells.tween);
rt.mem.write32(0x80048d34 + 0x2718, cells.roster);
rt.mem.write32(BUF + 0x760, 0x0a0b0c0d);
// The screen object's own method fields: +0x30 (called with a0 = 0), +0x3C, and
// the accept/refresh hooks at +0x2854/+0x2858 (called with a0 = the screen).
const SCR = { 0x30: 0x0fe32070, 0x3c: 0x0fe32080, 0x2854: 0x0fe32090, 0x2858: 0x0fe320a0 };
for (const [slot, addr] of Object.entries(SCR)) {
    rt.cpu.setStub(addr, (c) => {
        // Every one of these four is called with a single argument (the screen,
        // or 0 for +0x30); the second register is a leftover.
        EVENTS.push(["screen" + Number(slot).toString(16), c.reg(4) | 0]);
        return 0;
    });
}
rt.cpu.setStub(0x80083b6c, plain("saveCard", PANEL, 1));
rt.cpu.setStub(0x80084058, plain("transition", TRANS, 4));
rt.cpu.setStub(0x80084a80, plain("caption", 0, 3));
rt.cpu.setStub(0x80084b20, plain("teardown", 0, 2));
rt.cpu.setStub(0x80084bf8, plain("hideStep", 0, 2));

const portHost = {
    tweenTick(obj) { EVENTS.push(["tween", obj | 0]); return CFG.tween; },
    bankGet(id) { EVENTS.push(["bank", id | 0]); return 0x22220000; },
    playSound(id) { EVENTS.push(["sound", id | 0]); },
    padPressed(port) { EVENTS.push(["padPressed", port | 0]); return CFG.pad | 0; },
    padRepeat(port) { EVENTS.push(["padRepeat", port | 0]); return CFG.pad | 0; },
    padKey(port, code) { EVENTS.push(["padKey", port | 0, code | 0]); return code | 0; },
    widgetCall(widget, slot, args) { EVENTS.push(["w" + slot.toString(16), widget | 0, ...args.map((a) => a | 0)]); return 0; },
    screenCall(screen, slot, args) { EVENTS.push(["screen" + slot.toString(16), screen | 0, ...args.map((a) => a | 0)]); return 0; },
    createSaveCard(screen) { EVENTS.push(["saveCard", screen | 0]); return PANEL; },
    createSlotTransition(a, b, c, d) { EVENTS.push(["transition", a | 0, b | 0, c | 0, d | 0]); return TRANS; },
    messageSlotCaption(screen, widgets, flag) { EVENTS.push(["caption", screen | 0, widgets | 0, flag | 0]); },
    memcardTeardown(screen, widgets) { EVENTS.push(["teardown", screen | 0, widgets | 0]); },
    memcardHideStep(screen, widgets) { EVENTS.push(["hideStep", screen | 0, widgets | 0]); },
    memZero(dst, bytes) { EVENTS.push(["memZero", dst | 0, bytes | 0]); },
    cardStatusList(h) { EVENTS.push(["statusList", h | 0]); return CFG.statusList; },
    cardStatusA(h) { EVENTS.push(["statusA", h | 0]); return CFG.statusA; },
    cardStatusB(h) { EVENTS.push(["statusB", h | 0]); return CFG.statusB; },
    cardStatusC(h) { EVENTS.push(["statusC", h | 0]); return CFG.statusC; },
    cardStatusD(h) { EVENTS.push(["statusD", h | 0]); return CFG.statusD; },
    cardService33c(h, b, l, a) { EVENTS.push(["svc33c", h | 0, b | 0, l | 0, a | 0]); return CFG.svc33c; },
    cardService340(h, b, l, a) { EVENTS.push(["svc340", h | 0, b | 0, l | 0, a | 0]); return CFG.svc340; },
    checksum(b, l) { EVENTS.push(["checksum", b | 0, l | 0]); return CFG.checksum; },
    rosterSlot(i) { EVENTS.push(["roster", i | 0]); return CFG.roster; },
};

const STATES = [0, 1, 2, 0x0a, 0x0b, 0x0c, 0x14, 0x15, 0x16, 0x1e, 0x1f, 0x20, 0x21, 0x28, 0x32,
    0x33, 0x34, 0x35, 0x46, 0x47, 0x5a, 0x64, 0x65, 0x6e, 0x6f, 0x78, 0x79, 0x7a, 0x7b, 0x7c,
    0x7d, 0x190, 0x191, 0x1f4, 0x1f5, 0x1f6, 0x258, 0x259];
const VARIANTS = [
    { name: "save", mode: 0, result: 0, row: 0, transFlag: 1, viewState: 6, viewMode: 0, tween: 1, pad: 1 << 0xd, services: 1 },
    { name: "load", mode: 1, result: 1, row: 1, transFlag: 1, viewState: 6, viewMode: 1, tween: 1, pad: 1 << 0xe, services: 1 },
    { name: "waiting", mode: 0, result: 6, row: 0, transFlag: 0, viewState: 0, viewMode: 2, tween: 0, pad: (1 << 4) | (1 << 6), services: 0 },
    // The error branches: a card status of 2 (state 0x0a advances by two), a
    // nonzero checksum that is not a subset of the stored byte (states 0x16 and
    // 0x47), the result-5 block count (state 0x64), the third file (state 0x7B
    // finalize) and the awaiting block view (0x5A mode 3).
    { name: "errors", mode: 0, result: 5, row: 1, transFlag: 1, viewState: 0, viewMode: 3, tween: 1,
      pad: 1 << 0xd, services: 2, checksum: 0xff, fileIndex: 3, recordCount: 2 },
    // The tagged-record checksum path (state 0x16) and the exact block-count
    // boundary (total + 4 == 0x10 -> state 0x64 takes the "enough blocks" arm).
    { name: "tagged", mode: 0, result: 1, row: 0, transFlag: 1, viewState: 6, viewMode: 0, tween: 1,
      pad: 1 << 0xd, services: 1, checksum: 0xff, fileIndex: 3, recordCount: 2, tag: true,
      blocks: [0x18000, 0] },
    // The block-count boundary: the two records sum to 12, so total + 4 is
    // exactly 0x10 and the "enough blocks" arm runs.
    { name: "blocks", mode: 0, result: 5, row: 0, transFlag: 1, viewState: 6, viewMode: 0, tween: 1,
      pad: 1 << 0xd, services: 1, checksum: 0, fileIndex: 2, recordCount: 2, blocks: [0x18000, 0] },
];

const REGIONS = [
    ["screen", SCREEN, 0x2860], ["widgets", WIDGETS, 0x40], ["sub", SUB, 0x80],
    ["trans", TRANS, 0x120], ["view", VIEW, 0x120], ["panel", PANEL, 0x120],
    ["stage", STAGE, 0x40], ["loaded", LOADED, 0xd4], ["buf", BUF, BLOCK],
    ["rec", REC, 0xd0], ["card", CARD, 0x100],
];

function digest() {
    return REGIONS.map(([name, addr, len]) => {
        let h = 2166136261;
        for (let i = 0; i < len; i++) {
            h ^= rt.mem.read8(addr + i) & 0xff;
            h = Math.imul(h, 16777619) >>> 0;
        }
        return `${name}:${h.toString(16)}`;
    });
}

function seed(state, variant) {
    EVENTS = [];
    LOG.length = 0;
    for (let i = 0; i < 0x2860; i += 4) rt.mem.write32(SCREEN + i, 0);
    for (const addr of [WIDGETS, SUB, TRANS, VIEW, PANEL, OBJ, REC]) {
        for (let i = 0; i < 0x120; i += 4) rt.mem.write32(addr + i, 0);
    }
    for (let i = 0; i < BLOCK; i += 4) rt.mem.write32(BUF + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(STAGE + i, 0);
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(CARD + i, 0);
    CFG.statusA = variant.services;
    CFG.statusList = variant.services;
    CFG.statusB = variant.services;
    CFG.statusC = variant.services;
    CFG.statusD = variant.services;
    CFG.svc33c = variant.services;
    CFG.svc340 = variant.services;
    CFG.checksum = variant.checksum ?? 0;
    CFG.tween = variant.tween;
    CFG.pad = variant.pad;

    rt.mem.write32(0x8008879c, cells.tween);
    rt.mem.write32(0x80044f4c, cells.bank);
    rt.mem.write32(0x80055c48, cells.sound);
    rt.mem.write32(0x8004b7d0 + 0x3f4, cells.padPressed);
    rt.mem.write32(0x8004b7d0 + 0x3fc, cells.padRepeat);
    rt.mem.write32(0x8004b7d0 + 0x408, cells.padKey);
    rt.mem.write32(0x8004b600, cells.memZero);
    rt.mem.write32(0x80048d34 + 0x2718, cells.roster);
    for (const svc of Object.values(SVC)) rt.mem.write32(svc.cell, svc.code);
    // The card struct's data fields.
    rt.mem.write32(CARD_STRUCT + 0x314, 4);
    rt.mem.write32(CARD_STRUCT + 0x318, 0x80127000);
    rt.mem.write32(CARD_STRUCT + 0x324, variant.fileIndex ?? 2);
    rt.mem.write32(CARD_STRUCT + 0xa4, variant.recordCount ?? 2);
    const blocks = variant.blocks ?? [0x4000, 0x2000];
    rt.mem.write32(CARD_STRUCT + 0xc0, blocks[0]);
    rt.mem.write32(CARD_STRUCT + 0x28 + 0xc0, blocks[1]);
    if (variant.tag) rt.mem.write32(REC + 4, 0x33574d44);
    // The screen object.
    rt.mem.write32(SCREEN + 0x30, SCR[0x30]);
    rt.mem.write32(SCREEN + 0x3c, SCR[0x3c]);
    rt.mem.write32(SCREEN + 0x2854, SCR[0x2854]);
    rt.mem.write32(SCREEN + 0x2858, SCR[0x2858]);
    rt.mem.write32(SCREEN + 0x10, state);
    rt.mem.write32(SCREEN + 0x14, 0x20);
    rt.mem.write32(SCREEN + 0x50, SUB);
    rt.mem.write32(SCREEN + 0x64, 0x1234);
    rt.mem.write32(SCREEN + 0x68, variant.result);
    rt.mem.write32(SCREEN + 0x6c, OBJ);
    rt.mem.write32(SCREEN + 0x2804, variant.row);
    rt.mem.write32(SCREEN + 0x2824, 0x80129000);
    rt.mem.write32(SCREEN + 0x2810, 0x10);
    rt.mem.write32(SCREEN + 0x282c, 0x20);
    rt.mem.write32(SCREEN + 0x2850, 1);
    // The screen's sub-object fields.
    rt.mem.write32(SUB + 0x50, variant.mode);
    rt.mem.write32(SUB + 0x68, 0x11);
    rt.mem.write32(SUB + 0x6c, 0x22);
    // The widget block and its sub-objects.
    rt.mem.write32(WIDGETS + MEMCARD_W.header, OBJ + 0x0000);
    rt.mem.write32(WIDGETS + MEMCARD_W.body, OBJ + 0x0100);
    rt.mem.write32(WIDGETS + MEMCARD_W.strip, OBJ + 0x0200);
    rt.mem.write32(WIDGETS + MEMCARD_W.yes, OBJ + 0x0300);
    rt.mem.write32(WIDGETS + MEMCARD_W.no, OBJ + 0x0400);
    rt.mem.write32(WIDGETS + MEMCARD_W.line, OBJ + 0x0500);
    rt.mem.write32(WIDGETS + MEMCARD_W.cursor, OBJ + 0x0600);
    rt.mem.write32(WIDGETS + MEMCARD_W.transition, TRANS);
    rt.mem.write32(WIDGETS + MEMCARD_W.blockView, VIEW);
    rt.mem.write32(WIDGETS + MEMCARD_W.saveCard, PANEL);
    const kinds = [
        [OBJ + 0x0000, SLOTS.plain], [OBJ + 0x0100, SLOTS.plain], [OBJ + 0x0200, SLOTS.plain],
        [OBJ + 0x0300, SLOTS.plain], [OBJ + 0x0400, SLOTS.plain], [OBJ + 0x0500, SLOTS.plain],
        [OBJ + 0x0600, SLOTS.cursor], [TRANS, SLOTS.transition], [VIEW, SLOTS.view], [PANEL, SLOTS.panel],
    ];
    for (const [addr, slots] of kinds) {
        for (const slot of slots) rt.mem.write32(addr + slot, STUB[slot]);
    }
    rt.mem.write32(TRANS + 0x10, 0);
    rt.mem.write32(TRANS + 0x68, variant.transFlag);
    rt.mem.write32(VIEW + 0x10, variant.viewState);
    rt.mem.write32(VIEW + 0xcc, variant.viewMode);
    rt.mem.write32(PANEL + 0x5c, 0);
    rt.mem.write32(PANEL + 0x60, 0);
    // The shared staging block.
    rt.mem.write32(STAGE + 0x00, 2);
    rt.mem.write32(STAGE + 0x04, 1);
    rt.mem.write32(STAGE + 0x0c, REC);
    rt.mem.write32(STAGE + 0x10, BUF);
    rt.mem.write32(REC + 0x08, variant.services);
    rt.mem.write32(REC + 0x44 + 0x08, variant.services);
    // A few card bytes so the state 0x33 copy and checksum see data.
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(CARD + i, 0x01020304 + i);
    for (let i = 0; i < 8; i++) rt.mem.write32(BUF + 0x760 + i * 4, 0x0a0b0c0d + i);

    EVENTS = [];
    LOG.length = 0;
}

test("memcardStateMachine matches F0x80084DCC in every state", () => {
    for (const variant of VARIANTS) {
        for (const state of STATES) {
            seed(state, variant);
            const oracleErr = (() => { try { rt.cpu.call(FN, [SCREEN, WIDGETS, 0x26c4], 400000); return null; } catch (e) { return String(e).slice(0, 100); } })();
            const oracleRaw = EVENTS.map((e) => e.slice());
            const oracleEvents = EVENTS.map((e) => e.map((v) => v | 0));
            const oracleDigest = digest();
            const oracleMem = {};
            for (const [name, addr, len] of REGIONS) {
                const bytes = [];
                for (let i = 0; i < len; i++) bytes.push(rt.mem.read8(addr + i));
                oracleMem[name] = bytes;
            }
            const oracleState = rt.mem.read32(SCREEN + MEMCARD.state) | 0;

            seed(state, variant);
            const portErr = (() => { try { memcardStateMachine(rt.mem, SCREEN, WIDGETS, 0x26c4, portHost); return null; } catch (e) { return String(e).slice(0, 100); } })();
            const portRaw = EVENTS.map((e) => e.slice());
            const portEvents = EVENTS.map((e) => e.map((v) => v | 0));
            const portDigest = digest();
            const portMem = {};
            for (const [name, addr, len] of REGIONS) {
                const bytes = [];
                for (let i = 0; i < len; i++) bytes.push(rt.mem.read8(addr + i));
                portMem[name] = bytes;
            }
            const portState = rt.mem.read32(SCREEN + MEMCARD.state) | 0;

            const label = `${variant.name} state 0x${state.toString(16)}`;
            assert.equal(portErr, oracleErr, `${label}: error`);
            try {
                assert.deepEqual(portEvents, oracleEvents, `${label}: ordered calls`);
                assert.deepEqual(portDigest, oracleDigest, `${label}: memory`);
                assert.equal(portState, oracleState, `${label}: next state`);
            } catch (e) {
                console.log("ORACLE", JSON.stringify(oracleRaw));
                console.log("ORACLEN", JSON.stringify(oracleEvents));
                console.log("PORT  ", JSON.stringify(portRaw));
                console.log("PORTN ", JSON.stringify(portEvents));
                console.log("DIGEST", JSON.stringify(oracleDigest));
                console.log("PDIGST", JSON.stringify(portDigest));
                for (const [name, addr, len] of REGIONS) {
                    for (let i = 0; i < len; i++) {
                        if (oracleMem[name][i] !== portMem[name][i]) {
                            console.log("DIFF", name, addr.toString(16), "+" + i.toString(16),
                                oracleMem[name][i].toString(16), "vs", portMem[name][i].toString(16));
                            break;
                        }
                    }
                }
                throw e;
            }
        }
    }
});

// ── The load gate's format test, 2026-10-14 ────────────────────────────────
// The original compares ONE BYTE: stgmcard.s .L0x00003288 `lbu $v1, 0x2($a0)`,
// `li $v0, 0x4`, `beq`. Byte +3 is the retained byte the save path copies from
// the live block and never rewrites, so an image written from a live block whose
// +3 is nonzero loads fine — the writer's own output must survive its reader.
// The port read the halfword at +2, which folded that retained byte into the
// gate and rejected such an image with result 8.
test("state 0x47's format gate reads the byte at +2, not the halfword", () => {
    const variant = { ...VARIANTS[1], services: 1, checksum: 0x0f }; // load: mode 1
    const run = (translated) => {
        seed(0x47, variant);
        rt.mem.write8(BUF, 0xff);       // stored checksum: a superset of the computed 0x0f
        rt.mem.write8(BUF + 2, 4);      // the one format byte the writer stores
        rt.mem.write8(BUF + 3, 0x11);   // the retained byte +3, nonzero
        if (translated) memcardStateMachine(rt.mem, SCREEN, WIDGETS, 0x26c4, portHost);
        else rt.cpu.call(FN, [SCREEN, WIDGETS, 0x26c4], 400000);
        return {
            state: rt.mem.read32(SCREEN + MEMCARD.state) | 0,
            result: rt.mem.read32(SCREEN + MEMCARD.result) | 0,
            card: Array.from({ length: 8 }, (_, i) => rt.mem.read8(CARD + i)),
            hideStep: EVENTS.filter((e) => e[0] === "hideStep").length,
        };
    };
    const original = run(false);
    assert.equal(original.result, 1, "the original accepts the image");
    assert.deepEqual(original.card.slice(0, 4), [0xff, 0, 4, 0x11],
        "and copies the image back whole, retained byte included");
    assert.equal(original.hideStep, 0, "no error strip");
    assert.deepEqual(run(true), original, "the port must accept it the same way");

    // The subset test's other direction: a stored byte missing a computed bit is
    // an error (8) with the between-steps hide — equality is not required, but a
    // missing bit is.
    const runBad = (translated) => {
        seed(0x47, { ...VARIANTS[1], services: 1, checksum: 0x0f });
        rt.mem.write8(BUF, 0x01);       // 0x0f & ~0x01 != 0
        rt.mem.write8(BUF + 2, 4);
        if (translated) memcardStateMachine(rt.mem, SCREEN, WIDGETS, 0x26c4, portHost);
        else rt.cpu.call(FN, [SCREEN, WIDGETS, 0x26c4], 400000);
        return {
            result: rt.mem.read32(SCREEN + MEMCARD.result) | 0,
            hideStep: EVENTS.filter((e) => e[0] === "hideStep").length,
        };
    };
    assert.deepEqual(runBad(false), { result: 8, hideStep: 1 }, "a missing bit rejects");
    assert.deepEqual(runBad(true), runBad(false), "the port rejects it the same way");
});

test("the dispatch, the opening fall-through and the shared settle", () => {
    seed(0, VARIANTS[0]);
    memcardStateMachine(rt.mem, SCREEN, WIDGETS, 0x26c4, portHost);
    const names = EVENTS.map((e) => e[0]);
    assert.equal(names[0], "w15c", "the header max-index call opens");
    assert.ok(names.includes("bank") && names.includes("w114"), "the header line is set");
    assert.ok(names.includes("tween"), "the default falls through into state 1");
    assert.equal(rt.mem.read32(SCREEN + MEMCARD.state) | 0, 2, "both increments compose");

    seed(0x0a, VARIANTS[0]);
    memcardStateMachine(rt.mem, SCREEN, WIDGETS, 0x26c4, portHost);
    assert.equal(rt.mem.read32(SCREEN + MEMCARD.state) | 0, 0x0b, "status 1 advances one");

    seed(0x191, VARIANTS[0]);
    memcardStateMachine(rt.mem, SCREEN, WIDGETS, 0x26c4, portHost);
    assert.equal(rt.mem.read32(SCREEN + MEMCARD.state) | 0, 0x20, "0x191 loads the queued state");
    assert.equal(rt.mem.read32(SCREEN + MEMCARD.state + 4) | 0, 0, "and moves the scratch into queued");
});

test("state 0x7b stores the next index before the continuation test and copies the header word", () => {
    const hdr = 0x80126000;
    const variant = { ...VARIANTS[0], fileIndex: 3, services: 1 };
    const run = (translated) => {
        seed(0x7b, variant);
        rt.mem.write32(0x80088774, hdr);
        for (let i = 0; i < 0xd8; i += 4) rt.mem.write32(hdr + i, 0x11111111);
        rt.mem.write32(hdr + 0xd0, 0xa5a5a5a5);
        if (translated) memcardStateMachine(rt.mem, SCREEN, WIDGETS, 0x26c4, portHost);
        else rt.cpu.call(FN, [SCREEN, WIDGETS, 0x26c4], 400000);
        return {
            index: rt.mem.read32(CARD_STRUCT + 0x324) | 0,
            tail: rt.mem.read32(SCREEN + MEMCARD.box + 0xd0) >>> 0,
            state: rt.mem.read32(SCREEN + MEMCARD.state) | 0,
        };
    };
    const original = run(false);
    assert.deepEqual(run(true), original, "0x7b finalize matches the interpreter");
    assert.equal(original.index, 4, "the delay-slot store increments the file index");
    assert.equal(original.tail, 0xa5a5a5a5, "the D4 tail word is copied onto the screen block");

    const cont = { ...VARIANTS[0], fileIndex: 2, services: 1 };
    const runCont = (translated) => {
        seed(0x7b, cont);
        if (translated) memcardStateMachine(rt.mem, SCREEN, WIDGETS, 0x26c4, portHost);
        else rt.cpu.call(FN, [SCREEN, WIDGETS, 0x26c4], 400000);
        return rt.mem.read32(CARD_STRUCT + 0x324) | 0;
    };
    assert.equal(runCont(false), 3, "original stores the next index even when more files remain");
    assert.equal(runCont(true), 3, "port stores the next index even when more files remain");
});

// ── The multi-slot corners, 2026-10-14 ─────────────────────────────────────
// The empty-slot presence test is the record's FIRST BYTE: state 0x21 reads
// `lbu 0x8(record)` at .L0x00002ECC and state 0x46 the same at .L0x00003168 —
// the byte F0x8008316c's binder also reads as "empty slot". The port read the
// first WORD, so a record whose byte 0 is zero while a later name byte is set
// (strcpy stops at the NUL and leaves the old tail) was taken as occupied: the
// save path asked "Writing over previous data." for an empty slot, and the load
// path read the file instead of reporting "No data here.".
//
// The empty-record save branch also writes ONLY the queued state and returns
// (.L0x00003524-.L0x0000352C: `li $v0, 0x32; j <return>; sw $v0, 0x14(screen)`);
// the state word stays 0x190, so the card status is re-checked (0x190 -> 0x191
// -> the queued/scratch swap) before the write. The port jumped straight to
// state 0x32 and skipped that gate.
test("the save/load presence test is the record's first byte, and the empty save re-checks the card", () => {
    for (const state of [0x21, 0x46]) {
        const variant = { ...VARIANTS[0], pad: 1 << 0xd, services: 1 };
        const run = (translated) => {
            seed(state, variant);
            // The selected slot is 1 (STAGE+4 = 1, seed() writes it): its record
            // starts at REC + 0x44, first byte 0, second byte set.
            rt.mem.write32(REC + 0x44 + 8, 0x00000100);
            rt.mem.write32(REC + 8, 0x00000100);
            if (translated) memcardStateMachine(rt.mem, SCREEN, WIDGETS, 0x26c4, portHost);
            else rt.cpu.call(FN, [SCREEN, WIDGETS, 0x26c4], 400000);
            return {
                events: EVENTS.map((e) => e.map((v) => v | 0)),
                state: rt.mem.read32(SCREEN + MEMCARD.state) | 0,
                queued: rt.mem.read32(SCREEN + MEMCARD.queued) | 0,
                latch: rt.mem.read32(SCREEN + MEMCARD.confirmLatch) | 0,
                afterLoad: rt.mem.read32(SCREEN + MEMCARD.afterLoad) | 0,
            };
        };
        const original = run(false);
        assert.deepEqual(run(true), original,
            `state 0x${state.toString(16)} treats the record as empty the way the interpreter does`);
    }
    // The interpreter's own answers, so the comparison cannot silently pin two
    // wrong branches: save returns with 0x190 pending and 0x32 queued; load
    // shows "No data here." (state 0x1F5, latch raised, 0x20 queued).
    const save = (() => {
        const variant = { ...VARIANTS[0], pad: 1 << 0xd, services: 1 };
        seed(0x21, variant);
        rt.mem.write32(REC + 0x44 + 8, 0x00000100);
        rt.cpu.call(FN, [SCREEN, WIDGETS, 0x26c4], 400000);
        return { state: rt.mem.read32(SCREEN + MEMCARD.state) | 0, queued: rt.mem.read32(SCREEN + MEMCARD.queued) | 0 };
    })();
    assert.deepEqual(save, { state: 0x190, queued: 0x32 }, "the empty save queues the write and keeps state 0x190");
    const load = (() => {
        const variant = { ...VARIANTS[0], pad: 1 << 0xd, services: 1 };
        seed(0x46, variant);
        rt.mem.write32(REC + 0x44 + 8, 0x00000100);
        rt.cpu.call(FN, [SCREEN, WIDGETS, 0x26c4], 400000);
        return { state: rt.mem.read32(SCREEN + MEMCARD.state) | 0, latch: rt.mem.read32(SCREEN + MEMCARD.confirmLatch) | 0, afterLoad: rt.mem.read32(SCREEN + MEMCARD.afterLoad) | 0 };
    })();
    assert.deepEqual(load, { state: 0x1f5, latch: 1, afterLoad: 1 }, "the empty load reports no data");
});
