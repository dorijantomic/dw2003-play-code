// Phase 4 oracle: engine/dw3/ui/report-row.ts must match pro/stfgtrep's
// F0x800848E4 (reportRowLifecycle) and F0x80083744 (reportRowFlourishDraw).
// Both originals run through engine/native on the shipped pro_stfgtrep.bin +
// resident.bin with the roster services, the report-type selector, the tile
// frame counter, the row's sub-methods and the draw context recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { expCountupStep, reportRowFlourishDraw, reportRowLifecycle, reportRowTick } from "../engine/dw3/ui/report-row.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ROW = 0x80180000;
const WIDGETS = 0x80181000;
const PARENT = 0x80182000;
const MESSAGE = 0x80183000;
const ROW_METHOD_38 = 0x0fe10000;
const ROW_METHOD_16C = 0x0fe10010;
const MSG_METHOD = 0x0fe20000;
const CELL_STUB = 0x0fe30000;
const TICK = {
    foldOpen: CELL_STUB + 0x00, foldTick: CELL_STUB + 0x10, levelUp: CELL_STUB + 0x20,
    digivolve: CELL_STUB + 0x30, ladder: CELL_STUB + 0x40, learnTech: CELL_STUB + 0x50,
    loadable: CELL_STUB + 0x60, dvGain: CELL_STUB + 0x70, copyForms: CELL_STUB + 0x80,
    acquired: CELL_STUB + 0x90, profile: CELL_STUB + 0xa0, sound: CELL_STUB + 0xb0,
    soundStop: CELL_STUB + 0xc0, padPressed: CELL_STUB + 0xd0, padKey: CELL_STUB + 0xe0,
    fillCard: CELL_STUB + 0xf0,
};
const MSG_OFFSETS = [0x114, 0x118, 0x120, 0x128, 0x130, 0x144, 0x168, 0x170];
const BUILD_STUB = 0x0fe10020;
const TICK_STUB = 0x0fe10030;
const FRAME_STUB = 0x0fe10040;
const BANK_STUB = 0x0fe10050;
const ROSTER_SLOT_STUB = 0x0fe10080;
const ROSTER_HANDLE_STUB = 0x0fe10060;
const REPORT_TYPE_STUB = 0x0fe10070;
const PACK_STUB = 0x0feb0000;
const FRAME_CTR_PTR = 0x8004de10 + 0x188;
const RECORD = 0x80200000;
const PACK_PTR = 0x80190000;
const CTX_ARITY = { setOrigin: 2, setLayer: 2, setPos: 2, setScale: 3, drawSprite: 4, setFrame: 1, m_0x88: 1 };

let EVENTS = [];
let PORT_DRAW = [];
let FRAME = 100;
let SLOT_RET = 0x80200000;
let ROSTER_EXP = 1000;
let FOLD_DONE = 0;
let LEVEL_UP = 0;
let FORM_ID = 0;
let LADDER = 0;
let TECH = 0;
let LOADABLE = 0;
let GAIN = 0;
let ACQUIRED = 0;
let PROFILE = 0;
let MSG_DONE = 0;
let MSG_WAIT = 0;
let PAD_PRESSED = 0;
let CHANNEL = 3;

function msgEvent(off, c) {
    const w = c.reg(4) >>> 0;
    switch (off) {
        case 0x114: return ["messageSet", w, c.reg(5) >>> 0, c.reg(6) | 0];
        case 0x118: return ["messageNumber", w, c.reg(5) | 0, c.reg(6) | 0];
        case 0x120: return ["messageInsert", w, c.reg(5) >>> 0, c.reg(6) | 0, c.reg(7) | 0];
        case 0x128: return ["messageSkip", w];
        case 0x130: return ["messageStart", w, c.reg(5) | 0];
        case 0x144: return ["messageVisible", w, c.reg(5) | 0];
        case 0x168: return ["messageDone", w];
        default: return ["messageWaiting", w];
    }
}

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(FRAME_STUB, () => { EVENTS.push(["frame"]); return FRAME; });
    rt.mem.write32(FRAME_CTR_PTR, FRAME_STUB);
    rt.cpu.setStub(BANK_STUB, (c) => { EVENTS.push(["bankGet", c.reg(4) | 0]); return 0x1234; });
    rt.mem.write32(0x80044f4c, BANK_STUB);
    rt.cpu.setStub(ROSTER_SLOT_STUB, (c) => {
        EVENTS.push(["rosterSlot", c.reg(4) | 0]); return SLOT_RET;
    });
    rt.mem.write32(0x80048d34 + 0x2718, ROSTER_SLOT_STUB);
    rt.cpu.setStub(ROSTER_HANDLE_STUB, (c) => {
        EVENTS.push(["rosterHandle", c.reg(4) >>> 0]); return RECORD;
    });
    rt.mem.write32(0x80048d34 + 0x2750, ROSTER_HANDLE_STUB);

    rt.cpu.setStub(ROW_METHOD_38, (c) => { EVENTS.push(["method38", ROW_METHOD_38, c.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(ROW_METHOD_16C, (c) => { EVENTS.push(["method16C", ROW_METHOD_16C, c.reg(4) >>> 0]); return 0; });
    // The row's widget builder and state machine are separate bodies (lane B's
    // translation and the next unit respectively): stub them at their real
    // overlay addresses so the original records the same boundary calls the
    // port makes through its host.
    rt.cpu.setStub(0x80083260, (c) => { EVENTS.push(["buildWidgets", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    // F0x80083E74 is translated now, so the original runs its real tick and the
    // oracle stubs the tick's own services instead.
    rt.cpu.setStub(TICK.foldOpen, (c) => { EVENTS.push(["rowFoldStart", c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(TICK.foldTick, (c) => { EVENTS.push(["rowFoldTick", c.reg(4) >>> 0]); return FOLD_DONE; });
    rt.cpu.setStub(TICK.levelUp, (c) => { EVENTS.push(["levelUpApply", c.reg(4) | 0, c.reg(5) | 0]); return LEVEL_UP; });
    rt.cpu.setStub(TICK.digivolve, (c) => { EVENTS.push(["digivolutionUnlock", c.reg(4) | 0]); return FORM_ID; });
    rt.cpu.setStub(TICK.ladder, (c) => { EVENTS.push(["dvLadder", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return LADDER; });
    rt.cpu.setStub(TICK.learnTech, (c) => { EVENTS.push(["learnTech", c.reg(4) | 0, c.reg(5) | 0]); return TECH; });
    rt.cpu.setStub(TICK.loadable, (c) => { EVENTS.push(["makeLoadable", c.reg(4) | 0, c.reg(5) | 0]); return LOADABLE; });
    rt.cpu.setStub(TICK.dvGain, (c) => { EVENTS.push(["dvGain", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return GAIN; });
    rt.cpu.setStub(TICK.copyForms, (c) => { EVENTS.push(["copyRowForms", c.reg(4) | 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(TICK.acquired, (c) => { EVENTS.push(["enumerateAcquired", c.reg(4) | 0, c.reg(5) >>> 0]); return ACQUIRED; });
    rt.cpu.setStub(TICK.profile, (c) => { EVENTS.push(["profileRecord", c.reg(4) | 0]); return PROFILE; });
    rt.cpu.setStub(TICK.sound, (c) => { EVENTS.push(["playSound", c.reg(4) >>> 0]); return CHANNEL; });
    rt.cpu.setStub(TICK.soundStop, (c) => { EVENTS.push(["stopSound", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(TICK.padPressed, () => { EVENTS.push(["padPressed"]); return PAD_PRESSED; });
    rt.cpu.setStub(TICK.padKey, (c) => { EVENTS.push(["padKey", c.reg(4) | 0, c.reg(5) | 0]); return c.reg(5) | 0; });
    rt.cpu.setStub(0x80083404, (c) => { EVENTS.push(["fillCard", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    for (const off of MSG_OFFSETS) {
        rt.cpu.setStub(MSG_METHOD + off, (c) => {
            EVENTS.push(msgEvent(off, c));
            return off === 0x168 ? MSG_DONE : off === 0x170 ? MSG_WAIT : 0;
        });
    }
    // The machine reads its routine cells and calls through them, so point each
    // cell at its recording stub.
    for (const [cell, stub] of [
        [0x80089144, TICK.foldOpen], [0x80089148, TICK.foldTick], [0x80089154, TICK.levelUp],
        [0x80089158, TICK.digivolve], [0x8008915c, TICK.ladder], [0x80089160, TICK.learnTech],
        [0x80089164, TICK.loadable], [0x80089168, TICK.dvGain],
        [0x80048d34 + 0x2738, TICK.copyForms], [0x80048d34 + 0x2740, TICK.acquired],
        [0x8005cca0, TICK.profile], [0x80055c48, TICK.sound], [0x80055c50, TICK.soundStop],
        [0x8004b7d0 + 0x3f4, TICK.padPressed], [0x8004b7d0 + 0x408, TICK.padKey],
    ]) {
        rt.mem.write32(cell, stub);
    }
    return rt;
}

const rt = runtime();

function seedRow(o = {}) {
    for (let i = 0; i < 0x174; i += 4) rt.mem.write32(ROW + i, 0);
    rt.mem.write32(ROW + 0x0c, (o.phase ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x10, (o.state ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x38, ROW_METHOD_38);
    rt.mem.write32(ROW + 0x54, (o.layer ?? 0x100) >>> 0);
    rt.mem.write32(ROW + 0x58, (o.bucket ?? 1) >>> 0);
    rt.mem.write32(ROW + 0x5c, (o.index ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x60, (o.gain ?? 500) >>> 0);
    rt.mem.write32(ROW + 0x64, (o.capped ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x68, (o.banner ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x6c, (o.tileFrame ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x70, (o.tileFrameAt ?? 0) >>> 0);
    for (let i = 0; i < 3; i++) rt.mem.write16(ROW + 0x74 + i * 2, (o.stats?.[i] ?? 0) & 0xffff);
    rt.mem.write32(ROW + 0xe8, (o.rowIndex ?? 0) >>> 0);
    rt.mem.write32(ROW + 0xf0, (o.expUp ?? 0) >>> 0);
    rt.mem.write32(ROW + 0xf4, (o.expFrame ?? 0) >>> 0);
    rt.mem.write32(ROW + 0xf8, (o.expFrameAt ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x100, (o.row0 ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x104, (o.row0Frame ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x108, (o.row0At ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x110, (o.row1 ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x114, (o.row1Frame ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x118, (o.row1At ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x120, (o.row2 ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x124, (o.row2Frame ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x128, (o.row2At ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x150, (o.scale ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x0c, (o.phase ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x24, WIDGETS);
    rt.mem.write32(ROW + 0x14, (o.selector ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x50, PARENT);
    for (let i = 0; i < 3; i++) rt.mem.write16(ROW + 0x74 + i * 2, (o.forms?.[i] ?? 0) & 0xffff);
    rt.mem.write32(ROW + 0xe8, (o.formIndex ?? 0) >>> 0);
    rt.mem.write32(ROW + 0xf0, (o.levelUpFlag ?? 0) >>> 0);
    rt.mem.write32(ROW + 0xf4, (o.levelUpFrame ?? 0) >>> 0);
    for (let i = 0; i < 3; i++) {
        rt.mem.write32(ROW + 0x100 + i * 0x10, (o.formFlags?.[i] ?? 0) >>> 0);
        rt.mem.write32(ROW + 0x104 + i * 0x10, (o.formFrames?.[i] ?? 0) >>> 0);
    }
    rt.mem.write32(ROW + 0x12c, (o.latch ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x130, (o.soundId ?? 0) >>> 0);
    rt.mem.write16(ROW + 0x134, (o.channel ?? 0xffff) & 0xffff);
    rt.mem.write32(ROW + 0x148, (o.tween ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x138, (o.expShown ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x13c, (o.expTarget ?? 1234) >>> 0);
    rt.mem.write32(ROW + 0x140, (o.expStep ?? 0) >>> 0);
    rt.mem.write32(PARENT + 0x70, (o.scoreCount ?? 0) >>> 0);
    rt.mem.write32(PARENT + 0x74, (o.handshake ?? 0) >>> 0);
    rt.mem.write32(WIDGETS + 0x2c, MESSAGE);
    for (const off of MSG_OFFSETS) rt.mem.write32(MESSAGE + off, MSG_METHOD + off);
    for (const off of [0x114, 0x134, 0x144]) rt.mem.write32(WIDGETS + off, ROW_METHOD_38);
    rt.mem.write8(0x80042b84 + (o.partner ?? 0) * 4 + (o.formIndex ?? 0) + 7, o.gate ?? 0);
    rt.mem.write16(0x80042b84, (o.partyScore ?? 0) & 0xffff);
    rt.mem.write32(0x80086a88 + (o.partyScore ?? 0) * 0x0c, (o.score ?? 0) >>> 0);
    rt.mem.write32(0x8005cca8, 2);
    FOLD_DONE = o.foldDone ?? 0;
    LEVEL_UP = o.levelUp ?? 0;
    FORM_ID = o.formId ?? 0;
    LADDER = o.ladder ?? 0;
    TECH = o.tech ?? 0;
    LOADABLE = o.loadable ?? 0;
    GAIN = o.dvGain ?? 0;
    ACQUIRED = o.acquired ?? 0;
    PROFILE = o.profile ?? 0;
    MSG_DONE = o.msgDone ?? 0;
    MSG_WAIT = o.msgWait ?? 0;
    PAD_PRESSED = o.pressed ?? 0;
    rt.mem.write32(ROW + 0x158, (o.bannerFrame ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x15c, (o.bannerFrameAt ?? 0) >>> 0);
    rt.mem.write32(ROW + 0x16c, ROW_METHOD_16C);
    rt.mem.write32(RECORD + 0x18, (o.exp ?? ROSTER_EXP) >>> 0);
    FRAME = o.frame ?? 100;
    SLOT_RET = (o.slotRet ?? RECORD) >>> 0;
}

function fields() {
    const out = [];
    for (let i = 0; i < 0x174 / 4; i++) out.push(rt.mem.read32(ROW + i * 4) >>> 0);
    out.push(rt.mem.read32(PARENT + 0x70) >>> 0, rt.mem.read32(PARENT + 0x74) >>> 0);
    out.push(rt.mem.read32(WIDGETS + 0x2c) >>> 0);
    return out;
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, CTX_ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setFrame(n) { PORT_DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        setPos(x, y) { PORT_DRAW.push(["setPos", [x, y, 0, 0]]); },
        setScale(x, y, z) { PORT_DRAW.push(["setScale", [x, y, z, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        frameDelta() { return 1; },
        frameCounter() { EVENTS.push(["frame"]); return FRAME; },
        rosterSlot(p) { EVENTS.push(["rosterSlot", p | 0]); return SLOT_RET; },
        bankGet(id) { EVENTS.push(["bankGet", id | 0]); return 0x1234; },
        rosterHandle(s) { EVENTS.push(["rosterHandle", s >>> 0]); return RECORD; },
        advanceRowPhase(fn, row) { EVENTS.push(["method38", fn >>> 0, row >>> 0]); },
        computeRowScore(fn, row) { EVENTS.push(["method16C", fn >>> 0, row >>> 0]); },
        buildRowWidgets(row, w) { EVENTS.push(["buildWidgets", row >>> 0, w >>> 0]); },
        rowFoldStart(window, on) { EVENTS.push(["rowFoldStart", window >>> 0, on | 0]); },
        rowFoldTick(window) { EVENTS.push(["rowFoldTick", window >>> 0]); return FOLD_DONE; },
        levelUpApply(slot, gain) { EVENTS.push(["levelUpApply", slot | 0, gain | 0]); return LEVEL_UP; },
        digivolutionUnlock(slot) { EVENTS.push(["digivolutionUnlock", slot | 0]); return FORM_ID; },
        dvLadder(slot, form, gain) { EVENTS.push(["dvLadder", slot | 0, form | 0, gain | 0]); return LADDER; },
        learnTech(slot, form) { EVENTS.push(["learnTech", slot | 0, form | 0]); return TECH; },
        makeLoadable(slot, form) { EVENTS.push(["makeLoadable", slot | 0, form | 0]); return LOADABLE; },
        dvGain(slot, form, score, count) { EVENTS.push(["dvGain", slot | 0, form | 0, score | 0, count | 0]); return GAIN; },
        copyRowForms(slot, out) { EVENTS.push(["copyRowForms", slot | 0, out >>> 0]); },
        enumerateAcquired(slot, out) { EVENTS.push(["enumerateAcquired", slot | 0, out >>> 0]); return ACQUIRED; },
        profileRecord(form) { EVENTS.push(["profileRecord", form | 0]); return PROFILE; },
        playSound(id) { EVENTS.push(["playSound", id >>> 0]); return CHANNEL; },
        stopSound(id, channel) { EVENTS.push(["stopSound", id | 0, channel | 0]); },
        padPressed() { EVENTS.push(["padPressed"]); return PAD_PRESSED; },
        padKey(port, code) { EVENTS.push(["padKey", port | 0, code | 0]); return code | 0; },
        messageSet(w, src, id) { EVENTS.push(["messageSet", w >>> 0, src >>> 0, id | 0]); },
        messageNumber(w, line, v) { EVENTS.push(["messageNumber", w >>> 0, line | 0, v | 0]); },
        messageInsert(w, src, v, flag) { EVENTS.push(["messageInsert", w >>> 0, src >>> 0, v | 0, flag | 0]); },
        messageSkip(w) { EVENTS.push(["messageSkip", w >>> 0]); },
        messageStart(w, mode) { EVENTS.push(["messageStart", w >>> 0, mode | 0]); },
        messageVisible(w, v) { EVENTS.push(["messageVisible", w >>> 0, v | 0]); },
        messageDone(w) { EVENTS.push(["messageDone", w >>> 0]); return MSG_DONE; },
        messageWaiting(w) { EVENTS.push(["messageWaiting", w >>> 0]); return MSG_WAIT; },
        fillCard(row, w, flag) { EVENTS.push(["fillCard", row >>> 0, w >>> 0, flag | 0]); },
    };
}

function compare(label, o, original, port) {
    seedRow(o);
    EVENTS = [];
    rt.drawCalls.length = 0;
    original();
    const oEvents = EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v)));
    const oDraws = normDraw(rt.drawCalls.map((c) => [c.method, c.args]));
    rt.drawCalls.length = 0;
    const oFields = fields();

    seedRow(o);
    EVENTS = [];
    PORT_DRAW = [];
    port(rt.mem);
    assert.deepEqual(EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v))), oEvents,
        `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oDraws, `${label}: draw`);
    assert.deepEqual(fields(), oFields, `${label}: fields`);
}

test("reportRowFlourishDraw matches F0x80083744", () => {
    const draw = (label, o) => compare(label, o,
        () => rt.cpu.call(0x80083744, [ROW]),
        (mem) => reportRowFlourishDraw(mem, ROW, portHost()));
    draw("below state floor", { state: 0x13, scale: 0x1000, expUp: 1, banner: 1 });
    draw("idle row", { state: 0x14, scale: 0x1000 });
    draw("exp sparkle", { state: 0x14, scale: 0x1000, expUp: 1, expFrame: 3, expFrameAt: 90 });
    draw("sparkle steps", { state: 0x14, scale: 0x1000, expUp: 1, expFrame: 3, expFrameAt: 97 });
    draw("sparkle clamps", { state: 0x14, scale: 0x1000, expUp: 1, expFrame: 10, expFrameAt: 90 });
    draw("rows flagged", {
        state: 0x14, scale: 0x1000, row0: 1, row1: 1, row2: 1,
        row0Frame: 2, row1Frame: 5, row2Frame: 10, row0At: 99, row1At: 99, row2At: 99,
    });
    draw("banner", { state: 0x14, scale: 0x1000, banner: 1, bannerFrame: 1, bannerFrameAt: 96, stats: [4, 0, 6], rowIndex: 2 });
    draw("banner stat edge", { state: 0x14, scale: 0x1000, banner: 1, stats: [4, 0, 0], rowIndex: 0 });
    draw("banner stat three", { state: 0x14, scale: 0x1000, banner: 1, stats: [3, 0, 0], rowIndex: 0 });
    draw("banner frame wraps", { state: 0x14, scale: 0x1000, banner: 1, bannerFrame: 3, bannerFrameAt: 90 });
    draw("scaled", { state: 0x14, scale: 0x800, row0: 1, row0Frame: 4, row0At: 99 });
    draw("type one", { state: 0x14, scale: 0x1000, slotRet: 1, tileFrame: 3, tileFrameAt: 80 });
    draw("type one wraps", { state: 0x14, scale: 0x1000, slotRet: 1, tileFrame: 3, tileFrameAt: 87 });
    draw("tile frame 7", { state: 0x14, scale: 0x1000, tileFrame: 7, tileFrameAt: 80 });
    draw("tile frame 6", { state: 0x14, scale: 0x1000, tileFrame: 6, tileFrameAt: 80 });
    draw("row index high", { state: 0x14, scale: 0x1000, banner: 1, rowIndex: 5, stats: [9, 9, 9] });
    draw("different index", { state: 0x14, scale: 0x1000, index: 2, expUp: 1, expFrame: 1, expFrameAt: 90 });
});

test("reportRowTick matches F0x80083E74", () => {
    const step = (label, o) => compare(label, o,
        () => rt.cpu.call(0x80083e74, [ROW, WIDGETS]),
        (mem) => reportRowTick(mem, ROW, WIDGETS, portHost()));
    for (const state of Array.from({ length: 51 }, (_, i) => i)) {
        step(`state ${state} quiet`, { state, formIndex: 0, expTarget: 1234 });
    }
    for (const state of Array.from({ length: 51 }, (_, i) => i)) {
        step(`state ${state} ready`, {
            state, foldDone: 1, gate: 1, formIndex: 0, forms: [5, 0, 0], levelUp: 1,
            formId: 1, tech: 2, loadable: 3, acquired: 4, msgDone: 1, expTarget: 1234, expShown: 0,
        });
    }
    step("state 20 gates off", { state: 20, gate: 0, partyScore: 2, score: 77 });
    step("state 20 second form", { state: 20, gate: 1, formIndex: 1, forms: [0, 6, 0], partyScore: 1, score: 55 });
    step("state 20 form three", { state: 20, gate: 1, formIndex: 2, forms: [0, 0, 3], partyScore: 1, score: 55 });
    step("state 21 flag set", { state: 21, formFlags: [1, 0, 0], channel: 4, soundId: 0x4000b, formIndex: 0 });
    step("state 21 flag clear", { state: 21, formFlags: [0, 0, 0] });
    step("state 22 learns", { state: 22, tech: 9, formIndex: 0, forms: [5, 0, 0] });
    step("state 22 none", { state: 22, tech: 0, formIndex: 0, forms: [5, 0, 0] });
    step("state 23 loadable", { state: 23, loadable: 4, formIndex: 0, forms: [5, 0, 0] });
    step("state 24 advances", { state: 24, formIndex: 1 });
    step("state 24 ends", { state: 24, formIndex: 2 });
    step("state 25 done selector 3", { state: 25, msgDone: 1, selector: 3 });
    step("state 25 done selector 5", { state: 25, msgDone: 1, selector: 5 });
    step("state 25 done selector 0", { state: 25, msgDone: 1, selector: 0 });
    // The learn/load LOOP: the selector table at 0x80082d80 points selectors 0
    // AND 1 at 0x800843f4 (state 0x16, the F0x8008670C learn) and selector 2 at
    // 0x80084400 (state 0x17, the F0x80086844 loadable), so the message-done
    // dispatch re-enters the services' states until they answer 0. These cases
    // run the ORIGINAL overlay, so they pin the loop against the disc itself.
    step("state 25 done selector 1 loops to learn", { state: 25, msgDone: 1, selector: 1 });
    step("state 25 done selector 2 loops to loadable", { state: 25, msgDone: 1, selector: 2 });
    step("state 25 done selector 4", { state: 25, msgDone: 1, selector: 4 });
    step("state 25 done selector 6", { state: 25, msgDone: 1, selector: 6 });
    step("state 45 waiting circle", { state: 45, msgWait: 1, pressed: 1 << 0xd });
    step("state 45 waiting idle", { state: 45, msgWait: 1, pressed: 0 });
    step("state 25 typewriter", { state: 25, msgDone: 0, msgWait: 0, pressed: 1 << 0xd });
    step("state 40 levels", { state: 40, levelUp: 1, gain: 500, channel: 2, soundId: 0x4000b });
    step("state 40 no level", { state: 40, levelUp: 0, gain: 0 });
    step("state 41 unlocks", { state: 41, formId: 7, profile: 0x80184000 });
    step("state 41 latched", { state: 41, formId: 0, latch: 1 });
    step("state 41 missed", { state: 41, formId: 0, latch: 0 });
    step("state 42 acquired", { state: 42, acquired: 4 });
    step("state 42 few", { state: 42, acquired: 3 });
    step("state 50 level up running", { state: 50, levelUpFlag: 1, levelUpFrame: 3 });
    step("state 50 form running", { state: 50, formFlags: [0, 1, 0], formFrames: [0, 2, 0] });
    step("state 50 done", { state: 50, levelUpFlag: 1, levelUpFrame: 10, formFlags: [1, 0, 0], formFrames: [10, 0, 0] });
});

test("expCountupStep matches F0x80083D9C", () => {
    const step = (label, o) => {
        seedRow(o);
        const oracle = expStepOracle(o);
        seedRow(o);
        EVENTS = [];
        const port = expCountupStep(rt.mem, ROW, portHost());
        assert.equal(port | 0, oracle.ret, `${label}: return`);
        assert.deepEqual(fields(), oracle.fields, `${label}: fields`);
        assert.deepEqual(EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v))), oracle.events,
            `${label}: calls`);
    };
    // A zero target is excluded: the original's repunit loop counts down from
    // -1 there and never terminates (see the note in report-row.ts).
    step("climb", { expShown: 0, expTarget: 1234, expStep: 0 });
    step("climb four digits", { expShown: 1111, expTarget: 1234, expStep: 1 });
    step("snaps", { expShown: 9999, expTarget: 1234, expStep: 10 });
    step("six digits", { expShown: 0, expTarget: 999999, expStep: 2 });
    step("single digit", { expShown: 0, expTarget: 7, expStep: 0 });
    step("step nine", { expShown: 0, expTarget: 1234, expStep: 9 });
    step("step eight", { expShown: 0, expTarget: 1234, expStep: 8 });
    step("wrap edge", { expShown: 8, expTarget: 7, expStep: 0 });
});

/** The original count-up: the same comparison, driven through the interpreter. */
function expStepOracle(o) {
    EVENTS = [];
    const before = rt.drawCalls.length;
    const ret = rt.cpu.call(0x80083d9c, [ROW]);
    rt.drawCalls.length = before;
    return {
        ret: ret | 0,
        fields: fields(),
        events: EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v))),
    };
}

test("reportRowLifecycle matches F0x800848E4", () => {
    const step = (label, o) => compare(label, o,
        () => rt.cpu.call(0x800848e4, [ROW, WIDGETS]),
        (mem) => reportRowLifecycle(mem, ROW, WIDGETS, portHost()));
    step("setup", { phase: 0, exp: 1000, gain: 500 });
    step("setup at cap", { phase: 0, exp: 0xf423f, gain: 1 });
    step("setup at the flag edge", { phase: 0, exp: 0xf423e, gain: 0 });
    step("setup one under the edge", { phase: 0, exp: 0xf423d, gain: 0 });
    step("setup over flag", { phase: 0, exp: 0xf423f, gain: 0 });
    step("setup capped", { phase: 0, exp: 500, gain: 0, capped: 1 });
    step("setup state 4", { phase: 4, exp: 100, gain: 0 });
    step("setup negative", { phase: -1, exp: 100, gain: 0 });
    step("idle state 2", { phase: 2, exp: 100, gain: 0 });
    step("idle state 3", { phase: 3, exp: 100, gain: 0 });
    step("run state 1", { phase: 1, state: 0x14, scale: 0x1000, banner: 1, row0: 1 });
    step("run state 1 idle flourish", { phase: 1, state: 4, scale: 0x1000 });
});
